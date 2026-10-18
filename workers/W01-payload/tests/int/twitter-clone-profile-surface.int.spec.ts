import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('Twitter Clone profile UI reuse on LuckRead public profile', () => {
  it('renders the upstream-inspired profile cover/avatar/details/stats as a reusable surface', () => {
    const header = read('src/app/(frontend)/users/[userId]/TwitterCloneProfileHeader.tsx')
    const page = read('src/app/(frontend)/users/[userId]/page.tsx')

    expect(page).toContain("import TwitterCloneProfileHeader from './TwitterCloneProfileHeader'")
    expect(page).toContain('<TwitterCloneProfileHeader')
    expect(page).toContain('profile={profile!}')
    expect(page).toContain('actions={')
    expect(header).toContain('bg-light-line-reply xs:h-48 sm:h-52')
    expect(header).toContain('aspect-square w-24 -translate-y-1/2')
    expect(header).toContain('id="creator-profile-title"')
    expect(header).toContain("'Profile statistics'")
    expect(header).toContain('profile.bio?.trim() ? profile.bio : <span')
    expect(header).not.toContain('/api/v1/')
    expect(header).not.toContain('firebase/')
  })

  it('uses a reusable Twitter-style profile channel nav while content loads remain in the page', () => {
    const nav = read('src/app/(frontend)/users/[userId]/TwitterCloneProfileNav.tsx')
    const page = read('src/app/(frontend)/users/[userId]/page.tsx')

    expect(page).toContain("import TwitterCloneProfileNav from './TwitterCloneProfileNav'")
    expect(page).toContain('<TwitterCloneProfileNav')
    expect(page).toContain('onSelect={(value) => { void reloadContents(value) }}')
    expect(nav).toContain('role="tablist"')
    expect(nav).toContain('aria-selected={active}')
    expect(nav).toContain('onSelect(type)')
    expect(page).toContain("'/api/v1/contents?'")
    expect(page).toContain("'/api/v1/social/follows/'")
  })

  it('keeps profile relation and moderation mutations on LuckRead APIs and retains MIT notice', () => {
    const page = read('src/app/(frontend)/users/[userId]/page.tsx')
    const notice = read('src/app/(frontend)/users/[userId]/TWITTER_CLONE_ATTRIBUTION.md')

    expect(page).toContain("method: isFollowing ? 'DELETE' : 'POST'")
    expect(page).toContain("const relationPath = action === 'block' ? 'blocks' : 'mutes'")
    expect(page).toContain("targetType: 'profile'")
    expect(page).toContain('applySafetyAction(\'block\')')
    expect(page).toContain('applySafetyAction(\'mute\')')
    expect(notice).toContain('Copyright (c) 2022 ccrsxx')
    expect(notice).toContain('MIT License')
    expect(notice).toContain('No Firebase/Auth/Firestore logic is copied.')
  })
  it('routes the main profile item to the signed-in public username page and keeps editing separate', () => {
    const shell = read('src/app/(twitter-clone)/TwitterCloneSecondaryPageLayout.tsx')
    const profileLink = read('src/app/(twitter-clone)/TwitterCloneSidebarPublicProfileLink.tsx')
    const editor = read('src/app/(twitter-clone)/me/profile/page.tsx')
    const publicProfile = read('src/app/(frontend)/users/[userId]/page.tsx')

    expect(shell).toContain("import TwitterCloneSidebarPublicProfileLink from './TwitterCloneSidebarPublicProfileLink'")
    expect(shell).toContain('<TwitterCloneSidebarPublicProfileLink locale={locale} />')
    expect(shell).not.toContain("{ key: 'profile', href: '/me/profile', icon: 'user' }")
    expect(profileLink).toContain("fetchJson<CurrentProfile>('/api/v1/users/me'")
    expect(profileLink).toContain("setHref('/' + encodeURIComponent(data.username))")
    expect(profileLink).toContain("href={href}")
    expect(editor).toContain('active="editProfile"')
    expect(publicProfile).toContain('TwitterCloneSecondaryPageLayout locale={locale} title={name} active="profile"')
    expect(publicProfile).toContain('href="/me/profile"')
  })

  it('keeps the central profile column shrinkable within the three-column desktop shell', () => {
    const shell = read('src/app/(twitter-clone)/TwitterCloneSecondaryPageLayout.tsx')
    const page = read('src/app/(frontend)/users/[userId]/page.tsx')
    const styles = read('src/app/(frontend)/styles.css')

    expect(shell).toContain('w-full min-w-0 max-w-xl')
    expect(page).toContain('<section className="flex min-w-0 w-full flex-col pb-20">')
    expect(styles).toContain('.creator-profile-works { width: 100%; min-width: 0; min-height: 260px; }')
  })

  it('reserves mobile navigation clearance without adding a large desktop blank area', () => {
    const shell = read('src/app/(twitter-clone)/TwitterCloneSecondaryPageLayout.tsx')

    expect(shell).toContain('pb-32 dark:border-dark-border xs:pb-8')
    expect(shell).not.toContain('xs:pb-96')
  })

})
