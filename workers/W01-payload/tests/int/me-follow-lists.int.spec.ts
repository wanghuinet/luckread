import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('personal social relationship pages', () => {
  it('provides separate authenticated follower and following pages', () => {
    const followers = read('src/app/(frontend)/me/followers/page.tsx')
    const following = read('src/app/(frontend)/me/following/page.tsx')
    const component = read('src/app/(frontend)/me/MeFollowList.tsx')

    expect(followers).toContain('<MeFollowList direction="followers" />')
    expect(following).toContain('<MeFollowList direction="following" />')
    expect(component).toContain("fetch('/api/v1/users/me'")
    expect(component).toContain('/api/v1/users/')
    expect(component).toContain("'/' + direction")
    expect(component).toContain('nextCursor')
    expect(component).toContain('加载更多')
    expect(component).toContain("window.location.assign('/login?returnTo='")
    expect(component).toContain("credentials: 'include'")
    expect(component).toContain("href={'/users/' + encodeURIComponent(item.userId)}")
  })

  it('links the personal relationship pages from the account profile', () => {
    const profile = read('src/app/(frontend)/me/profile/page.tsx')

    expect(profile).toContain('href="/me/followers"')
    expect(profile).toContain('href="/me/following"')
  })

  it('keeps relationship lists on the existing Social API rather than adding a second authority', () => {
    const component = read('src/app/(frontend)/me/MeFollowList.tsx')

    expect(component).not.toContain('social_follow_relationships')
    expect(component).not.toContain('getPayload(')
    expect(component).toContain("cache: 'no-store'")
    expect(component).toContain('PAGE_SIZE = 20')
  })
})
