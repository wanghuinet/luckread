import { describe, expect, it } from 'vitest'
import {
  parseRevenueCatWebhookEnvelope,
  verifyRevenueCatAuthorization,
  verifyRevenueCatWebhookSignature,
} from './revenuecat-webhook-signature.js'

const SECRET = 'test-revenuecat-webhook-signing-secret'
const NOW_MS = 1_793_300_000_000

function bodyFor(event: Record<string, unknown> = {}) {
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
      transaction_id: 'GPA.1234-5678',
      original_transaction_id: 'GPA.1234-5678',
      entitlement_ids: ['creator_gold'],
      subscriber_attributes: { email: { value: 'private@example.test' } },
      ...event,
    },
  }
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function signatureFor(body: ArrayBuffer, secret = SECRET, timestamp = Math.floor(NOW_MS / 1000)) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const prefix = new TextEncoder().encode(String(timestamp) + '.')
  const bytes = new Uint8Array(prefix.byteLength + body.byteLength)
  bytes.set(prefix)
  bytes.set(new Uint8Array(body), prefix.byteLength)
  const digest = await crypto.subtle.sign('HMAC', key, bytes)
  const hex = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
  return \`t=\${timestamp},v1=\${hex}\`
}

describe('RevenueCat webhook authentication and parsing', () => {
  it('compares the configured dashboard Authorization value exactly', () => {
    expect(verifyRevenueCatAuthorization('luckread-webhook-secret', 'luckread-webhook-secret')).toBe(true)
    expect(verifyRevenueCatAuthorization('Bearer luckread-webhook-secret', 'luckread-webhook-secret')).toBe(false)
    expect(verifyRevenueCatAuthorization(null, 'luckread-webhook-secret')).toBe(false)
    expect(verifyRevenueCatAuthorization('x', '')).toBe(false)
  })

  it('verifies HMAC-SHA256 over timestamp plus exact raw bytes', async () => {
    const body = bodyFor()
    const signature = await signatureFor(body)
    await expect(verifyRevenueCatWebhookSignature(body, signature, SECRET, NOW_MS)).resolves.toBe(true)

    const changed = body.slice(0)
    new Uint8Array(changed)[changed.byteLength - 2] ^= 1
    await expect(verifyRevenueCatWebhookSignature(changed, signature, SECRET, NOW_MS)).resolves.toBe(false)
    await expect(verifyRevenueCatWebhookSignature(body, signature, 'wrong-secret', NOW_MS)).resolves.toBe(false)
  })

  it('rejects missing, malformed and stale signatures when HMAC is enabled', async () => {
    const body = bodyFor()
    const current = Math.floor(NOW_MS / 1000)
    const stale = await signatureFor(body, SECRET, current - 301)
    await expect(verifyRevenueCatWebhookSignature(body, null, SECRET, NOW_MS)).resolves.toBe(false)
    await expect(verifyRevenueCatWebhookSignature(body, 't=bad,v1=abc', SECRET, NOW_MS)).resolves.toBe(false)
    await expect(verifyRevenueCatWebhookSignature(body, stale, SECRET, NOW_MS)).resolves.toBe(false)
  })

  it('accepts new provider event types and fields without storing subscriber attributes', () => {
    const body = bodyFor({
      type: 'A_FUTURE_EVENT_TYPE',
      new_provider_field: { canChange: true },
      subscriber_attributes: { email: { value: 'must-not-be-stored' } },
    })
    const event = parseRevenueCatWebhookEnvelope(body, new Set(['app_luckread_android']))
    expect(event.eventType).toBe('A_FUTURE_EVENT_TYPE')
    expect(event.productId).toBe('creator.gold:monthly-v1')
    expect(event.eventDataJson).toContain('creator.gold:monthly-v1')
    expect(event.eventDataJson).not.toContain('subscriber_attributes')
    expect(event.eventDataJson).not.toContain('must-not-be-stored')
    expect(event.eventDataJson).not.toContain('new_provider_field')
  })

  it('rejects an app ID outside the explicit app allowlist', () => {
    expect(() => parseRevenueCatWebhookEnvelope(bodyFor(), new Set(['another-app'])))
      .toThrow('WEBHOOK_REJECTED')
  })

  it('parses dashboard TEST events without relying on event-specific purchase fields', () => {
    const body = bodyFor({
      type: 'TEST',
      app_user_id: undefined,
      product_id: undefined,
      transaction_id: undefined,
      original_transaction_id: undefined,
    })
    const event = parseRevenueCatWebhookEnvelope(body, new Set(['app_luckread_android']))
    expect(event.eventType).toBe('TEST')
    expect(event.appUserId).toBeNull()
    expect(event.productId).toBeNull()
  })
})
