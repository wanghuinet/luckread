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

  it('keeps feed serving in W04 and only binds W04 to the existing W05 social service', () => {
    const w01Client = read('src/feed/w04-feed-client.ts')
    const w01Bindings = read('wrangler.jsonc')
    const w04Runtime = read('../W04-feed-search/src/index.ts')
    const w04Bindings = read('../W04-feed-search/wrangler.jsonc')
    expect(w01Client).toContain("W04_FEED?: W04FeedService")
    expect(w01Bindings).toContain('"binding": "W04_FEED"')
    expect(w04Runtime).toContain("'/internal/feed/following'")
    expect(w04Runtime).toContain("'X-LuckRead-Caller': 'W04'")
    expect(w04Bindings).toContain('"binding": "W05_SOCIAL"')
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
  it('forwards only a bounded authenticated W01 request to W05 with the W04 transport identity', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ data: { items: [], nextCursor: null, hasMore: false }, requestId: 'req_feed_1' }),
    )
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
        W05_SOCIAL: { fetch },
      },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toMatchObject({ data: { items: [], hasMore: false } })
    expect(fetch).toHaveBeenCalledTimes(1)
    const forwarded = fetch.mock.calls[0]?.[0]
    expect(forwarded).toBeInstanceOf(Request)
    if (!(forwarded instanceof Request)) throw new Error('W04 did not forward a Request')
    const upstream = new URL(forwarded.url)
    expect(upstream.pathname).toBe('/internal/social/feed/following')
    expect(upstream.searchParams.get('limit')).toBe('6')
    expect(forwarded.headers.get('X-LuckRead-Caller')).toBe('W04')
    expect(forwarded.headers.get('X-LuckRead-Principal-User-Id')).toBe('viewer-1')
    expect(forwarded.headers.has('Cookie')).toBe(false)
  })

  it('denies spoofed callers and rejects duplicate or unbounded query parameters before calling W05', async () => {
    const fetch = vi.fn(async () => Response.json({ data: {} }))
    const env = {
      AUTH013_W04_DERIVED_PROJECTION: { get: async () => null, put: async () => undefined },
      W05_SOCIAL: { fetch },
    }
    const spoofed = await w04Worker.fetch(
      new Request('https://luckread-w04.internal/internal/feed/following?limit=6', {
        headers: {
          'X-LuckRead-Caller': 'browser',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'bad-caller',
          'X-LuckRead-Principal-User-Id': 'viewer-1',
        },
      }),
      env,
    )
    expect(spoofed.status).toBe(403)

    const duplicate = await w04Worker.fetch(
      new Request('https://luckread-w04.internal/internal/feed/following?limit=6&limit=7', {
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'duplicate-limit',
          'X-LuckRead-Principal-User-Id': 'viewer-1',
        },
      }),
      env,
    )
    expect(duplicate.status).toBe(422)

    const oversized = await w04Worker.fetch(
      new Request('https://luckread-w04.internal/internal/feed/following?limit=51', {
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'oversized-limit',
          'X-LuckRead-Principal-User-Id': 'viewer-1',
        },
      }),
      env,
    )
    expect(oversized.status).toBe(422)
    expect(fetch).not.toHaveBeenCalled()
  })
})
