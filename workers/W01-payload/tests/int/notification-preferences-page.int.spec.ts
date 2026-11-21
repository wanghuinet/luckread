import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('notification preferences page', () => {
  it('loads and saves only the existing cookie-backed W01 preference API', () => {
    const page = read('src/app/(twitter-clone)/me/notification-preferences/page.tsx')
    expect(page).toContain("'/api/v1/notification-preferences'")
    expect(page).toContain("method: 'PATCH'")
    expect(page).toContain("credentials: 'include'")
    expect(page).toContain("cache: 'no-store'")
    for (const key of ['follow', 'like', 'comment', 'mention']) {
      expect(page).toContain(key)
    }
  })

  it('reuses the X-style secondary layout and links from account settings', () => {
    const page = read('src/app/(twitter-clone)/me/notification-preferences/page.tsx')
    const profile = read('src/app/(twitter-clone)/me/profile/page.tsx')
    expect(page).toContain('TwitterCloneSecondaryPageLayout')
    expect(page).toContain('active="none"')
    expect(page).toContain("'/me/notification-preferences'")
    expect(profile).toContain('href="/me/notification-preferences"')
  })

  it('provides loading, error, retry and login-return handling', () => {
    const page = read('src/app/(twitter-clone)/me/notification-preferences/page.tsx')
    expect(page).toContain('aria-busy={loading || saving}')
    expect(page).toContain('setReloadVersion')
    expect(page).toContain("'/login?returnTo=' + encodeURIComponent(returnTo)")
    expect(page).toContain('role="status"')
    expect(page).toContain('role="alert"')
  })
})
