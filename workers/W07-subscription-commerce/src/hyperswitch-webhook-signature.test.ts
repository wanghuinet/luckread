import { describe, expect, it } from 'vitest'
import { parseHyperswitchWebhookEnvelope, verifyHyperswitchWebhookSignature } from './hyperswitch-webhook-signature.js'

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

async function sign(rawBody: ArrayBuffer, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign('HMAC', key, rawBody)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

describe('Hyperswitch webhook signature verification', () => {
  const secret = 'test-only-payment-response-hash-key'
  const payload = '{ "event_id":"evt_123", "type":"payment_succeeded" }'

  it('accepts the correct HMAC-SHA512 signature for the exact raw request bytes', async () => {
    const rawBody = toArrayBuffer(new TextEncoder().encode(payload))
    const signature = await sign(rawBody, secret)

    await expect(verifyHyperswitchWebhookSignature(rawBody, signature, secret)).resolves.toBe(true)
  })

  it('accepts uppercase hexadecimal digests without changing the signed request bytes', async () => {
    const rawBody = toArrayBuffer(new TextEncoder().encode(payload))
    const signature = await sign(rawBody, secret)

    await expect(verifyHyperswitchWebhookSignature(rawBody, signature.toUpperCase(), secret)).resolves.toBe(true)
  })

  it('rejects a body altered by even one byte', async () => {
    const original = toArrayBuffer(new TextEncoder().encode(payload))
    const signature = await sign(original, secret)
    const alteredBytes = new Uint8Array(original.slice(0))
    alteredBytes[alteredBytes.length - 2] ^= 1

    await expect(verifyHyperswitchWebhookSignature(toArrayBuffer(alteredBytes), signature, secret)).resolves.toBe(false)
  })

  it('rejects a semantically equivalent but re-serialized JSON body', async () => {
    const original = toArrayBuffer(new TextEncoder().encode(payload))
    const signature = await sign(original, secret)
    const compactJson = toArrayBuffer(new TextEncoder().encode(JSON.stringify(JSON.parse(payload))))

    await expect(verifyHyperswitchWebhookSignature(compactJson, signature, secret)).resolves.toBe(false)
  })

  it('fails closed for missing signatures, malformed digests, and missing secrets', async () => {
    const rawBody = toArrayBuffer(new TextEncoder().encode(payload))
    const signature = await sign(rawBody, secret)

    await expect(verifyHyperswitchWebhookSignature(rawBody, null, secret)).resolves.toBe(false)
    await expect(verifyHyperswitchWebhookSignature(rawBody, 'not-a-digest', secret)).resolves.toBe(false)
    await expect(verifyHyperswitchWebhookSignature(rawBody, 'g'.repeat(128), secret)).resolves.toBe(false)
    await expect(verifyHyperswitchWebhookSignature(rawBody, signature, null)).resolves.toBe(false)
    await expect(verifyHyperswitchWebhookSignature(rawBody, signature, '   ')).resolves.toBe(false)
  })

  it('rejects request bodies larger than the 1 MiB verifier ceiling', async () => {
    const oversizedBody = new Uint8Array(1024 * 1024 + 1).buffer
    await expect(verifyHyperswitchWebhookSignature(oversizedBody, '0'.repeat(128), secret)).resolves.toBe(false)
  })

  it('rejects a digest signed with a different secret', async () => {
    const rawBody = toArrayBuffer(new TextEncoder().encode(payload))
    const signature = await sign(rawBody, 'wrong-secret')

    await expect(verifyHyperswitchWebhookSignature(rawBody, signature, secret)).resolves.toBe(false)
  })
})


describe('Hyperswitch webhook envelope parsing', () => {
  const envelope = {
    merchant_id: 'merchant_luckread_test',
    event_id: 'evt_test_123',
    event_type: 'payment_succeeded',
    content: {
      type: 'payment_details',
      object: { payment_id: 'pay_test_123', status: 'succeeded', amount: 1200, currency: 'USD' },
    },
    timestamp: '2026-10-27T10:00:00Z',
    processor_merchant_id: null,
  }

  const bytes = (value: string): ArrayBuffer => toArrayBuffer(new TextEncoder().encode(value))
  const EXPECTED_MERCHANT_ID = 'merchant_luckread_test'
  const parseEnvelope = (rawBody: ArrayBuffer, expectedMerchantId: string | null = EXPECTED_MERCHANT_ID) =>
    parseHyperswitchWebhookEnvelope(rawBody, expectedMerchantId)

  it('parses a documented v1 envelope and exposes only normalized envelope fields', () => {
    const parsed = parseEnvelope(bytes(JSON.stringify(envelope)))
    expect(parsed).toEqual({
      merchantId: 'merchant_luckread_test',
      eventId: 'evt_test_123',
      eventType: 'payment_succeeded',
      contentType: 'payment_details',
      resource: { payment_id: 'pay_test_123', status: 'succeeded', amount: 1200, currency: 'USD' },
      timestamp: '2026-10-27T10:00:00Z',
      processorMerchantId: null,
    })
  })

  it('allows absent optional timestamp and processor merchant id', () => {
    const { timestamp: _timestamp, processor_merchant_id: _processorMerchantId, ...withoutOptional } = envelope
    expect(parseEnvelope(bytes(JSON.stringify(withoutOptional)))).toMatchObject({
      merchantId: 'merchant_luckread_test',
      eventId: 'evt_test_123',
      eventType: 'payment_succeeded',
      contentType: 'payment_details',
    })
  })

  it('rejects invalid JSON, invalid UTF-8, and non-object JSON', () => {
    expect(parseEnvelope(bytes('{'))).toBeNull()
    expect(parseEnvelope(bytes('[]'))).toBeNull()
    expect(parseEnvelope(toArrayBuffer(new Uint8Array([0xff, 0xfe])))).toBeNull()
  })

  it('rejects events for a different merchant or when the expected merchant is missing', () => {
    expect(parseEnvelope(bytes(JSON.stringify({ ...envelope, merchant_id: 'merchant_other' })))).toBeNull()
    expect(parseEnvelope(bytes(JSON.stringify(envelope)), null)).toBeNull()
    expect(parseEnvelope(bytes(JSON.stringify(envelope)), '   ')).toBeNull()
  })

  it('rejects missing or whitespace-padded required identifiers', () => {
    for (const modified of [
      { ...envelope, merchant_id: '' },
      { ...envelope, merchant_id: ' merchant_luckread_test' },
      { ...envelope, event_id: '' },
      { ...envelope, event_type: '' },
    ]) {
      expect(parseEnvelope(bytes(JSON.stringify(modified)))).toBeNull()
    }
  })

  it('rejects event types and content variants not admitted by the documented v1 schema', () => {
    expect(parseEnvelope(bytes(JSON.stringify({ ...envelope, event_type: 'payment_succeeded_fake' })))).toBeNull()
    expect(parseEnvelope(bytes(JSON.stringify({
      ...envelope, content: { ...envelope.content, type: 'unknown_details' },
    })))).toBeNull()
    expect(parseEnvelope(bytes(JSON.stringify({
      ...envelope, content: { ...envelope.content, object: [] },
    })))).toBeNull()
  })

  it('rejects request bodies larger than the 1 MiB parser ceiling', () => {
    expect(parseEnvelope(new Uint8Array(1024 * 1024 + 1).buffer)).toBeNull()
  })

  it('rejects invalid timestamps and malformed optional processor merchant identifiers', () => {
    expect(parseEnvelope(bytes(JSON.stringify({ ...envelope, timestamp: 'yesterday' })))).toBeNull()
    expect(parseEnvelope(bytes(JSON.stringify({ ...envelope, processor_merchant_id: 12 })))).toBeNull()
    expect(parseEnvelope(bytes(JSON.stringify({ ...envelope, processor_merchant_id: ' merchant ' })))).toBeNull()
  })
})
