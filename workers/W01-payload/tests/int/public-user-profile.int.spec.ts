import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('public user profile', () => {
  it('returns only the intentionally public user fields', () => {
    const route = read('src/app/api/v1/users/[userId]/route.ts')
    expect(route).toContain("collection: 'users'")
    expect(route).toContain('overrideAccess: true')
    expect(route).toContain("username: typeof publicUser.username === 'string' ? publicUser.username : ''")
    expect(route).toContain("displayName: typeof publicUser.displayName === 'string' ? publicUser.displayName : null")
    expect(route).toContain("bio: typeof publicUser.bio === 'string' ? publicUser.bio : null")
    expect(route).toContain("avatar: typeof publicUser.avatar === 'string' ? publicUser.avatar : null")
    expect(route).not.toContain('email: true')
    expect(route).not.toContain('locale: true')
    expect(route).not.toContain('timezone: true')
  })

  it('supports author follow state without creating a second social authority', () => {
    const page = read('src/app/(frontend)/users/[userId]/page.tsx')
    expect(page).toContain('/api/v1/social/follows/')
    expect(page).toContain("method: isFollowing ? 'DELETE' : 'POST'")
    expect(page).toContain('/followers?limit=1')
    expect(page).toContain('/following?limit=1')
    expect(page).toContain('credentials: \'include\'')
    expect(page).toContain('关注作者')
  })
})
