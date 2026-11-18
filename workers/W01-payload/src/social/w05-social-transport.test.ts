import { describe, expect, it, vi } from 'vitest'

import { createW05SocialCaller } from './w05-social-transport.js'

describe('W01 to W05 social transport', () => {
  it('forwards bounded batch payloads over the internal Service Binding with principal identity', async () => {
    const captured: { request?: Request } = {}
    const caller = createW05SocialCaller(async () => ({
      fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        captured.request = input instanceof Request ? input : new Request(input, init)
        return Response.json({ data: { items: [] }, requestId: 'w05-batch-test' })
      }),
    }))
    const response = await caller({
      request: new Request('https://api.luckread.com/api/v1/contents/social/batch', {
        method: 'POST',
        headers: { 'X-LuckRead-Correlation-Id': 'social-batch-transport-test' },
      }),
      pathname: '/internal/social/contents/summary-batch',
      method: 'POST',
      principal: { userId: 'viewer-1', layer: 'L2', verified: true },
      body: { contentIds: ['content-1', 'content-2'] },
    })
    expect(response.status).toBe(200)
    const forwarded = captured.request as Request
    expect(forwarded.method).toBe('POST')
    expect(new URL(forwarded.url).pathname).toBe('/internal/social/contents/summary-batch')
    expect(forwarded.headers.get('X-LuckRead-Caller')).toBe('W01')
    expect(forwarded.headers.get('X-LuckRead-Principal-User-Id')).toBe('viewer-1')
    expect(forwarded.headers.get('X-LuckRead-Correlation-Id')).toBe('social-batch-transport-test')
    expect(forwarded.headers.get('content-type')).toContain('application/json')
    await expect(forwarded.json()).resolves.toEqual({ contentIds: ['content-1', 'content-2'] })
  })
})
