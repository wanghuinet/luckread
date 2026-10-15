import { describe, expect, it, vi } from 'vitest'
import worker from './index.js'

const headers = {
  'X-LuckRead-Caller': 'W01',
  'X-LuckRead-Transport-Version': '1.0',
  'X-LuckRead-Correlation-Id': 'w04-following-feed-test',
  'X-LuckRead-Principal-User-Id': 'viewer-1',
  'X-LuckRead-Principal-Layer': 'L1',
}

describe('W04 following feed serving route', () => {
  it('validates W01 transport and forwards a private bounded request to W05', async () => {
    const fetch = vi.fn(async (_request: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ data: { items: [], nextCursor: null, hasMore: false }, requestId: 'req_feed_1' }),
    )
    const response = await worker.fetch(
      new Request('https://luckread-w04.internal/internal/feed/following?limit=6', { headers }),
      { AUTH013_W04_DERIVED_PROJECTION: { get: async () => null, put: async () => undefined }, W05_SOCIAL: { fetch } },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toMatchObject({ data: { items: [], hasMore: false } })
    expect(fetch).toHaveBeenCalledTimes(1)
    const upstream = new URL(String(fetch.mock.calls[0]?.[0]))
    expect(upstream.pathname).toBe('/internal/social/feed/following')
    expect(upstream.searchParams.get('limit')).toBe('6')
    expect(fetch.mock.calls[0]?.[0]).toBeInstanceOf(Request)
    const forwarded = fetch.mock.calls[0]?.[0] as Request
    expect(forwarded.headers.get('X-LuckRead-Caller')).toBe('W04')
    expect(forwarded.headers.get('X-LuckRead-Principal-User-Id')).toBe('viewer-1')
    expect(forwarded.headers.has('Cookie')).toBe(false)
  })

  it('rejects untrusted callers, missing principals, duplicate parameters, and invalid bounds', async () => {
    const fetch = vi.fn(async () => Response.json({ data: {} }))
    const env = { AUTH013_W04_DERIVED_PROJECTION: { get: async () => null, put: async () => undefined }, W05_SOCIAL: { fetch } }
    const noPrincipal = await worker.fetch(
      new Request('https://luckread-w04.internal/internal/feed/following?limit=6', {
        headers: { ...headers, 'X-LuckRead-Principal-User-Id': '' },
      }), env,
    )
    expect(noPrincipal.status).toBe(401)

    const spoofedCaller = await worker.fetch(
      new Request('https://luckread-w04.internal/internal/feed/following?limit=6', {
        headers: { ...headers, 'X-LuckRead-Caller': 'browser' },
      }), env,
    )
    expect(spoofedCaller.status).toBe(403)

    const duplicate = await worker.fetch(
      new Request('https://luckread-w04.internal/internal/feed/following?limit=6&limit=7', { headers }), env,
    )
    expect(duplicate.status).toBe(422)

    const oversized = await worker.fetch(
      new Request('https://luckread-w04.internal/internal/feed/following?limit=51', { headers }), env,
    )
    expect(oversized.status).toBe(422)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('fails closed when the W05 service binding is missing', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w04.internal/internal/feed/following?limit=6', { headers }),
    )
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } })
  })
})
