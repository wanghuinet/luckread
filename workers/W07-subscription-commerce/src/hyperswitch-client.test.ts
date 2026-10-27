import { describe, expect, it } from 'vitest'
import {
  createHyperswitchPaymentIntent,
  HyperswitchClientError,
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
      .rejects.toSatisfy(assertClientError('UPSTREAM_INVALID_RESPONSE'))

    const oversized = fakeFetch(new Response(JSON.stringify(responsePayment()), {
      status: 200,
      headers: { 'content-length': '999999' },
    }))
    await expect(createHyperswitchPaymentIntent(config, input, oversized.fetcher))
      .rejects.toSatisfy(assertClientError('UPSTREAM_INVALID_RESPONSE'))
  })

  it('retrieves a provider payment by stable ID and accepts a final status for reconciliation', async () => {
    const fake = fakeFetch(jsonResponse(responsePayment({ status: 'succeeded' })))
    const payment = await retrieveHyperswitchPayment(config, input.paymentId, fake.fetcher)

    expect(fake.captured[0].url).toBe(`https://sandbox.hyperswitch.io/payments/${input.paymentId}`)
    expect(fake.captured[0].init.method).toBe('GET')
    expect(new Headers(fake.captured[0].init.headers).get('api-key')).toBe(config.apiKey)
    expect(payment.status).toBe('succeeded')
  })

  it('rejects invalid lookup IDs and a provider response for another payment', async () => {
    const invalid = fakeFetch(jsonResponse(responsePayment()))
    await expect(retrieveHyperswitchPayment(config, 'not-a-payment-id', invalid.fetcher))
      .rejects.toSatisfy(assertClientError('REQUEST_INVALID'))
    expect(invalid.captured).toHaveLength(0)

    const mismatched = fakeFetch(jsonResponse(responsePayment({ payment_id: 'pay_aaaaaaaaaaaaaaaaaaaaaaaaaa' })))
    await expect(retrieveHyperswitchPayment(config, input.paymentId, mismatched.fetcher))
      .rejects.toSatisfy(assertClientError('UPSTREAM_INVALID_RESPONSE'))
  })
})
