import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('v1 user profile social channels', () => {
  it('routes profile replies through the W05 public read adapter with validated pagination', () => {
    const route = read('src/app/api/v1/users/[userId]/replies/route.ts')
    expect(route).toContain("'/internal/social/users/' + encodeURIComponent(userId) + '/replies' + suffix")
    expect(route).toContain('callW05SocialPublic')
    expect(route).toContain('resolveOptionalCookieSocialPrincipal')
    expect(route).toContain('enforcePublicReadRateLimit')
    expect(route).toContain("method: 'GET'")
    expect(route).toContain("url.searchParams.getAll('cursor')")
    expect(route).toContain("url.searchParams.getAll('limit')")
    expect(route).not.toContain('getPayload(')
    expect(route).not.toContain('social_comments')
  })

  it('routes profile liked-content reads through W05 instead of querying D1 from W01', () => {
    const route = read('src/app/api/v1/users/[userId]/likes/route.ts')
    expect(route).toContain("'/internal/social/users/' + encodeURIComponent(userId) + '/likes' + suffix")
    expect(route).toContain('callW05SocialPublic')
    expect(route).toContain('resolveOptionalCookieSocialPrincipal')
    expect(route).toContain('enforcePublicReadRateLimit')
    expect(route).toContain("method: 'GET'")
    expect(route).toContain('cursor')
    expect(route).toContain('limit')
    expect(route).not.toContain('getPayload(')
    expect(route).not.toContain('interaction_likes')
  })

  it('keeps the frontend channels connected to the author-scoped read APIs', () => {
    const page = read('src/app/(frontend)/users/[userId]/page.tsx')
    expect(page).toContain("'/api/v1/users/' + encodeURIComponent(profile.id) + '/replies?limit=6'")
    expect(page).toContain("'/api/v1/users/' + encodeURIComponent(profile.id) + '/likes?limit=6'")
    expect(page).toContain('loadLikedContentDetails')
    expect(page).toContain('setReplies((current) => [...current, ...data.data.items])')
    expect(page).toContain("href={'/content/' + encodeURIComponent(reply.contentId)}")
  })
})
