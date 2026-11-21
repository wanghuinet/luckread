import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('blocked-user management on the reused X social surface', () => {
  const page = read('src/app/(frontend)/me/BlockedUsersPage.tsx')
  const route = read('src/app/(twitter-clone)/me/blocked/page.tsx')
  const row = read('src/app/(frontend)/users/TwitterCloneFollowRow.tsx')
  const profileSettings = read('src/app/(twitter-clone)/me/profile/page.tsx')

  it('loads a private cursor-paginated list through the W01 endpoint', () => {
    expect(page).toContain("'/api/v1/interactions/blocks?'")
    expect(page).toContain("new URLSearchParams({ limit: String(PAGE_SIZE) })")
    expect(page).toContain("params.set('cursor', cursor)")
    expect(page).toContain("credentials: 'include'")
    expect(page).toContain("cache: 'no-store'")
    expect(page).toContain('response.status === 401')
    expect(page).toContain('setAuthRequired(true)')
    expect(route).toContain('BlockedUsersPage')
  })

  it('uses the shared X timeline row and utility classes without bespoke CSS', () => {
    expect(page).toContain("import TwitterCloneFollowRow from '../users/TwitterCloneFollowRow'")
    expect(page).toContain('presentation="x-timeline"')
    expect(page).toContain('dateLabel={labels.blockedSince}')
    expect(page).toContain('<TwitterCloneSecondaryPageLayout locale={locale} title={labels.title} active="none">')
    expect(page).not.toContain('.module.css')
    expect(page).not.toContain('styles.')
    expect(row).toContain('dateLabel?: string')
  })

  it('unblocks by target user ID with idempotency and removes the row after success', () => {
    expect(page).toContain("'/api/v1/interactions/blocks/' + encodeURIComponent(targetUserId)")
    expect(page).toContain("method: 'DELETE'")
    expect(page).toContain("'Idempotency-Key': 'social-block-remove:' + crypto.randomUUID()")
    expect(page).toContain('current.items.filter((item) => item.targetUserId !== targetUserId)')
  })

  it('makes the page discoverable from account settings', () => {
    expect(profileSettings).toContain('href="/me/blocked"')
    expect(profileSettings).toContain('{copy.blocked}')
  })
})
