import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('Twitter Clone follow-list UI reuse with LuckRead social authority', () => {
  it('uses one responsive presentation row for public and personal relationship lists', () => {
    const row = read('src/app/(frontend)/users/TwitterCloneFollowRow.tsx')
    const styles = read('src/app/(frontend)/users/TwitterCloneFollowRow.module.css')
    const publicList = read('src/app/(frontend)/users/[userId]/UserFollowList.tsx')
    const personalList = read('src/app/(frontend)/me/MeFollowList.tsx')

    expect(row).toContain('profileHref = \'/users/\' + encodeURIComponent(userId)')
    expect(row).toContain('dateTime={followedAt}')
    expect(row).toContain('{action}')
    expect(row).not.toContain('/api/v1/')
    expect(row).not.toContain('firebase/')
    expect(styles).toContain('@media (max-width: 560px)')
    expect(styles).toContain('prefers-reduced-motion')
    expect(publicList).toContain("import TwitterCloneFollowRow from '../TwitterCloneFollowRow'")
    expect(personalList).toContain("import TwitterCloneFollowRow from '../users/TwitterCloneFollowRow'")
    expect(publicList).toContain('<TwitterCloneFollowRow')
    expect(personalList).toContain('<TwitterCloneFollowRow')
  })

  it('keeps public relationship reads on the existing W05-backed paginated endpoints', () => {
    const list = read('src/app/(frontend)/users/[userId]/UserFollowList.tsx')

    expect(list).toContain("'/api/v1/users/' + encodeURIComponent(userId) + '/' + direction + '?' + params.toString()")
    expect(list).toContain("credentials: 'omit'")
    expect(list).toContain("params.set('cursor', cursor)")
    expect(list).toContain('setNextCursor(data.data.nextCursor)')
    expect(list).toContain('setHasMore(data.data.hasMore)')
    expect(list).toContain('activeRequestRef.current?.abort()')
  })

  it('preserves login redirects and idempotent unfollow mutations in the personal list', () => {
    const list = read('src/app/(frontend)/me/MeFollowList.tsx')

    expect(list).toContain("fetchJson<ProfileResponse>('/api/v1/users/me'")
    expect(list).toContain("window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))")
    expect(list).toContain("'/api/v1/social/follows/' + encodeURIComponent(targetUserId)")
    expect(list).toContain("method: 'DELETE'")
    expect(list).toContain("'Idempotency-Key': 'social-unfollow:' + crypto.randomUUID()")
    expect(list).toContain('onClick={() => void unfollow(item.userId)}')
    expect(list).toContain('hasMore && nextCursor')
  })

  it('retains the upstream MIT attribution without importing Firebase implementations', () => {
    const notice = read('src/app/(frontend)/users/TWITTER_CLONE_FOLLOW_ATTRIBUTION.md')
    const row = read('src/app/(frontend)/users/TwitterCloneFollowRow.tsx')

    expect(notice).toContain('Copyright (c) 2022 ccrsxx')
    expect(notice).toContain('MIT License')
    expect(notice).toContain('No Firebase/Auth/Firestore code is copied.')
    expect(row).toContain('UserCard/UserCards')
  })
})
