import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('Cloudflare edge-first D1 reduction adapters', () => {
  it('fronts anonymous public content reads with the Edge Cache helper', () => {
    const list = read('src/app/api/v1/contents/route.ts')
    const detail = read('src/app/api/v1/contents/[contentId]/route.ts')
    expect(list).toContain('withPublicEdgeCache')
    expect(detail).toContain('withPublicEdgeCache')
    expect(detail).toContain('principal ? await load()')
  })

  it('fronts anonymous public social reads with the Edge Cache helper', () => {
    const comments = read('src/app/api/v1/contents/[contentId]/comments/route.ts')
    const followers = read('src/app/api/v1/users/[userId]/followers/route.ts')
    const following = read('src/app/api/v1/users/[userId]/following/route.ts')
    expect(comments).toContain('withPublicEdgeCache')
    expect(followers).toContain('withPublicEdgeCache')
    expect(following).toContain('withPublicEdgeCache')
  })

  it('fronts public user profiles with the Edge Cache helper', () => {
    const profile = read('src/app/api/v1/users/[userId]/route.ts')
    expect(profile).toContain('withPublicEdgeCache')
    expect(profile).toContain("collection: 'users'")
  })

  it('keeps authenticated interaction status behind auth before using scoped cache', () => {
    const likes = read('src/app/api/v1/interactions/likes/route.ts')
    const bookmarks = read('src/app/api/v1/interactions/bookmarks/route.ts')
    for (const route of [likes, bookmarks]) {
      expect(route).toContain('resolveCookieSocialPrincipal')
      expect(route).toContain('withScopedEdgeCache')
      expect(route).toContain('invalidateScopedEdgeCache')
      expect(route).toContain("if (principal instanceof Response) return principal")
    }
  })
})
