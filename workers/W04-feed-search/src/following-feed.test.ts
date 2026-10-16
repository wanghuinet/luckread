import { describe, expect, it, vi } from 'vitest'
import worker from './index.js'

const headers = {
  'X-LuckRead-Caller': 'W01',
  'X-LuckRead-Transport-Version': '1.0',
  'X-LuckRead-Correlation-Id': 'w04-following-feed-test',
  'X-LuckRead-Principal-User-Id': 'viewer-1',
  'X-LuckRead-Principal-Layer': 'L1',
}

const projection = {
  get: async (_key: string, _type: 'json'): Promise<unknown> => null,
  put: async (_key: string, _value: string): Promise<void> => undefined,
}

describe('W04 Following feed serving route', () => {
  it('gets relationship candidates from W05 and published content from W03', async () => {
    const socialFetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input)
      expect(new URL(request.url).pathname).toBe('/internal/social/feed/following-authors')
      expect(request.headers.get('X-LuckRead-Caller')).toBe('W04')
      expect(request.headers.get('X-LuckRead-Principal-User-Id')).toBe('viewer-1')
      expect(request.headers.has('Cookie')).toBe(false)
      return Response.json({
        data: {
          items: [{ userId: 'creator-1' }, { userId: 'creator-2' }],
          candidateWindowTruncated: true,
        },
        requestId: 'req_social_1',
      })
    })
    const contentFetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input)
      const url = new URL(request.url)
      expect(url.pathname).toBe('/internal/content/following-feed')
      expect(request.method).toBe('POST')
      const payload = await request.json() as { creatorIds?: string[]; limit?: number }
      expect(payload.creatorIds).toEqual(['creator-1', 'creator-2'])
      expect(payload.limit).toBe(6)
      expect(request.headers.get('X-LuckRead-Caller')).toBe('W04')
      expect(request.headers.get('X-LuckRead-Principal-User-Id')).toBe('viewer-1')
      expect(request.headers.has('Cookie')).toBe(false)
      return Response.json({
        data: {
          items: [{ id: 'content-1', creatorId: 'creator-1', contentType: 'post', title: 'Hello' }],
          nextCursor: 'cursor_1',
          hasMore: true,
        },
        requestId: 'req_content_1',
      })
    })
    const response = await worker.fetch(
      new Request('https://luckread-w04.internal/internal/feed/following?limit=6', { headers }),
      {
        AUTH013_W04_DERIVED_PROJECTION: projection,
        W05_SOCIAL: { fetch: socialFetch },
        W03_CONTENT: { fetch: contentFetch },
      },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toMatchObject({
      data: {
        items: [{ id: 'content-1', creatorId: 'creator-1' }],
        hasMore: true,
        candidateWindowTruncated: true,
      },
    })
    expect(socialFetch).toHaveBeenCalledTimes(1)
    expect(contentFetch).toHaveBeenCalledTimes(1)
  })

  it('rejects untrusted transport, duplicate parameters, and out-of-range page sizes before service calls', async () => {
    const socialFetch = vi.fn(async () => Response.json({ data: { items: [] } }))
    const contentFetch = vi.fn(async () => Response.json({ data: { items: [] } }))
    const env = {
      AUTH013_W04_DERIVED_PROJECTION: projection,
      W05_SOCIAL: { fetch: socialFetch },
      W03_CONTENT: { fetch: contentFetch },
    }
    const spoofed = await worker.fetch(
      new Request('https://luckread-w04.internal/internal/feed/following?limit=6', {
        headers: { ...headers, 'X-LuckRead-Caller': 'browser' },
      }),
      env,
    )
    expect(spoofed.status).toBe(403)

    const duplicate = await worker.fetch(
      new Request('https://luckread-w04.internal/internal/feed/following?limit=6&limit=7', { headers }),
      env,
    )
    expect(duplicate.status).toBe(422)

    const oversized = await worker.fetch(
      new Request('https://luckread-w04.internal/internal/feed/following?limit=51', { headers }),
      env,
    )
    expect(oversized.status).toBe(422)
    expect(socialFetch).not.toHaveBeenCalled()
    expect(contentFetch).not.toHaveBeenCalled()
  })

  it('fails closed if either authoritative service binding is missing', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w04.internal/internal/feed/following?limit=6', { headers }),
      { AUTH013_W04_DERIVED_PROJECTION: projection, W05_SOCIAL: { fetch: async () => Response.json({ data: { items: [] } }) } },
    )
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } })
  })
})
