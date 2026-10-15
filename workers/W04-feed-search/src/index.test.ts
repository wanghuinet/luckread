import { describe, expect, it, vi } from 'vitest'
import worker from './index.js'

const currentProjection = (userId: string, accountState = 'ACTIVE') => ({
  schemaVersion: 1,
  resourceType: 'User',
  resourceId: userId,
  sourceAuthority: 'D1-01',
  sourceVersion: 1,
  eventId: 'event_' + userId,
  projectionVersion: 1,
  accountState,
  state: ['FROZEN', 'SUSPENDED', 'BANNED', 'DELETION_PENDING', 'DELETED'].includes(accountState) ? 'PURGED' : 'ACTIVE',
  deindex: ['FROZEN', 'SUSPENDED', 'BANNED', 'DELETION_PENDING', 'DELETED'].includes(accountState),
  createdAt: new Date().toISOString(),
  staleAfter: new Date(Date.now() + 60_000).toISOString(),
  policyVersion: 'AUTH-013-v1',
})

const request = (pathname: string, headers: Record<string, string> = {}) =>
  new Request('https://luckread-w04.internal' + pathname, { headers })

const trustedHeaders = {
  'X-LuckRead-Caller': 'W01',
  'X-LuckRead-Transport-Version': '1.0',
  'X-LuckRead-Correlation-Id': 'following-feed-test',
  'X-LuckRead-Principal-User-Id': 'viewer_1',
}

describe('W04 Following feed serving', () => {
  it('checks current account-state projection, filters ineligible followed accounts, and queries W03 once', async () => {
    const projectionValues = new Map<string, unknown>([
      ['auth013:projection:User:viewer_1', currentProjection('viewer_1')],
      ['auth013:projection:User:author_1', currentProjection('author_1')],
      ['auth013:projection:User:author_2', currentProjection('author_2', 'BANNED')],
      ['auth013:projection:User:author_3', {
        ...currentProjection('author_3'),
        state: 'STALE',
        staleAfter: new Date(Date.now() - 60_000).toISOString(),
      }],
    ])
    const kv = {
      get: vi.fn(async (key: string) => projectionValues.get(key) ?? null),
      put: vi.fn(async () => undefined),
    }
    let candidateHeaders: Headers | null = null
    let contentHeaders: Headers | null = null
    let sentContentBody: Record<string, unknown> | null = null
    const w05 = {
      fetch: vi.fn(async (input: RequestInfo | URL) => {
        const req = new Request(input)
        candidateHeaders = req.headers
        expect(new URL(req.url).pathname).toBe('/internal/social/users/viewer_1/following-feed-candidates')
        return Response.json({ data: { userIds: ['author_1', 'author_2', 'author_3'], hasMore: true } })
      }),
    }
    const w03 = {
      fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = input instanceof Request ? input : new Request(input, init)
        contentHeaders = req.headers
        sentContentBody = await req.json() as Record<string, unknown>
        return Response.json({ data: { items: [{ id: 'post_1' }], nextCursor: 'opaque-cursor', hasMore: true } })
      }),
    }
    const response = await worker.fetch(
      request('/internal/feed/following?limit=10', trustedHeaders),
      {
        AUTH013_W04_DERIVED_PROJECTION: kv,
        W05_SOCIAL: w05,
        W03_CONTENT: w03,
      },
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        items: [{ id: 'post_1' }],
        nextCursor: 'opaque-cursor',
        hasMore: true,
        candidateWindowTruncated: true,
      },
    })
    expect(candidateHeaders?.get('X-LuckRead-Caller')).toBe('W04')
    expect(candidateHeaders?.get('X-LuckRead-Principal-User-Id')).toBe('viewer_1')
    expect(contentHeaders?.get('X-LuckRead-Caller')).toBe('W04')
    expect(sentContentBody).toEqual({
      ownerUserIds: ['author_1'],
      cursor: null,
      limit: 10,
    })
    expect(w05.fetch).toHaveBeenCalledTimes(1)
    expect(w03.fetch).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the viewer account-state projection is missing', async () => {
    const w05 = { fetch: vi.fn() }
    const w03 = { fetch: vi.fn() }
    const response = await worker.fetch(
      request('/internal/feed/following', trustedHeaders),
      {
        AUTH013_W04_DERIVED_PROJECTION: { get: async () => null, put: async () => undefined },
        W05_SOCIAL: w05,
        W03_CONTENT: w03,
      },
    )
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'ACCOUNT_STATE_PROJECTION_UNAVAILABLE' },
    })
    expect(w05.fetch).not.toHaveBeenCalled()
    expect(w03.fetch).not.toHaveBeenCalled()
  })

  it('rejects an untrusted caller before querying feed dependencies', async () => {
    const w05 = { fetch: vi.fn() }
    const response = await worker.fetch(
      request('/internal/feed/following', {
        ...trustedHeaders,
        'X-LuckRead-Caller': 'W04',
      }),
      {
        AUTH013_W04_DERIVED_PROJECTION: { get: async () => null, put: async () => undefined },
        W05_SOCIAL: w05,
      },
    )
    expect(response.status).toBe(403)
    expect(w05.fetch).not.toHaveBeenCalled()
  })
})
