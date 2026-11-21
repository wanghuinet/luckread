import { describe, expect, it } from 'vitest'
import { readBoundedProviderWebhookBody } from '../../src/subscription/provider-webhook-body.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} } }, { status })

describe('shared provider webhook raw-body reader', () => {
  it('preserves original request bytes exactly', async () => {
    const bytes = new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x31, 0x7d, 0x0a])
    const request = new Request('https://api.luckread.com/api/v1/webhooks/revenuecat', {
      method: 'POST',
      body: bytes,
    })
    const result = await readBoundedProviderWebhookBody(request, errorResponse)
    expect(result instanceof Response).toBe(false)
    expect(Array.from(new Uint8Array(result as ArrayBuffer))).toEqual(Array.from(bytes))
  })

  it('rejects an invalid or oversized declared Content-Length before buffering', async () => {
    const invalid = new Request('https://api.luckread.com/api/v1/webhooks/revenuecat', {
      method: 'POST',
      headers: { 'content-length': 'unknown' },
      body: '{}',
    })
    const invalidResult = await readBoundedProviderWebhookBody(invalid, errorResponse)
    expect(invalidResult).toBeInstanceOf(Response)
    expect((invalidResult as Response).status).toBe(400)

    const tooLarge = new Request('https://api.luckread.com/api/v1/webhooks/revenuecat', {
      method: 'POST',
      headers: { 'content-length': String(1024 * 1024 + 1) },
      body: '{}',
    })
    const tooLargeResult = await readBoundedProviderWebhookBody(tooLarge, errorResponse)
    expect(tooLargeResult).toBeInstanceOf(Response)
    expect((tooLargeResult as Response).status).toBe(413)
  })

  it('enforces the byte cap while streaming even when Content-Length is absent or understated', async () => {
    const bytes = new Uint8Array(1024 * 1024 + 1)
    const request = new Request('https://api.luckread.com/api/v1/webhooks/revenuecat', {
      method: 'POST',
      body: bytes,
    })
    const result = await readBoundedProviderWebhookBody(request, errorResponse)
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(413)
  })

  it('rejects an empty request body', async () => {
    const request = new Request('https://api.luckread.com/api/v1/webhooks/revenuecat', {
      method: 'POST',
    })
    const result = await readBoundedProviderWebhookBody(request, errorResponse)
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(400)
  })
})
