import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('v1 following feed adapter and home timeline', () => {
  it('requires the W01 verified session principal and forwards only through W05', () => {
    const route = read('src/app/api/v1/feed/following/route.ts')
    expect(route).toContain('resolveSocialPrincipal(request)')
    expect(route).toContain('callW05Social')
    expect(route).toContain(\"'/internal/social/feed/following?'\")
    expect(route).toContain(\"'cache-control': 'no-store'\")
    expect(route).not.toContain('cachedPublicGet')
    expect(route).not.toContain('X-LuckRead-Principal-User-Id')
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
    expect(feed).toContain(\"useState<'forYou' | 'following'>('forYou')\")
    expect(feed).toContain(\"'/api/v1/feed/following?limit=6'\")
    expect(feed).toContain('role=\"tablist\"')
    expect(feed).toContain('role=\"tab\"')
    expect(feed).toContain('LuckReadSocialPostCard')
    expect(feed).toContain('creator-profile-tabs')
    expect(feed).toContain('nextCursor')
    expect(feed).toContain('loadMore')
  })
})
