import { describe, expect, it } from 'vitest'
import { verifyHyperswitchWebhookSignature } from './hyperswitch-webhook-signature.js'

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

  it('rejects a digest signed with a different secret', async () => {
    const rawBody = toArrayBuffer(new TextEncoder().encode(payload))
    const signature = await sign(rawBody, 'wrong-secret')

    await expect(verifyHyperswitchWebhookSignature(rawBody, signature, secret)).resolves.toBe(false)
  })
})
