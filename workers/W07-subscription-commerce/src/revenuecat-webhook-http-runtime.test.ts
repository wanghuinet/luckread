import { describe, expect, it, vi } from 'vitest'
import { handleRevenueCatWebhookRequest } from './revenuecat-webhook-http-runtime.js'

const AUTHORIZATION = 'revenuecat-dashboard-webhook-secret'
const SIGNING_SECRET = 'revenuecat-hmac-signing-secret'
const NOW_MS = 1_793_300_000_000
const NOW_SECONDS = Math.floor(NOW_MS / 1000)

function makeBody(event: Record<string, unknown> = {}) {
  const payload = {
    api_version: '1.0',
    event: {
      id: 'evt_0000000000000000000001',
      type: 'INITIAL_PURCHASE',
      app_id: 'app_luckread_android',
      event_timestamp_ms: NOW_MS,
      app_user_id: 'user_123',
      product_id: 'creator.gold:monthly-v1',
      store: 'PLAY_STORE',
      environment: 'SANDBOX',
      ...event,
    },
  }
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function sign(body: ArrayBuffer) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SIGNING_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const prefix = new TextEncoder().encode(String(NOW_SECONDS) + '.')
  const bytes = new Uint8Array(prefix.byteLength + body.byteLength)
  bytes.set(prefix)
  bytes.set(new Uint8Array(body), prefix.byteLength)
  const signature = await crypto.subtle.sign('HMAC', key, bytes)
  const hex = Array.from(new Uint8Array(signature), (value) => value.toString(16).padStart(2, '0')).join('')
  return `t=${NOW_SECONDS},v1=${hex}`
}

function request(body: ArrayBuffer, headers: Record<string, string> = {}) {
  return new Request('https://luckread-w07.internal/internal/webhooks/revenuecat', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-LuckRead-Caller': 'W01',
      'X-LuckRead-Transport-Version': '1.0',
      'X-LuckRead-Correlation-Id': 'correlation_123',
      Authorization: AUTHORIZATION,
      ...headers,
    },
    body,
  })
}

const envBase = {
  D1_04: {} as D1Database,
  REVENUECAT_WEBHOOK_AUTHORIZATION: AUTHORIZATION,
  REVENUECAT_ALLOWED_APP_IDS: 'app_luckread_android',
}

const receipt = {
  outcome: 'RECEIVED' as const,
  eventId: 'evt_0000000000000000000001',
  receiptId: 'rcevt_123',
  payloadSha256: 'a'.repeat(64),
}

describe('RevenueCat private W07 webhook receiver', () => {
  it('always checks dashboard Authorization and persists before acknowledging', async () => {
    const body = makeBody()
    const receive = vi.fn(async (_db, event, rawBody) => {
      expect(event.eventId).toBe('evt_0000000000000000000001')
      expect(rawBody).toEqual(body)
      return receipt
    })
    const response = await handleRevenueCatWebhookRequest(
      request(body),
      envBase,
      { receive, nowMs: () => NOW_MS },
    )
    expect(response?.status).toBe(200)
    expect(receive).toHaveBeenCalledOnce()
    const json = await response!.json() as { data: { outcome: string; entitlementApplied: boolean } }
    expect(json.data.outcome).toBe('RECEIVED')
    expect(json.data.entitlementApplied).toBe(false)
  })

  it('supports RevenueCat Authorization-only configuration when dashboard HMAC is disabled', async () => {
    const body = makeBody()
    const receive = vi.fn(async () => receipt)
    const response = await handleRevenueCatWebhookRequest(
      request(body),
      envBase,
      { receive },
    )
    expect(response?.status).toBe(200)
    expect(receive).toHaveBeenCalledOnce()
  })

  it('requires valid HMAC when a signing secret is configured', async () => {
    const body = makeBody()
    const response = await handleRevenueCatWebhookRequest(
      request(body, {
        'X-RevenueCat-Webhook-Signature': 't=1793300000,v1=' + '0'.repeat(64),
      }),
      { ...envBase, REVENUECAT_WEBHOOK_SIGNING_SECRET: SIGNING_SECRET },
      { receive: vi.fn(async () => receipt), nowMs: () => NOW_MS },
    )
    expect(response?.status).toBe(401)
  })

  it('accepts a valid RevenueCat HMAC signature when signing is enabled', async () => {
    const body = makeBody()
    const signature = await sign(body)
    const receive = vi.fn(async () => receipt)
    const response = await handleRevenueCatWebhookRequest(
      request(body, { 'X-RevenueCat-Webhook-Signature': signature }),
      { ...envBase, REVENUECAT_WEBHOOK_SIGNING_SECRET: SIGNING_SECRET },
      { receive, nowMs: () => NOW_MS },
    )
    expect(response?.status).toBe(200)
    expect(receive).toHaveBeenCalledOnce()
  })

  it('rejects an invalid dashboard Authorization value before reading or persisting', async () => {
    const body = makeBody()
    const receive = vi.fn(async () => receipt)
    const response = await handleRevenueCatWebhookRequest(
      request(body, { Authorization: 'wrong-secret' }),
      envBase,
      { receive },
    )
    expect(response?.status).toBe(401)
    expect(receive).not.toHaveBeenCalled()
  })

  it('rejects calls without the trusted W01 Service Binding envelope', async () => {
    const body = makeBody()
    const receive = vi.fn(async () => receipt)
    const incoming = new Request('https://luckread-w07.internal/internal/webhooks/revenuecat', {
      method: 'POST',
      headers: { Authorization: AUTHORIZATION },
      body,
    })
    const response = await handleRevenueCatWebhookRequest(incoming, envBase, { receive })
    expect(response?.status).toBe(403)
    expect(receive).not.toHaveBeenCalled()
  })

  it('returns 200 for provider TEST without inserting a purchase receipt or applying entitlement', async () => {
    const body = makeBody({ type: 'TEST' })
    const receive = vi.fn(async () => receipt)
    const response = await handleRevenueCatWebhookRequest(
      request(body),
      envBase,
      { receive },
    )
    expect(response?.status).toBe(200)
    expect(receive).not.toHaveBeenCalled()
    const json = await response!.json() as { data: { outcome: string; entitlementApplied: boolean } }
    expect(json.data.outcome).toBe('TEST_ACKNOWLEDGED')
    expect(json.data.entitlementApplied).toBe(false)
  })

  it('returns 503 when required configuration is missing and 413 over the body cap', async () => {
    const body = makeBody()
    const unconfigured = await handleRevenueCatWebhookRequest(
      request(body),
      { ...envBase, REVENUECAT_WEBHOOK_AUTHORIZATION: '' },
    )
    expect(unconfigured?.status).toBe(503)

    const tooLarge = await handleRevenueCatWebhookRequest(
      request(body, { 'content-length': String(1024 * 1024 + 1) }),
      envBase,
    )
    expect(tooLarge?.status).toBe(413)
  })

  it('returns 503 rather than acknowledging when receipt persistence fails', async () => {
    const body = makeBody()
    const receive = vi.fn(async () => { throw new Error('database unavailable') })
    const response = await handleRevenueCatWebhookRequest(request(body), envBase, { receive })
    expect(response?.status).toBe(503)
  })
})
