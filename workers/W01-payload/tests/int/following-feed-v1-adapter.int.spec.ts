import { describe, expect, it, vi } from 'vitest'
import w04Worker from '../../../W04-feed-search/src/index.js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('v1 following feed adapter and home timeline', () => {
  it('requires the W01 verified session principal and forwards the feed request through W04', () => {
    const route = read('src/app/api/v1/feed/following/route.ts')
    expect(route).toContain('resolveSocialPrincipal(request)')
    expect(route).toContain('callW04FollowingFeed')
    expect(route).toContain('enrichContentListAuthors(response)')
    expect(route).toContain("'/internal/feed/following?'")
    expect(route).toContain("'cache-control': 'no-store'")
    expect(route).not.toContain('cachedPublicGet')
    expect(route).not.toContain('X-LuckRead-Principal-User-Id')
  })

  it('keeps follow relationships in W05 and published-content projection in W03', () => {
    const w01Client = read('src/feed/w04-feed-client.ts')
    const w01Bindings = read('wrangler.jsonc')
    const w04Runtime = read('../W04-feed-search/src/index.ts')
    const w04Bindings = read('../W04-feed-search/wrangler.jsonc')
    expect(w01Client).toContain("W04_FEED?: W04FeedService")
    expect(w01Bindings).toContain('"binding": "W04_FEED"')
    expect(w04Runtime).toContain("'/internal/feed/following'")
    expect(w04Runtime).toContain('/internal/social/feed/following-authors')
    expect(w04Runtime).toContain('/internal/content/following-feed')
    expect(w04Runtime).toContain("'X-LuckRead-Caller': 'W04'")
    expect(w04Bindings).toContain('"binding": "W05_SOCIAL"')
    expect(w04Bindings).toContain('"binding": "W03_CONTENT"')
    expect(w04Bindings).not.toContain('d1_databases')
  })

  it('validates the bounded cursor and page-size query before forwarding', () => {
    const route = read('src/app/api/v1/feed/following/route.ts')
    expect(route).toContain('cursorValues.length > 1')
    expect(route).toContain('limitValues.length > 1')
    expect(route).toContain('cursor.length > 2048')
    expect(route).toContain('(?:[1-9]|[1-4][0-9]|50)')
  })

  it('uses the active server-backed home timeline and following-feed pagination', () => {
    const feed = read('src/app/(twitter-clone)/TwitterCloneHomeFeed.tsx')
    const page = read('src/app/(twitter-clone)/home/page.tsx')
    expect(feed).toContain("export type HomeFeedMode = 'for-you' | 'following'")
    expect(feed).toContain("feedMode !== 'following'")
    expect(feed).toContain("'/api/v1/feed/following?'")
    expect(feed).toContain('LuckReadSocialPostCard')
    expect(feed).toContain('presentation="x-timeline"')
    expect(feed).toContain('nextCursor')
    expect(feed).toContain('loadMore')
    expect(feed).toContain('candidateWindowTruncated')
    expect(page).toContain('<TwitterCloneHomeFeed key={feedMode} initialPage={initialPage} locale={locale} feedMode={feedMode} />')
  })
})

describe('W04 Following feed runtime boundary', () => {
  it('passes relationship IDs from W05 to W03 instead of querying contents from W05', async () => {
    const socialFetch = vi.fn(async () => Response.json({
      data: { items: [{ userId: 'creator-1' }], candidateWindowTruncated: false },
    }))
    const contentFetch = vi.fn(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input)
      expect(new URL(request.url).pathname).toBe('/internal/content/following-feed')
      return Response.json({ data: { items: [], nextCursor: null, hasMore: false } })
    })
    const response = await w04Worker.fetch(
      new Request('https://luckread-w04.internal/internal/feed/following?limit=6', {
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'w04-following-feed-test',
          'X-LuckRead-Principal-User-Id': 'viewer-1',
          'X-LuckRead-Principal-Layer': 'L1',
        },
      }),
      {
        AUTH013_W04_DERIVED_PROJECTION: {
          get: async (key: string, _type: 'json'): Promise<unknown> => {
            const userId = key.split(':').at(-1) ?? ''
            if (!['viewer-1', 'creator-1'].includes(userId)) return null
            return {
              schemaVersion: 1,
              resourceType: 'User',
              resourceId: userId,
              sourceAuthority: 'D1-01',
              sourceVersion: 1,
              eventId: 'evt_' + userId,
              projectionVersion: 1,
              accountState: 'ACTIVE',
              state: 'ACTIVE',
              deindex: false,
              createdAt: '2026-10-16T00:00:00.000Z',
              staleAfter: '2099-10-16T00:00:00.000Z',
              policyVersion: 'AUTH-013-v1',
            }
          },
          put: async (_key: string, _value: string): Promise<void> => undefined,
        },
        W05_SOCIAL: { fetch: socialFetch },
        W03_CONTENT: { fetch: contentFetch },
      },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toMatchObject({
      data: { items: [], hasMore: false, candidateWindowTruncated: false },
    })
    expect(socialFetch).toHaveBeenCalledTimes(1)
    expect(contentFetch).toHaveBeenCalledTimes(1)
  })
})

describe('W04 Following AUTH-013 eligibility', () => {
  it('excludes ineligible followed authors and denies a viewer whose account is banned', async () => {
    const record = (userId: string, accountState: 'ACTIVE' | 'RESTRICTED' | 'BANNED') => ({
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
    const projections = new Map<string, unknown>([
      ['auth013:projection:User:viewer-1', record('viewer-1', 'ACTIVE')],
      ['auth013:projection:User:creator-active', record('creator-active', 'ACTIVE')],
      ['auth013:projection:User:creator-restricted', record('creator-restricted', 'RESTRICTED')],
    ])
    const socialFetch = vi.fn(async () => Response.json({
      data: {
        items: [{ userId: 'creator-active' }, { userId: 'creator-restricted' }],
        candidateWindowTruncated: false,
      },
    }))
    const contentFetch = vi.fn(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input)
      const body = await request.json() as { ownerUserIds?: string[] }
      expect(body.ownerUserIds).toEqual(['creator-active'])
      return Response.json({ data: { items: [], nextCursor: null, hasMore: false } })
    })
    const env = {
      AUTH013_W04_DERIVED_PROJECTION: {
        get: async (key: string): Promise<unknown> => projections.get(key) ?? null,
        put: async (_key: string, _value: string): Promise<void> => undefined,
      },
      W05_SOCIAL: { fetch: socialFetch },
      W03_CONTENT: { fetch: contentFetch },
    }
    const request = () => new Request('https://luckread-w04.internal/internal/feed/following?limit=6', {
      headers: {
        'X-LuckRead-Caller': 'W01',
        'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Correlation-Id': 'w04-following-auth013-test',
        'X-LuckRead-Principal-User-Id': 'viewer-1',
        'X-LuckRead-Principal-Layer': 'L1',
      },
    })
    const allowed = await w04Worker.fetch(request(), env)
    expect(allowed.status).toBe(200)
    expect(contentFetch).toHaveBeenCalledTimes(1)

    projections.set('auth013:projection:User:viewer-1', record('viewer-1', 'BANNED'))
    const denied = await w04Worker.fetch(request(), env)
    expect(denied.status).toBe(403)
    expect(socialFetch).toHaveBeenCalledTimes(1)
  })
})
