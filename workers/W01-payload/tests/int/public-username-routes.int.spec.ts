import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('public username routes', () => {
  it('exposes the username profile route through the existing User authority', () => {
    const route = read('src/app/api/v1/users/by-username/[username]/route.ts')
    const profile = read('src/app/(frontend)/[username]/page.tsx')

    expect(route).toContain("from '@/auth/w02-user-profile-client'")
    expect(route).toContain("'/internal/account/profile/by-username?username='")
    expect(route).not.toContain("collection: 'users'")
    expect(route).not.toContain('getPayload')
    expect(route).toContain('cachedPublicGet')
    expect(route).toContain('enforcePublicReadRateLimit')
    expect(profile).toContain('/api/v1/users/by-username/')
    expect(profile).toContain("import UserProfilePage from '../users/[userId]/page'")
  })

  it('exposes the username article route without introducing another content authority', () => {
    const article = read('src/app/(frontend)/[username]/article/[contentId]/page.tsx')
    const user = read('src/app/(frontend)/users/[userId]/page.tsx')

    expect(article).toContain("import ContentDetailPage from '../../../content/[contentId]/page'")
    expect(article).toContain('Promise.resolve({ contentId })')
    expect(article).not.toContain('D1Database')
    expect(article).not.toContain('getPayload')
    expect(user).toContain("encodeURIComponent(profile!.username)")
    expect(user).toContain("item.contentType + '/'")
  })
})
