import { describe, expect, it } from 'vitest'
import {
  confirmHyperswitchCustomerInitiatedSetupPayment,
  createHyperswitchCustomerInitiatedSetupIntent,
  createHyperswitchRefund,
  retrieveHyperswitchRefund,
  createHyperswitchMerchantInitiatedPayment,
  createHyperswitchPaymentIntent,
  HyperswitchClientError,
  retrieveCustomerBoundHyperswitchPaymentMethod,
  retrieveHyperswitchPayment,
  type HyperswitchClientConfig,
} from './hyperswitch-client.js'

const config: HyperswitchClientConfig = {
  environment: 'sandbox',
  apiKey: 'snd_test_server_api_key',
  expectedMerchantId: 'merchant_test',
}
const input = {
  paymentId: 'pay_mbabizu24mvu3mela5njyhpit4',
  amount: 1250,
  currency: 'USD',
  idempotencyKey: 'order_01J8J7K4M6N2Q9R8V5W3X1Z0',
}
const responsePayment = (overrides: Record<string, unknown> = {}) => ({
  payment_id: input.paymentId,
  merchant_id: 'merchant_test',
  amount: input.amount,
  currency: input.currency,
  status: 'requires_payment_method',
  client_secret: 'pay_test_secret_only',
  sdk_authorization: 'cHJvZmlsZV9pZD10ZXN0',
  ...overrides,
})
const jsonResponse = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...Object.fromEntries(new Headers(headers).entries()) },
  })
type CapturedCall = { url: string; init: RequestInit }
function fakeFetch(responseOrThrow: Response | Error) {
  const captured: CapturedCall[] = []
  const fetcher = (async (resource: RequestInfo | URL, init?: RequestInit) => {
    captured.push({ url: String(resource), init: init ?? {} })
    if (responseOrThrow instanceof Error) throw responseOrThrow
    return responseOrThrow
  }) as typeof fetch
  return { fetcher, captured }
}

describe('Hyperswitch server-side payment intent client', () => {
  it('creates only an unconfirmed payment intent using official sandbox API and server-side credentials', async () => {
    const fake = fakeFetch(jsonResponse(responsePayment()))
    const payment = await createHyperswitchPaymentIntent(config, input, fake.fetcher)

    expect(fake.captured).toHaveLength(1)
    expect(fake.captured[0].url).toBe('https://sandbox.hyperswitch.io/payments')
    expect(fake.captured[0].init.method).toBe('POST')
    const headers = new Headers(fake.captured[0].init.headers)
    expect(headers.get('api-key')).toBe(config.apiKey)
    expect(headers.get('Idempotency-Key')).toBe(input.idempotencyKey)
    expect(headers.get('content-type')).toBe('application/json')
    expect(JSON.parse(String(fake.captured[0].init.body))).toEqual({
      payment_id: input.paymentId,
      amount: input.amount,
      currency: input.currency,
      confirm: false,
    })
    expect(payment).toEqual({
      paymentId: input.paymentId,
      merchantId: 'merchant_test',
      amount: input.amount,
      currency: 'USD',
      status: 'requires_payment_method',
      clientSecret: 'pay_test_secret_only',
      sdkAuthorization: 'cHJvZmlsZV9pZD10ZXN0',
      paymentMethodId: null,
    })
  })

  it('uses the exact production host only when explicitly selected', async () => {
    const fake = fakeFetch(jsonResponse(responsePayment()))
    await createHyperswitchPaymentIntent({ ...config, environment: 'production' }, input, fake.fetcher)
    expect(fake.captured[0].url).toBe('https://api.hyperswitch.io/payments')
  })

  it('rejects missing/unknown environment and missing or malformed server API keys before fetch', async () => {
    for (const invalid of [
      { ...config, environment: undefined },
      { ...config, environment: 'https://evil.example' },
      { ...config, apiKey: undefined },
      { ...config, apiKey: ' key\nInjected: yes' },
      { ...config, apiKey: ' key-with-leading-space' },
      { ...config, expectedMerchantId: undefined },
      { ...config, expectedMerchantId: ' merchant_test' },
    ]) {
      const fake = fakeFetch(jsonResponse(responsePayment()))
      await expect(createHyperswitchPaymentIntent(invalid, input, fake.fetcher))
        .rejects.toMatchObject({ code: 'CONFIGURATION_INVALID' })
      expect(fake.captured).toHaveLength(0)
    }
  })

  it('rejects invalid payment ID, amount, currency and idempotency key before network I/O', async () => {
    const invalidInputs = [
      { ...input, paymentId: 'pay_short' },
      { ...input, amount: 0 },
      { ...input, amount: 1.5 },
      { ...input, amount: Number.MAX_SAFE_INTEGER + 1 },
      { ...input, currency: 'usd' },
      { ...input, currency: 'US' },
      { ...input, idempotencyKey: 'contains spaces' },
      { ...input, idempotencyKey: '' },
    ]
    for (const invalid of invalidInputs) {
      const fake = fakeFetch(jsonResponse(responsePayment()))
      await expect(createHyperswitchPaymentIntent(config, invalid, fake.fetcher))
        .rejects.toMatchObject({ code: 'REQUEST_INVALID' })
      expect(fake.captured).toHaveLength(0)
    }
  })

  it('rejects a provider response that mismatches payment ID, amount, currency, or unconfirmed status', async () => {
    for (const mismatch of [
      { payment_id: 'pay_aaaaaaaaaaaaaaaaaaaaaaaaaa' },
      { amount: input.amount + 1 },
      { currency: 'EUR' },
      { merchant_id: 'merchant_other' },
      { status: 'succeeded' },
      { status: 'requires_capture' },
    ]) {
      const fake = fakeFetch(jsonResponse(responsePayment(mismatch)))
      await expect(createHyperswitchPaymentIntent(config, input, fake.fetcher))
        .rejects.toMatchObject({ code: 'UPSTREAM_INVALID_RESPONSE' })
    }
  })

  it('does not expose provider rejection body or credential details to callers', async () => {
    const fake = fakeFetch(new Response('sensitive provider diagnostic', { status: 401 }))
    let thrown: unknown
    try {
      await createHyperswitchPaymentIntent(config, input, fake.fetcher)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(HyperswitchClientError)
    expect(thrown).toMatchObject({ code: 'UPSTREAM_REJECTED', upstreamStatus: 401 })
    expect(String(thrown)).not.toContain('sensitive provider diagnostic')
    expect(String(thrown)).not.toContain(config.apiKey)
  })

  it('normalizes transport failures without leaking exception details', async () => {
    const fake = fakeFetch(new Error('provider URL leaked secret value'))
    await expect(createHyperswitchPaymentIntent(config, input, fake.fetcher))
      .rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' })
  })

  it('rejects malformed or oversized successful responses', async () => {
    const badJson = fakeFetch(new Response('{not-json', { status: 200 }))
    await expect(createHyperswitchPaymentIntent(config, input, badJson.fetcher))
      .rejects.toMatchObject({ code: 'UPSTREAM_INVALID_RESPONSE' })

    const oversized = fakeFetch(new Response(JSON.stringify(responsePayment()), {
      status: 200,
      headers: { 'content-length': '999999' },
    }))
    await expect(createHyperswitchPaymentIntent(config, input, oversized.fetcher))
      .rejects.toMatchObject({ code: 'UPSTREAM_INVALID_RESPONSE' })

    const oversizedStream = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(32 * 1024))
        controller.enqueue(new Uint8Array(32 * 1024))
        controller.enqueue(new Uint8Array(1))
        controller.close()
      },
    }), { status: 200 })
    const streamed = fakeFetch(oversizedStream)
    await expect(createHyperswitchPaymentIntent(config, input, streamed.fetcher))
      .rejects.toMatchObject({ code: 'UPSTREAM_INVALID_RESPONSE' })
    for (const sdkAuthorization of ['', ' authorization ', 'bad\\nvalue', 'x'.repeat(4097)]) {
      const malformedSdk = fakeFetch(jsonResponse(responsePayment({ sdk_authorization: sdkAuthorization })))
      await expect(createHyperswitchPaymentIntent(config, input, malformedSdk.fetcher))
        .rejects.toMatchObject({ code: 'UPSTREAM_INVALID_RESPONSE' })
    }
  })

  it('creates an unconfirmed customer-present setup intent for later off-session use without claiming consent', async () => {
    const fake = fakeFetch(jsonResponse(responsePayment()))
    const setupInput = { ...input, customerId: 'cust_user_42' }
    const payment = await createHyperswitchCustomerInitiatedSetupIntent(config, setupInput, fake.fetcher)

    expect(fake.captured).toHaveLength(1)
    expect(fake.captured[0].url).toBe('https://sandbox.hyperswitch.io/payments')
    expect(fake.captured[0].init.method).toBe('POST')
    const headers = new Headers(fake.captured[0].init.headers)
    expect(headers.get('api-key')).toBe(config.apiKey)
    expect(headers.get('Idempotency-Key')).toBe(input.idempotencyKey)
    expect(JSON.parse(String(fake.captured[0].init.body))).toEqual({
      payment_id: input.paymentId,
      amount: input.amount,
      currency: input.currency,
      customer_id: setupInput.customerId,
      setup_future_usage: 'off_session',
      confirm: false,
    })
    expect(payment.status).toBe('requires_payment_method')
  })

  it('rejects invalid setup customer references and mismatched provider setup responses before accepting them', async () => {
    for (const customerId of ['', ' cust_user_42', 'cust_user_42\nInjected: yes', 'x'.repeat(257)]) {
      const fake = fakeFetch(jsonResponse(responsePayment()))
      await expect(createHyperswitchCustomerInitiatedSetupIntent(config, {
        ...input,
        customerId,
      }, fake.fetcher)).rejects.toMatchObject({ code: 'REQUEST_INVALID' })
      expect(fake.captured).toHaveLength(0)
    }

    for (const mismatch of [
      { payment_id: 'pay_aaaaaaaaaaaaaaaaaaaaaaaaaa' },
      { amount: input.amount + 1 },
      { currency: 'EUR' },
      { status: 'succeeded' },
    ]) {
      const fake = fakeFetch(jsonResponse(responsePayment(mismatch)))
      await expect(createHyperswitchCustomerInitiatedSetupIntent(config, {
        ...input,
        customerId: 'cust_user_42',
      }, fake.fetcher)).rejects.toMatchObject({ code: 'UPSTREAM_INVALID_RESPONSE' })
    }
  })

  it('confirms a setup intent through Hyperswitch with explicit online customer acceptance and provider token', async () => {
    const acceptedAt = '2026-10-28T15:30:00.000Z'
    const confirmationInput = {
      paymentId: input.paymentId,
      customerId: 'cust_user_42',
      amount: input.amount,
      currency: input.currency,
      paymentToken: 'provider_token_123',
      customerAcceptance: {
        acceptedAt,
        ipAddress: '192.0.2.12',
        userAgent: 'LuckRead-Test/1.0',
      },
    }
    const fake = fakeFetch(jsonResponse(responsePayment({
      status: 'succeeded',
      customer_id: confirmationInput.customerId,
      payment_method_id: 'pm_saved_123',
    })))
    const payment = await confirmHyperswitchCustomerInitiatedSetupPayment(config, confirmationInput, fake.fetcher)

    expect(fake.captured).toHaveLength(1)
    expect(fake.captured[0].url).toBe(`https://sandbox.hyperswitch.io/payments/${input.paymentId}/confirm`)
    expect(fake.captured[0].init.method).toBe('POST')
    const headers = new Headers(fake.captured[0].init.headers)
    expect(headers.get('api-key')).toBe(config.apiKey)
    const body = JSON.parse(String(fake.captured[0].init.body))
    expect(body).toEqual({
      payment_token: confirmationInput.paymentToken,
      customer_acceptance: {
        acceptance_type: 'online',
        accepted_at: acceptedAt,
        online: {
          ip_address: confirmationInput.customerAcceptance.ipAddress,
          user_agent: confirmationInput.customerAcceptance.userAgent,
        },
      },
    })
    expect(JSON.stringify(body)).not.toContain('card_number')
    expect(payment.status).toBe('succeeded')
    expect(payment.customerId).toBe(confirmationInput.customerId)
    expect(payment.paymentMethodId).toBe('pm_saved_123')
  })

  it('rejects invalid online acceptance and provider responses not bound to the setup customer before accepting confirmation', async () => {
    const base = {
      paymentId: input.paymentId,
      customerId: 'cust_user_42',
      amount: input.amount,
      currency: input.currency,
      paymentToken: 'provider_token_123',
      customerAcceptance: {
        acceptedAt: '2026-10-28T15:30:00.000Z',
        ipAddress: '192.0.2.12',
        userAgent: 'LuckRead-Test/1.0',
      },
    }
    for (const invalid of [
      { ...base, paymentToken: '' },
      { ...base, customerAcceptance: { ...base.customerAcceptance, acceptedAt: 'not-a-date' } },
      { ...base, customerAcceptance: { ...base.customerAcceptance, acceptedAt: '2026-02-31T15:30:00.000Z' } },
      { ...base, customerAcceptance: { ...base.customerAcceptance, acceptedAt: '2026-10-28T25:30:00.000Z' } },
      { ...base, customerAcceptance: { ...base.customerAcceptance, acceptedAt: '2026-10-28T15:30:00+99:00' } },
      { ...base, customerAcceptance: { ...base.customerAcceptance, ipAddress: '' } },
      { ...base, customerAcceptance: { ...base.customerAcceptance, userAgent: 'bad\nheader' } },
    ]) {
      const fake = fakeFetch(jsonResponse(responsePayment()))
      await expect(confirmHyperswitchCustomerInitiatedSetupPayment(config, invalid, fake.fetcher))
        .rejects.toMatchObject({ code: 'REQUEST_INVALID' })
      expect(fake.captured).toHaveLength(0)
    }

    for (const mismatch of [
      { customer_id: 'cust_another_user' },
      { payment_id: 'pay_aaaaaaaaaaaaaaaaaaaaaaaaaa' },
      { amount: input.amount + 1 },
      { currency: 'EUR' },
    ]) {
      const fake = fakeFetch(jsonResponse(responsePayment({
        status: 'succeeded',
        customer_id: base.customerId,
        payment_method_id: 'pm_saved_123',
        ...mismatch,
      })))
      await expect(confirmHyperswitchCustomerInitiatedSetupPayment(config, base, fake.fetcher))
        .rejects.toMatchObject({ code: 'UPSTREAM_INVALID_RESPONSE' })
    }
  })

  it('creates a customer-bound off-session recurring charge through Hyperswitch with a stable idempotency key', async () => {
    const fake = fakeFetch(jsonResponse(responsePayment({ status: 'succeeded' })))
    const mitInput = {
      ...input,
      customerId: 'cust_user_42',
      paymentMethodId: 'pm_saved_123',
    }
    const payment = await createHyperswitchMerchantInitiatedPayment(config, mitInput, fake.fetcher)

    expect(fake.captured).toHaveLength(1)
    expect(fake.captured[0].url).toBe('https://sandbox.hyperswitch.io/payments')
    expect(fake.captured[0].init.method).toBe('POST')
    const headers = new Headers(fake.captured[0].init.headers)
    expect(headers.get('api-key')).toBe(config.apiKey)
    expect(headers.get('Idempotency-Key')).toBe(input.idempotencyKey)
    expect(JSON.parse(String(fake.captured[0].init.body))).toEqual({
      payment_id: input.paymentId,
      amount: input.amount,
      currency: input.currency,
      customer_id: mitInput.customerId,
      confirm: true,
      off_session: true,
      recurring_details: { type: 'payment_method_id', data: mitInput.paymentMethodId },
    })
    expect(payment.status).toBe('succeeded')
  })

  it('rejects malformed customer/payment-method references and mismatched recurring-payment totals before accepting the result', async () => {
    for (const bad of [
      { customerId: '', paymentMethodId: 'pm_saved_123' },
      { customerId: 'cust_user_42', paymentMethodId: ' pm_saved_123' },
      { customerId: 'cust_user_42\nInjected: yes', paymentMethodId: 'pm_saved_123' },
      { customerId: 'cust_user_42', paymentMethodId: 'pm_saved_123'.repeat(30) },
    ]) {
      const fake = fakeFetch(jsonResponse(responsePayment()))
      await expect(createHyperswitchMerchantInitiatedPayment(config, {
        ...input,
        ...bad,
      }, fake.fetcher)).rejects.toMatchObject({ code: 'REQUEST_INVALID' })
      expect(fake.captured).toHaveLength(0)
    }

    const mismatched = fakeFetch(jsonResponse(responsePayment({ amount: input.amount + 1 })))
    await expect(createHyperswitchMerchantInitiatedPayment(config, {
      ...input,
      customerId: 'cust_user_42',
      paymentMethodId: 'pm_saved_123',
    }, mismatched.fetcher)).rejects.toMatchObject({ code: 'UPSTREAM_INVALID_RESPONSE' })
  })

  it('retrieves a provider payment by stable ID and accepts a final status for reconciliation', async () => {
    const fake = fakeFetch(jsonResponse(responsePayment({ status: 'succeeded' })))
    const payment = await retrieveHyperswitchPayment(config, input.paymentId, fake.fetcher)

    expect(fake.captured[0].url).toBe(`https://sandbox.hyperswitch.io/payments/${input.paymentId}`)
    expect(fake.captured[0].init.method).toBe('GET')
    expect(new Headers(fake.captured[0].init.headers).get('api-key')).toBe(config.apiKey)
    expect(payment.status).toBe('succeeded')
  })

  it('exposes a validated opaque payment_method_id from provider reconciliation responses', async () => {
    const saved = fakeFetch(jsonResponse(responsePayment({
      status: 'succeeded',
      payment_method_id: 'pm_saved_123',
    })))
    const payment = await retrieveHyperswitchPayment(config, input.paymentId, saved.fetcher)
    expect(payment.paymentMethodId).toBe('pm_saved_123')

    for (const invalidReference of [
      '',
      ' pm_saved_123',
      'pm_saved_123\nInjected: yes',
      'x'.repeat(257),
      42,
    ]) {
      const malformed = fakeFetch(jsonResponse(responsePayment({ payment_method_id: invalidReference })))
      await expect(retrieveHyperswitchPayment(config, input.paymentId, malformed.fetcher))
        .rejects.toMatchObject({ code: 'UPSTREAM_INVALID_RESPONSE' })
    }
  })

  it('returns a saved method only for a succeeded provider payment bound to the expected customer and commercial terms', async () => {
    const fetchInput = {
      paymentId: input.paymentId,
      customerId: 'cust_user_42',
      amount: input.amount,
      currency: input.currency,
    }
    const valid = fakeFetch(jsonResponse(responsePayment({
      status: 'succeeded',
      customer_id: fetchInput.customerId,
      payment_method_id: 'pm_saved_123',
    })))
    await expect(retrieveCustomerBoundHyperswitchPaymentMethod(config, fetchInput, valid.fetcher))
      .resolves.toEqual({
        paymentId: input.paymentId,
        customerId: fetchInput.customerId,
        paymentMethodId: 'pm_saved_123',
      })

    for (const mismatch of [
      { status: 'processing' },
      { customer_id: 'cust_other_user' },
      { amount: input.amount + 1 },
      { currency: 'EUR' },
      { payment_method_id: null },
    ]) {
      const invalid = fakeFetch(jsonResponse(responsePayment({
        status: 'succeeded',
        customer_id: fetchInput.customerId,
        payment_method_id: 'pm_saved_123',
        ...mismatch,
      })))
      await expect(retrieveCustomerBoundHyperswitchPaymentMethod(config, fetchInput, invalid.fetcher))
        .rejects.toMatchObject({ code: 'UPSTREAM_INVALID_RESPONSE' })
    }

    const invalidInput = fakeFetch(jsonResponse(responsePayment()))
    await expect(retrieveCustomerBoundHyperswitchPaymentMethod(config, {
      ...fetchInput,
      amount: 0,
    }, invalidInput.fetcher)).rejects.toMatchObject({ code: 'REQUEST_INVALID' })
    expect(invalidInput.captured).toHaveLength(0)
  })

  it('rejects invalid lookup IDs and a provider response for another payment', async () => {
    const invalid = fakeFetch(jsonResponse(responsePayment()))
    await expect(retrieveHyperswitchPayment(config, 'not-a-payment-id', invalid.fetcher))
      .rejects.toMatchObject({ code: 'REQUEST_INVALID' })
    expect(invalid.captured).toHaveLength(0)

    const mismatched = fakeFetch(jsonResponse(responsePayment({ payment_id: 'pay_aaaaaaaaaaaaaaaaaaaaaaaaaa' })))
    await expect(retrieveHyperswitchPayment(config, input.paymentId, mismatched.fetcher))
      .rejects.toMatchObject({ code: 'UPSTREAM_INVALID_RESPONSE' })
  })

  it('creates a provider refund with a stable merchant refund_id for idempotent retries', async () => {
    const refundId = 'ref_' + '1'.repeat(26)
    const body = {
      refund_id: refundId,
      payment_id: input.paymentId,
      amount: 600,
      currency: 'USD',
      status: 'pending',
      updated_at: '2026-10-30T10:00:00.000Z',
    }
    const fake = fakeFetch(jsonResponse(body))
    const result = await createHyperswitchRefund(config, {
      refundId,
      paymentId: input.paymentId,
      amount: 600,
      currency: 'USD',
      reason: 'Customer request',
    }, fake.fetcher)

    expect(fake.captured).toHaveLength(1)
    expect(fake.captured[0].url).toBe('https://sandbox.hyperswitch.io/refunds')
    expect(fake.captured[0].init.method).toBe('POST')
    expect(new Headers(fake.captured[0].init.headers).get('api-key')).toBe(config.apiKey)
    expect(JSON.parse(String(fake.captured[0].init.body))).toEqual({
      refund_id: refundId,
      payment_id: input.paymentId,
      amount: 600,
      reason: 'Customer request',
      refund_type: 'instant',
    })
    expect(result).toMatchObject({ refundId, paymentId: input.paymentId, amount: 600, currency: 'USD', status: 'pending' })
  })

  it('rejects invalid refund identifiers and provider responses that mismatch the stable refund request', async () => {
    const refundId = 'ref_' + '1'.repeat(26)
    const invalid = fakeFetch(jsonResponse({}))
    await expect(createHyperswitchRefund(config, {
      refundId: 'not-a-refund',
      paymentId: input.paymentId,
      amount: 100,
      currency: 'USD',
    }, invalid.fetcher)).rejects.toMatchObject({ code: 'REQUEST_INVALID' })
    expect(invalid.captured).toHaveLength(0)

    for (const mismatch of [
      { refund_id: 'ref_' + '2'.repeat(26) },
      { payment_id: 'pay_aaaaaaaaaaaaaaaaaaaaaaaaaa' },
      { amount: 601 },
      { currency: 'EUR' },
      { status: 'unknown' },
    ]) {
      const fake = fakeFetch(jsonResponse({
        refund_id: refundId,
        payment_id: input.paymentId,
        amount: 600,
        currency: 'USD',
        status: 'pending',
        ...mismatch,
      }))
      await expect(createHyperswitchRefund(config, {
        refundId,
        paymentId: input.paymentId,
        amount: 600,
        currency: 'USD',
      }, fake.fetcher)).rejects.toMatchObject({ code: 'UPSTREAM_INVALID_RESPONSE' })
    }
  })

  it('accepts a one-minor-unit partial refund without imposing a platform-wide minimum', async () => {
    const refundId = 'ref_' + '3'.repeat(26)
    const fake = fakeFetch(jsonResponse({
      refund_id: refundId,
      payment_id: input.paymentId,
      amount: 1,
      currency: 'USD',
      status: 'pending',
      updated_at: '2026-10-30T10:00:00.000Z',
    }))
    const result = await createHyperswitchRefund(config, {
      refundId,
      paymentId: input.paymentId,
      amount: 1,
      currency: 'USD',
    }, fake.fetcher)
    expect(result).toMatchObject({ refundId, amount: 1, status: 'pending' })
  })

  it('retrieves a previously submitted refund by stable refund_id for reconciliation', async () => {
    const refundId = 'ref_' + '1'.repeat(26)
    const fake = fakeFetch(jsonResponse({
      refund_id: refundId,
      payment_id: input.paymentId,
      amount: 600,
      currency: 'USD',
      status: 'succeeded',
      updated_at: '2026-10-30T10:00:00.000Z',
    }))
    const result = await retrieveHyperswitchRefund(config, {
      refundId,
      paymentId: input.paymentId,
      amount: 600,
      currency: 'USD',
    }, fake.fetcher)
    expect(fake.captured[0].url).toBe('https://sandbox.hyperswitch.io/refunds/' + refundId)
    expect(fake.captured[0].init.method).toBe('GET')
    expect(result.status).toBe('succeeded')
  })

  it('exposes only a validated captured amount when the provider payment retrieve includes it', async () => {
    const fake = fakeFetch(jsonResponse(responsePayment({
      status: 'succeeded',
      amount_received: 900,
    })))
    const payment = await retrieveHyperswitchPayment(config, input.paymentId, fake.fetcher)
    expect(payment.amountCaptured).toBe(900)

    for (const amountCaptured of [-1, 1.5, input.amount + 1, '900']) {
      const invalid = fakeFetch(jsonResponse(responsePayment({
        status: 'succeeded',
        amount_received: amountCaptured,
      })))
      await expect(retrieveHyperswitchPayment(config, input.paymentId, invalid.fetcher))
        .rejects.toMatchObject({ code: 'UPSTREAM_INVALID_RESPONSE' })
    }
  })

})
