import { describe, expect, it, vi } from 'vitest'
import worker from './index.js'

const headers = {
  'X-LuckRead-Caller': 'W01',
  'X-LuckRead-Transport-Version': '1.0',
  'X-LuckRead-Correlation-Id': 'w04-search-test',
  'X-LuckRead-Rate-Key': 'ip:192.0.2.10',
}

describe('W04 public content search route', () => {
  it('forwards a bounded public query to W03 over the internal transport', async () => {
    const contentFetch = vi.fn(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input)
      expect(request.method).toBe('POST')
      expect(new URL(request.url).pathname).toBe('/internal/content/search')
      expect(request.headers.get('X-LuckRead-Caller')).toBe('W04')
      expect(request.headers.get('X-LuckRead-Rate-Key')).toBe('ip:192.0.2.10')
      expect(request.headers.has('Authorization')).toBe(false)
      expect(request.headers.has('Cookie')).toBe(false)
      await expect(request.json()).resolves.toEqual({ q: 'LuckRead', cursor: null, limit: 10 })
      return Response.json({
        data: { items: [{ id: 'content-1', title: 'LuckRead launch' }], nextCursor: null, hasMore: false },
        requestId: 'req_search_1',
      })
    })
    const response = await worker.fetch(
      new Request('https://luckread-w04.internal/internal/search/contents?q=LuckRead&limit=10', { headers }),
      { W03_CONTENT: { fetch: contentFetch } },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toMatchObject({
      data: { items: [{ id: 'content-1' }], nextCursor: null, hasMore: false },
    })
    expect(contentFetch).toHaveBeenCalledTimes(1)
  })

  it('rejects caller spoofing, credentials, invalid query parameters and invalid page size', async () => {
    const contentFetch = vi.fn(async () => Response.json({ data: { items: [], nextCursor: null, hasMore: false } }))
    const env = { W03_CONTENT: { fetch: contentFetch } }
    const denied = await worker.fetch(new Request(
      'https://luckread-w04.internal/internal/search/contents?q=hello',
      { headers: { ...headers, 'X-LuckRead-Caller': 'browser' } },
    ), env)
    expect(denied.status).toBe(403)

    const credentials = await worker.fetch(new Request(
      'https://luckread-w04.internal/internal/search/contents?q=hello',
      { headers: { ...headers, Authorization: 'Bearer untrusted' } },
    ), env)
    expect(credentials.status).toBe(403)

    const duplicate = await worker.fetch(new Request(
      'https://luckread-w04.internal/internal/search/contents?q=one&q=two',
      { headers },
    ), env)
    expect(duplicate.status).toBe(422)

    const invalidLimit = await worker.fetch(new Request(
      'https://luckread-w04.internal/internal/search/contents?q=hello&limit=51',
      { headers },
    ), env)
    expect(invalidLimit.status).toBe(422)
    expect(contentFetch).not.toHaveBeenCalled()
  })

  it('fails closed when W03 is not bound and rejects non-GET methods', async () => {
    const missing = await worker.fetch(
      new Request('https://luckread-w04.internal/internal/search/contents?q=hello', { headers }),
      {},
    )
    expect(missing.status).toBe(503)
    const method = await worker.fetch(
      new Request('https://luckread-w04.internal/internal/search/contents?q=hello', { method: 'POST', headers }),
      { W03_CONTENT: { fetch: async () => Response.json({ data: { items: [], nextCursor: null, hasMore: false } }) } },
    )
    expect(method.status).toBe(405)
  })
})
