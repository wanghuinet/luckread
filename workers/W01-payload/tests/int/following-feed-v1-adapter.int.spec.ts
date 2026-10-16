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
    expect(w04Runtime).toContain("'/internal/social/feed/following-authors'")
    expect(w04Runtime).toContain("'/internal/content/following-feed'")
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

  it('switches the home timeline while reusing existing LuckRead cards and styles', () => {
    const feed = read('src/app/(frontend)/HomeContentFeed.tsx')
    expect(feed).toContain("useState<'forYou' | 'following'>('forYou')")
    expect(feed).toContain("'/api/v1/feed/following?limit=6'")
    expect(feed).toContain('role="tablist"')
    expect(feed).toContain('role="tab"')
    expect(feed).toContain('LuckReadSocialPostCard')
    expect(feed).toContain('creator-profile-tabs')
    expect(feed).toContain('nextCursor')
    expect(feed).toContain('loadMore')
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
        AUTH013_W04_DERIVED_PROJECTION: { get: async (_key: string, _type: 'json'): Promise<unknown> => null, put: async (_key: string, _value: string): Promise<void> => undefined },
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
