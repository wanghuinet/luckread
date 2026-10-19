import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('X-style notifications page', () => {
  const page = read('src/app/(twitter-clone)/notifications/page.tsx')
  const shell = read('src/app/(twitter-clone)/TwitterCloneSecondaryPageLayout.tsx')
  const home = read('src/app/(twitter-clone)/home/page.tsx')
  const w05Runtime = read('../../workers/W05-social/src/social-closure-runtime.ts')
  const w05Worker = read('../../workers/W05-social/src/index.ts')
  const apiContract = read('../../contracts/openapi/v1/openapi.yaml')

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

  it('resolves actor names and avatars through the existing public-profile cache', () => {
    expect(page).toContain("getCachedPublicProfile(id)")
    expect(page).toContain('const [actorProfiles, setActorProfiles]')
    expect(page).toContain('requestedActorIdsRef')
    expect(page).toContain('actorProfile?.displayName?.trim()')
    expect(page).toContain('actorProfile?.username?.trim()')
    expect(page).toContain('actorProfile?.avatar?.trim()')
    expect(page).toContain("'/users/' + encodeURIComponent(item.actorUserId)")
    expect(page).toContain('href={message.actorHref}')
    expect(page).toContain('message.actorHandle !== message.actor')
    expect(page).toContain('next/image')
    expect(page).toContain('unoptimized')
    expect(page).not.toContain('notifications.module.css')
  })

  it('filters the notification timeline to mentions through the existing W05 authority', () => {
    expect(page).toContain("type NotificationFilter = 'all' | 'mentions'")
    expect(page).toContain("params.set('type', 'MENTION')")
    expect(page).toContain('role="tablist"')
    expect(page).toContain("setFilter('mentions')")
    expect(page).toContain('labels.emptyMentions')
    expect(w05Worker).toContain("url.searchParams.get('type')")
    expect(w05Runtime).toContain("notification_type = ?")
    expect(w05Runtime).toContain("NOTIFICATION_TYPES.includes")
    expect(apiContract).toContain('description: Optional notification type filter.')
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
