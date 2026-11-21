import { describe, expect, it, vi } from 'vitest'
import worker from './index.js'

const headers = {
  'X-LuckRead-Caller': 'W01',
  'X-LuckRead-Transport-Version': '1.0',
  'X-LuckRead-Correlation-Id': 'w04-following-feed-test',
  'X-LuckRead-Principal-User-Id': 'viewer-1',
  'X-LuckRead-Principal-Layer': 'L1',
}

const projectionRows = new Map<string, unknown>()
const projectionRecord = (userId: string, accountState: 'ACTIVE' | 'RESTRICTED' | 'BANNED' = 'ACTIVE') => ({
  schemaVersion: 1,
  resourceType: 'User',
  resourceId: userId,
  sourceAuthority: 'D1-01',
  sourceVersion: 1,
  eventId: 'evt_' + userId,
  projectionVersion: 1,
  accountState,
  state: accountState === 'BANNED' ? 'PURGED' : 'ACTIVE',
  deindex: accountState === 'BANNED',
  createdAt: '2026-10-16T00:00:00.000Z',
  staleAfter: '2099-10-16T00:00:00.000Z',
  policyVersion: 'AUTH-013-v1',
})
const seedProjection = (...ids: string[]) => {
  projectionRows.clear()
  for (const id of ids) projectionRows.set('auth013:projection:User:' + id, projectionRecord(id))
}
const projection = {
  get: async (key: string, _type: 'json'): Promise<unknown> => projectionRows.get(key) ?? null,
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
      const payload = await request.json() as { ownerUserIds?: string[]; limit?: number }
      expect(payload.ownerUserIds).toEqual(['creator-1', 'creator-2'])
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
    seedProjection('viewer-1', 'creator-1', 'creator-2')
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

  it('denies an ineligible viewer and excludes followed authors whose account state is not currently eligible', async () => {
    seedProjection('viewer-1', 'creator-1', 'creator-2')
    projectionRows.set('auth013:projection:User:creator-2', projectionRecord('creator-2', 'RESTRICTED'))
    const socialFetch = vi.fn(async () => Response.json({
      data: { items: [{ userId: 'creator-1' }, { userId: 'creator-2' }], candidateWindowTruncated: false },
    }))
    const contentFetch = vi.fn(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input)
      const payload = await request.json() as { ownerUserIds?: string[] }
      expect(payload.ownerUserIds).toEqual(['creator-1'])
      return Response.json({ data: { items: [], nextCursor: null, hasMore: false } })
    })
    const allowed = await worker.fetch(
      new Request('https://luckread-w04.internal/internal/feed/following?limit=6', { headers }),
      {
        AUTH013_W04_DERIVED_PROJECTION: projection,
        W05_SOCIAL: { fetch: socialFetch },
        W03_CONTENT: { fetch: contentFetch },
      },
    )
    expect(allowed.status).toBe(200)
    expect(contentFetch).toHaveBeenCalledTimes(1)

    projectionRows.set('auth013:projection:User:viewer-1', projectionRecord('viewer-1', 'BANNED'))
    const denied = await worker.fetch(
      new Request('https://luckread-w04.internal/internal/feed/following?limit=6', { headers }),
      {
        AUTH013_W04_DERIVED_PROJECTION: projection,
        W05_SOCIAL: { fetch: socialFetch },
        W03_CONTENT: { fetch: contentFetch },
      },
    )
    expect(denied.status).toBe(403)
    expect(socialFetch).toHaveBeenCalledTimes(1)
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
    seedProjection('viewer-1')
    const response = await worker.fetch(
      new Request('https://luckread-w04.internal/internal/feed/following?limit=6', { headers }),
      { AUTH013_W04_DERIVED_PROJECTION: projection, W05_SOCIAL: { fetch: async () => Response.json({ data: { items: [] } }) } },
    )
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } })
  })
})
