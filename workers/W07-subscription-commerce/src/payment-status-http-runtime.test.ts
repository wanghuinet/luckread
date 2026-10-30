import { describe, expect, it } from 'vitest'
import {
  handlePaymentStatusRequest,
  type PaymentStatusDependencies,
} from './payment-status-http-runtime.js'
import {
  HyperswitchClientError,
  type HyperswitchPayment,
} from './hyperswitch-client.js'
import {
  PaymentPersistenceError,
  type PaymentAttemptDto,
} from './payment-persistence.js'

const CUSTOMER = 'user_1'
const PAYMENT_ID = 'pay_' + 'a'.repeat(26)
const NOW = '2026-10-30T12:00:00.000Z'
const LATER = '2026-10-30T12:00:01.000Z'

const payment: PaymentAttemptDto = {
  paymentId: PAYMENT_ID,
  orderId: 'ord_test_1',
  amountMinor: 1200,
  currency: 'USD',
  status: 'processing',
  version: 3,
  providerUpdatedAt: NOW,
  createdAt: NOW,
  updatedAt: LATER,
}

const providerPayment: HyperswitchPayment = {
  paymentId: PAYMENT_ID,
  merchantId: 'merchant_test',
  amount: 1200,
  currency: 'USD',
  status: 'processing',
  clientSecret: 'must-never-leave-w07',
  customerId: CUSTOMER,
  paymentMethodId: 'provider-vault-reference',
}

const env = {
  D1_04: {} as D1Database,
  HYPERSWITCH_ENVIRONMENT: 'sandbox',
  HYPERSWITCH_API_KEY: 'server-only-test-key',
  HYPERSWITCH_MERCHANT_ID: 'merchant_test',
}

function request(url = 'https://luckread-w07.internal/payments/' + PAYMENT_ID, method = 'GET') {
  return new Request(url, { method })
}

function dependencies(overrides: Partial<PaymentStatusDependencies> = {}) {
  let providerCalls = 0
  let receivedForceSync = false
  const deps: PaymentStatusDependencies = {
    readPayment: (async (_db, customerId, paymentId) => {
      expect(customerId).toBe(CUSTOMER)
      expect(paymentId).toBe(PAYMENT_ID)
      return payment
    }) as typeof PaymentStatusDependencies extends never ? never : PaymentStatusDependencies['readPayment'],
    retrieveProvider: (async (_config, paymentId, _fetch, forceSync) => {
      providerCalls += 1
      receivedForceSync = forceSync === true
      expect(paymentId).toBe(PAYMENT_ID)
      return providerPayment
    }) as PaymentStatusDependencies['retrieveProvider'],
    now: () => new Date(LATER),
    ...overrides,
  }
  return { deps, providerCalls: () => providerCalls, forceSync: () => receivedForceSync }
}

async function body(response: Response) {
  return await response.json() as {
    data?: {
      payment?: PaymentAttemptDto
      providerStatus?: string | null
      providerStatusCheck?: string
      providerCheckedAt?: string | null
      statusAuthority?: string
    }
    error?: { code?: string }
  }
}

describe('owner-scoped payment status runtime', () => {
  it('re-reads the payment from W07, forces a provider refresh and returns no provider credentials', async () => {
    const fixture = dependencies()
    const response = await handlePaymentStatusRequest(request(), CUSTOMER, env, fixture.deps)
    const value = await body(response!)

    expect(response?.status).toBe(200)
    expect(fixture.providerCalls()).toBe(1)
    expect(fixture.forceSync()).toBe(true)
    expect(value.data).toMatchObject({
      payment,
      providerStatus: 'processing',
      providerStatusCheck: 'MATCH',
      providerCheckedAt: LATER,
      statusAuthority: 'W07_D1_04',
    })
    expect(JSON.stringify(value)).not.toContain('must-never-leave-w07')
    expect(JSON.stringify(value)).not.toContain('provider-vault-reference')
    expect(JSON.stringify(value)).not.toContain('merchant_test')
    expect(response?.headers.get('cache-control')).toBe('no-store')
  })

  it('does not replace D1-04 status when the live provider observation differs', async () => {
    const fixture = dependencies({
      retrieveProvider: (async () => ({ ...providerPayment, status: 'succeeded' })) as PaymentStatusDependencies['retrieveProvider'],
    })
    const response = await handlePaymentStatusRequest(request(), CUSTOMER, env, fixture.deps)
    const value = await body(response!)

    expect(response?.status).toBe(200)
    expect(value.data?.payment?.status).toBe('processing')
    expect(value.data).toMatchObject({ providerStatus: 'succeeded', providerStatusCheck: 'DIFFERS' })
    expect(value.data?.statusAuthority).toBe('W07_D1_04')
  })

  it('returns the last persisted status when provider status lookup is unavailable', async () => {
    const fixture = dependencies({
      retrieveProvider: (async () => {
        throw new HyperswitchClientError('UPSTREAM_UNAVAILABLE', 'provider offline')
      }) as PaymentStatusDependencies['retrieveProvider'],
    })
    const response = await handlePaymentStatusRequest(request(), CUSTOMER, env, fixture.deps)
    const value = await body(response!)

    expect(response?.status).toBe(200)
    expect(value.data?.payment?.status).toBe('processing')
    expect(value.data).toMatchObject({ providerStatus: null, providerStatusCheck: 'UNAVAILABLE', providerCheckedAt: LATER })
  })

  it('does not call Hyperswitch when provider configuration is missing', async () => {
    const fixture = dependencies()
    const response = await handlePaymentStatusRequest(request(), CUSTOMER, {
      D1_04: env.D1_04,
      HYPERSWITCH_ENVIRONMENT: 'sandbox',
    }, fixture.deps)
    const value = await body(response!)

    expect(response?.status).toBe(200)
    expect(fixture.providerCalls()).toBe(0)
    expect(value.data).toMatchObject({
      payment,
      providerStatus: null,
      providerStatusCheck: 'UNAVAILABLE',
      providerCheckedAt: null,
    })
  })

  it('does not make a provider request when the payment is foreign-owned or absent', async () => {
    const fixture = dependencies({
      readPayment: (async () => {
        throw new PaymentPersistenceError('RESOURCE_NOT_FOUND', 404)
      }) as PaymentStatusDependencies['readPayment'],
    })
    const response = await handlePaymentStatusRequest(request(), CUSTOMER, env, fixture.deps)
    expect(response?.status).toBe(404)
    expect((await body(response!)).error?.code).toBe('RESOURCE_NOT_FOUND')
    expect(fixture.providerCalls()).toBe(0)
  })

  it('rejects malformed IDs, query arguments and request bodies before D1 or provider access', async () => {
    const fixture = dependencies()
    const malformed = await handlePaymentStatusRequest(
      request('https://luckread-w07.internal/payments/not-a-payment'),
      CUSTOMER, env, fixture.deps,
    )
    const query = await handlePaymentStatusRequest(
      request('https://luckread-w07.internal/payments/' + PAYMENT_ID + '?force_sync=true'),
      CUSTOMER, env, fixture.deps,
    )
    const withBody = new Request('https://luckread-w07.internal/payments/' + PAYMENT_ID, {
      method: 'GET',
      body: 'unexpected',
    })
    const bodyResponse = await handlePaymentStatusRequest(withBody, CUSTOMER, env, fixture.deps)
    expect(malformed?.status).toBe(404)
    expect(query?.status).toBe(400)
    expect(bodyResponse?.status).toBe(400)
    expect(fixture.providerCalls()).toBe(0)
  })

  it('ignores paths outside the admitted payment detail route', async () => {
    const fixture = dependencies()
    const response = await handlePaymentStatusRequest(
      request('https://luckread-w07.internal/payments/intents'),
      CUSTOMER, env, fixture.deps,
    )
    expect(response).toBeNull()
    expect(fixture.providerCalls()).toBe(0)
  })
})
