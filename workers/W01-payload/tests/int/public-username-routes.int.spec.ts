import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('public username routes', () => {
  it('resolves @username through the existing public User authority', () => {
    const route = read('src/app/api/v1/users/by-username/[username]/route.ts')
    const profile = read('src/app/(frontend)/@[username]/page.tsx')

    expect(route).toContain("collection: 'users'")
    expect(route).toContain("where: { username: { equals: username } }")
    expect(route).toContain('overrideAccess: true')
    expect(route).toContain('cachedPublicGet')
    expect(route).toContain('enforcePublicReadRateLimit')
    expect(profile).toContain('/api/v1/users/by-username/')
    expect(profile).toContain("import UserProfilePage from '../users/[userId]/page'")
  })

  it('keeps the canonical article URL on the existing published content authority', () => {
    const article = read('src/app/(frontend)/@[username]/article/[contentId]/page.tsx')

    expect(article).toContain("import ContentDetailPage from '../../../content/[contentId]/page'")
    expect(article).toContain('Promise.resolve({ contentId })')
    expect(article).not.toContain('D1Database')
    expect(article).not.toContain('getPayload')
  })
})
