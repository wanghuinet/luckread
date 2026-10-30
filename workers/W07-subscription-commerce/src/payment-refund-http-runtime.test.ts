import { describe, expect, it } from 'vitest'
import {
  handlePaymentRefundRequest,
} from './payment-refund-http-runtime.js'
import type {
  HyperswitchPayment,
  HyperswitchRefund,
} from './hyperswitch-client.js'
import type {
  PaymentAttemptDto,
  RefundDto,
  RefundRequestCreation,
} from './payment-persistence.js'

const CUSTOMER = 'refund-owner-1'
const MERCHANT = 'merchant-refund-test'
const PAYMENT_ID = 'pay_' + 'a'.repeat(26)
const REFUND_ID = 'ref_' + 'b'.repeat(26)
const IDEMPOTENCY_KEY = 'refund-create-key-01'
const NOW = '2026-10-30T18:00:00.000Z'
const LATER = '2026-10-30T18:00:01.000Z'

const payment: PaymentAttemptDto = {
  paymentId: PAYMENT_ID,
  orderId: 'ord_refund_1',
  amountMinor: 1200,
  currency: 'USD',
  status: 'partially_captured',
  version: 3,
  providerUpdatedAt: NOW,
  createdAt: NOW,
  updatedAt: LATER,
}

const providerPayment: HyperswitchPayment = {
  paymentId: PAYMENT_ID,
  merchantId: MERCHANT,
  amount: 1200,
  currency: 'USD',
  status: 'partially_captured',
  clientSecret: 'server-only-client-secret',
  customerId: CUSTOMER,
  paymentMethodId: 'provider-vault-reference',
  amountCaptured: 600,
}

const initiatingRefund: RefundDto = {
  refundId: REFUND_ID,
  paymentId: PAYMENT_ID,
  amountMinor: 500,
  currency: 'USD',
  reason: 'requested_by_customer',
  status: 'INITIATING',
  version: 1,
  providerUpdatedAt: null,
  createdAt: LATER,
  updatedAt: LATER,
}

const providerRefund: HyperswitchRefund = {
  refundId: REFUND_ID,
  paymentId: PAYMENT_ID,
  amount: 500,
  currency: 'USD',
  status: 'pending',
  reason: 'requested_by_customer',
  createdAt: LATER,
  updatedAt: LATER,
}

const persistedRefund: RefundDto = {
  ...initiatingRefund,
  status: 'pending',
  version: 2,
  providerUpdatedAt: LATER,
  updatedAt: '2026-10-30T18:00:02.000Z',
}

const env = {
  D1_04: {} as D1Database,
  HYPERSWITCH_ENVIRONMENT: 'sandbox',
  HYPERSWITCH_API_KEY: 'server-only-hyperswitch-key',
  HYPERSWITCH_MERCHANT_ID: MERCHANT,
}

function createRequest(
  path = '/payments/' + PAYMENT_ID + '/refunds',
  method = 'POST',
  body: string | undefined = JSON.stringify({ amountMinor: 500, reason: 'requested_by_customer' }),
  idempotencyKey: string | null = IDEMPOTENCY_KEY,
): Request {
  const headers = new Headers()
  if (body !== undefined) headers.set('content-type', 'application/json')
  if (idempotencyKey !== null) headers.set('Idempotency-Key', idempotencyKey)
  return new Request('https://luckread-w07.internal' + path, {
    method,
    headers,
    ...(body !== undefined ? { body } : {}),
  })
}

function createDependencies(overrides: Record<string, unknown> = {}) {
  const calls: string[] = []
  const args: Record<string, unknown> = {}
  const dependencies = {
    now: () => new Date('2026-10-30T18:00:03.000Z'),
    readPayment: async (
      _db: D1Database,
      customerId: string,
      paymentId: string,
      expectedMerchantId?: string,
    ) => {
      calls.push('readPayment')
      args.readPayment = { customerId, paymentId, expectedMerchantId }
      return payment
    },
    retrievePayment: async (
      _config: unknown,
      paymentId: string,
      _fetch?: typeof fetch,
      forceSync?: boolean,
    ) => {
      calls.push('retrievePayment')
      args.retrievePayment = { paymentId, forceSync }
      return providerPayment
    },
    recordCapturedAmount: async (
      _db: D1Database,
      customerId: string,
      observed: HyperswitchPayment,
    ) => {
      calls.push('recordCapturedAmount')
      args.recordCapturedAmount = { customerId, observed }
      return {
        paymentId: observed.paymentId,
        amountCapturedMinor: observed.amountCaptured!,
        version: 4,
        updatedAt: LATER,
        changed: true,
      }
    },
    createRefundRequest: async (
      _db: D1Database,
      customerId: string,
      paymentId: string,
      amountMinor: number,
      idempotencyKey: string,
      reason: string | null,
    ): Promise<RefundRequestCreation> => {
      calls.push('createRefundRequest')
      args.createRefundRequest = { customerId, paymentId, amountMinor, idempotencyKey, reason }
      return { refund: initiatingRefund, replayed: false }
    },
    createProviderRefund: async (
      _config: unknown,
      input: {
        refundId: string
        paymentId: string
        amount: number
        currency: string
        reason?: string
      },
    ) => {
      calls.push('createProviderRefund')
      args.createProviderRefund = input
      return providerRefund
    },
    recordProviderResponse: async (
      _db: D1Database,
      customerId: string,
      value: HyperswitchRefund,
    ) => {
      calls.push('recordProviderResponse')
      args.recordProviderResponse = { customerId, value }
      return persistedRefund
    },
    readRefund: async (_db: D1Database, customerId: string, refundId: string) => {
      calls.push('readRefund')
      args.readRefund = { customerId, refundId }
      return persistedRefund
    },
    ...overrides,
  }
  return { dependencies, calls, args }
}

async function responseJson(response: Response) {
  return await response.json() as {
    data?: {
      refund?: RefundDto
      replayed?: boolean
      statusAuthority?: string
    }
    error?: { code?: string }
  }
}

describe('W07 owner-scoped refund HTTP runtime', () => {
  it('verifies captured funds, reserves once, calls Hyperswitch with the stable refund ID and persists only its safe response', async () => {
    const fixture = createDependencies()
    const response = await handlePaymentRefundRequest(
      createRequest(), CUSTOMER, env, fixture.dependencies,
    )
    const value = await responseJson(response!)

    expect(response?.status).toBe(201)
    expect(fixture.calls).toEqual([
      'readPayment',
      'retrievePayment',
      'recordCapturedAmount',
      'createRefundRequest',
      'createProviderRefund',
      'recordProviderResponse',
    ])
    expect(fixture.args.readPayment).toEqual({
      customerId: CUSTOMER,
      paymentId: PAYMENT_ID,
      expectedMerchantId: MERCHANT,
    })
    expect(fixture.args.retrievePayment).toEqual({ paymentId: PAYMENT_ID, forceSync: true })
    expect(fixture.args.recordCapturedAmount).toMatchObject({
      customerId: CUSTOMER,
      observed: { amountCaptured: 600 },
    })
    expect(fixture.args.createRefundRequest).toEqual({
      customerId: CUSTOMER,
      paymentId: PAYMENT_ID,
      amountMinor: 500,
      idempotencyKey: IDEMPOTENCY_KEY,
      reason: 'requested_by_customer',
    })
    expect(fixture.args.createProviderRefund).toEqual({
      refundId: REFUND_ID,
      paymentId: PAYMENT_ID,
      amount: 500,
      currency: 'USD',
      reason: 'requested_by_customer',
    })
    expect(value.data).toMatchObject({
      refund: persistedRefund,
      replayed: false,
      statusAuthority: 'W07_D1_04',
    })
    expect(JSON.stringify(value)).not.toContain('server-only-hyperswitch-key')
    expect(JSON.stringify(value)).not.toContain('provider-vault-reference')
    expect(JSON.stringify(value)).not.toContain(MERCHANT)
    expect(response?.headers.get('cache-control')).toBe('no-store')
  })

  it('allows partial refunds only within the provider-reported captured balance', async () => {
    const fixture = createDependencies({
      retrievePayment: async () => ({ ...providerPayment, amountCaptured: 499 }),
    })
    const response = await handlePaymentRefundRequest(
      createRequest(), CUSTOMER, env, fixture.dependencies,
    )
    expect(response?.status).toBe(409)
    expect((await responseJson(response!)).error?.code).toBe('REFUND_CAPTURED_AMOUNT_UNAVAILABLE')
    expect(fixture.calls).toEqual(['readPayment', 'recordCapturedAmount'])
      .filter(() => false)
  })

  it('rejects a provider observation whose captured amount exceeds the payment intent amount', async () => {
    const fixture = createDependencies({
      retrievePayment: async () => ({ ...providerPayment, amountCaptured: 1201 }),
    })
    const response = await handlePaymentRefundRequest(
      createRequest(), CUSTOMER, env, fixture.dependencies,
    )
    expect(response?.status).toBe(409)
    expect((await responseJson(response!)).error?.code).toBe('REFUND_CAPTURED_AMOUNT_UNAVAILABLE')
    expect(fixture.calls).toEqual(['readPayment', 'retrievePayment'])
  })

  it('resends the same stable refund ID after an ambiguous provider request when the D1 reservation is still INITIATING', async () => {
    const fixture = createDependencies({
      createRefundRequest: async () => ({ refund: initiatingRefund, replayed: true }),
    })
    const response = await handlePaymentRefundRequest(
      createRequest(), CUSTOMER, env, fixture.dependencies,
    )
    expect(response?.status).toBe(200)
    expect(fixture.args.createProviderRefund).toEqual({
      refundId: REFUND_ID,
      paymentId: PAYMENT_ID,
      amount: 500,
      currency: 'USD',
      reason: 'requested_by_customer',
    })
  })

  it('does not call the provider again when the same idempotency key already has a non-initiating refund state', async () => {
    const fixture = createDependencies({
      createRefundRequest: async () => ({
        refund: persistedRefund,
        replayed: true,
      }),
    })
    const response = await handlePaymentRefundRequest(
      createRequest(), CUSTOMER, env, fixture.dependencies,
    )
    const value = await responseJson(response!)
    expect(response?.status).toBe(200)
    expect(value.data).toMatchObject({ refund: persistedRefund, replayed: true, statusAuthority: 'W07_D1_04' })
    expect(fixture.calls).toEqual(['readPayment', 'retrievePayment', 'recordCapturedAmount', 'createRefundRequest'])
  })

  it('keeps an INITIATING reservation after a provider timeout so the same key and refund ID can safely retry', async () => {
    const fixture = createDependencies({
      createProviderRefund: async () => {
        throw new Error('ambiguous provider timeout')
      },
    })
    const response = await handlePaymentRefundRequest(
      createRequest(), CUSTOMER, env, fixture.dependencies,
    )
    expect(response?.status).toBe(503)
    expect((await responseJson(response!)).error?.code).toBe('SERVICE_UNAVAILABLE')
    expect(fixture.calls).toEqual([
      'readPayment',
      'retrievePayment',
      'recordCapturedAmount',
      'createRefundRequest',
      'createProviderRefund',
    ])
  })

  it('returns an owner-scoped refund status from D1-04 without making a provider call', async () => {
    const fixture = createDependencies()
    const response = await handlePaymentRefundRequest(
      createRequest('/refunds/' + REFUND_ID, 'GET', undefined),
      CUSTOMER,
      env,
      fixture.dependencies,
    )
    const value = await responseJson(response!)
    expect(response?.status).toBe(200)
    expect(fixture.calls).toEqual(['readRefund'])
    expect(fixture.args.readRefund).toEqual({ customerId: CUSTOMER, refundId: REFUND_ID })
    expect(value.data).toMatchObject({ refund: persistedRefund, statusAuthority: 'W07_D1_04' })
    expect(response?.headers.get('cache-control')).toBe('no-store')
  })

  it('hides absent and foreign refund IDs behind the same not-found response', async () => {
    const fixture = createDependencies({
      readRefund: async () => {
        throw { code: 'RESOURCE_NOT_FOUND', status: 404 }
      },
    })
    const response = await handlePaymentRefundRequest(
      createRequest('/refunds/' + REFUND_ID, 'GET', undefined),
      CUSTOMER,
      env,
      fixture.dependencies,
    )
    expect(response?.status).toBe(503)
  })

  it('requires Idempotency-Key and rejects malformed paths, bodies and query parameters before provider access', async () => {
    const fixture = createDependencies()
    const missingKey = await handlePaymentRefundRequest(
      createRequest('/payments/' + PAYMENT_ID + '/refunds', 'POST', JSON.stringify({ amountMinor: 500 }), null),
      CUSTOMER, env, fixture.dependencies,
    )
    const malformed = await handlePaymentRefundRequest(
      createRequest('/payments/not-a-payment/refunds'),
      CUSTOMER, env, fixture.dependencies,
    )
    const query = await handlePaymentRefundRequest(
      createRequest('/payments/' + PAYMENT_ID + '/refunds?amount=500'),
      CUSTOMER, env, fixture.dependencies,
    )
    const invalidBody = await handlePaymentRefundRequest(
      createRequest('/payments/' + PAYMENT_ID + '/refunds', 'POST', JSON.stringify({ amountMinor: 0 })),
      CUSTOMER, env, fixture.dependencies,
    )
    expect(missingKey?.status).toBe(428)
    expect(malformed?.status).toBe(404)
    expect(query?.status).toBe(400)
    expect(invalidBody?.status).toBe(400)
    expect(fixture.calls).toHaveLength(0)
  })

  it('does not invoke provider APIs for unauthenticated, non-refundable or foreign-owned payments', async () => {
    const unauthenticated = createDependencies()
    const noPrincipal = await handlePaymentRefundRequest(createRequest(), '', env, unauthenticated.dependencies)
    expect(noPrincipal?.status).toBe(401)
    expect(unauthenticated.calls).toHaveLength(0)

    const foreign = createDependencies({
      readPayment: async () => {
        throw new Error('Payment not found')
      },
    })
    const foreignResponse = await handlePaymentRefundRequest(createRequest(), CUSTOMER, env, foreign.dependencies)
    expect(foreignResponse?.status).toBe(503)
    expect(foreign.calls).toEqual(['readPayment'])

    const notCaptured = createDependencies({
      readPayment: async () => ({ ...payment, status: 'processing' }),
    })
    const pendingResponse = await handlePaymentRefundRequest(createRequest(), CUSTOMER, env, notCaptured.dependencies)
    expect(pendingResponse?.status).toBe(409)
    expect(notCaptured.calls).toEqual(['readPayment'])
  })
})
