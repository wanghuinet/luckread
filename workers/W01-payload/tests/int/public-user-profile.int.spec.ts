import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('public user profile', () => {
  it('exposes public follower and following list links on the author profile', () => {
    const page = read('src/app/(frontend)/users/[userId]/page.tsx')
    const followers = read('src/app/(frontend)/users/[userId]/followers/page.tsx')
    const following = read('src/app/(frontend)/users/[userId]/following/page.tsx')
    const list = read('src/app/(frontend)/users/[userId]/UserFollowList.tsx')

    expect(page).toContain('/followers')
    expect(page).toContain('/following')
    expect(followers).toContain('<UserFollowList direction="followers" userId={userId} />')
    expect(following).toContain('<UserFollowList direction="following" userId={userId} />')
    expect(list).toContain('/api/v1/users/')
    expect(list).toContain('limit: String(PAGE_SIZE)')
    expect(list).toContain('nextCursor')
    expect(list).toContain('加载更多')
    expect(list).toContain("href={'/users/' + encodeURIComponent(item.userId)}")
    expect(list).toContain('cache: \'no-store\'')
  })

  it('preserves the full return path when follow authentication expires', () => {
    const page = read('src/app/(frontend)/users/[userId]/page.tsx')
    expect(page).toContain("const returnTo = window.location.pathname + window.location.search + window.location.hash")
    expect(page).toContain("router.replace('/login?returnTo=' + encodeURIComponent(returnTo))")
  })

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
    expect(page).toContain("'Idempotency-Key': 'social-follow:' + crypto.randomUUID()")
    expect(page).toContain('/followers?limit=1')
    expect(page).toContain('/following?limit=1')
    expect(page).toContain('credentials: \'include\'')
    expect(page).toContain('关注作者')
    expect(page).toContain('profile?.avatar')
    expect(page).toContain('width={72}')
    expect(page).toContain('objectFit: \'cover\'')
    expect(page).toContain('/api/v1/contents?creatorId=')
    expect(page).toContain('加载更多作品')
    expect(page).toContain("href={'/content/' + encodeURIComponent(item.id)}")
  })
})

  it('renders existing work cover URLs as public thumbnails', () => {
    const page = read('src/app/(frontend)/users/[userId]/page.tsx')
    expect(page).toContain("src={item.coverRef}")
    expect(page).toContain("objectFit: 'cover'")
    expect(page).not.toContain("backgroundImage: 'linear-gradient(135deg")
  })

