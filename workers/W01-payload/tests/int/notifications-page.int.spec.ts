import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('X-style notifications page', () => {
  const page = read('src/app/(twitter-clone)/notifications/page.tsx')
  const shell = read('src/app/(twitter-clone)/TwitterCloneSecondaryPageLayout.tsx')
  const home = read('src/app/(twitter-clone)/home/page.tsx')

  it('is reachable from the homepage sidebar and uses the shared X-style page shell', () => {
    expect(home).toContain('<TwitterCloneSecondaryPageLayout locale={locale} title={copy.home.home} active="home">')
    expect(shell).toContain("{ key: 'notifications', href: '/notifications', icon: 'bell' }")
    expect(page).toContain('TwitterCloneSecondaryPageLayout')
    expect(page).toContain('active="notifications"')
    expect(shell).toContain("href: '/notifications'")
    expect(shell).toContain('TwitterCloneSidebarProfile locale={locale}')
    expect(shell).toContain('<TwitterClonePostComposerModal />')
  })

  it('loads authenticated cursor-paginated notifications from the existing W01 API', () => {
    expect(page).toContain("'/api/v1/notifications?'")
    expect(page).toContain("new URLSearchParams({ limit: '20' })")
    expect(page).toContain("params.set('cursor', cursor)")
    expect(page).toContain("credentials: 'include'")
    expect(page).toContain("cache: 'no-store'")
    expect(page).toContain("response.status === 401")
    expect(page).toContain("encodeURIComponent('/notifications')")
  })

  it('marks a single notification and all notifications read through existing endpoints', () => {
    expect(page).toContain("'/api/v1/notifications/' + encodeURIComponent(item.id) + '/read'")
    expect(page).toContain("'/api/v1/notifications/read-all'")
    expect(page).toContain("setUnreadCount((count) => Math.max(0, count - 1))")
    expect(page).toContain('setUnreadCount(0)')
  })

  it('links comment-target notifications back to their containing published content', () => {
    expect(page).toContain("item.targetType === 'comment'")
    expect(page).toContain("typeof item.payload?.contentId === 'string'")
    expect(page).toContain("'/content/' + encodeURIComponent(contentTargetId)")
  })

  it('keeps notification UI on LuckRead auth and API boundaries without upstream backend code or bespoke CSS', () => {
    expect(page).not.toContain('firebase/')
    expect(page).not.toContain('tweetsCollection')
    expect(page).not.toContain('notifications.module.css')
    expect(page).not.toContain('styles.css')
  })
})
