import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('Twitter-clone homepage reuse', () => {
  it('uses the clone landing for public visitors and preserves the creator-host entry', async () => {
    const [page, landing, layout] = await Promise.all([
      readFile('src/app/(twitter-clone)/page.tsx', 'utf8'),
      readFile('src/app/(twitter-clone)/TwitterCloneLanding.tsx', 'utf8'),
      readFile('src/app/(twitter-clone)/layout.tsx', 'utf8'),
    ])

    expect(page).toContain("if (host === 'mp.luckread.com') return <CreatorDomainHome />")
    expect(page).toContain("if (principal?.active) redirect('/home')")
    expect(page).toContain('return <TwitterCloneLanding locale={normalizePublicLocale(localeCookie)} />')
    expect(landing).toContain('copy.landing.happeningNow')
    expect(landing).toContain('copy.landing.signUp')
    expect(landing).toContain('href="/content"')
    expect(landing).toContain('href="/shorts"')
    expect(landing).toContain('href="/creator-center"')
    expect(layout).toContain("import '../../styles/twitter-clone-globals.scss'")
  })

  it('keeps the clone feed and compose entry connected through the shared X-style shell', async () => {
    const [home, shell] = await Promise.all([
      readFile('src/app/(twitter-clone)/home/page.tsx', 'utf8'),
      readFile('src/app/(twitter-clone)/TwitterCloneSecondaryPageLayout.tsx', 'utf8'),
    ])
    expect(home).toContain('<TwitterCloneHomeFeed key={feedMode} initialPage={initialPage} locale={locale} feedMode={feedMode} />')
    expect(home).toContain('<TwitterCloneSecondaryPageLayout locale={locale} title={copy.home.home} active="home">')
    expect(home).toContain('<TwitterClonePostComposerTrigger')
    expect(home).not.toContain('href="/publish?type=post"')
    expect(shell).toContain('<TwitterClonePostComposerModal />')
    expect(shell).toContain('TwitterCloneSidebarProfile locale={locale}')
    expect(shell).toContain("import TwitterCloneSidebarPublicProfileLink from './TwitterCloneSidebarPublicProfileLink'")
    expect(shell).toContain('<TwitterCloneSidebarPublicProfileLink locale={locale} />')
    expect(shell).not.toContain("href: '/me/profile'")
    expect(shell).toContain('href="/me/subscriptions"')
    expect(shell).toContain('href="/shorts"')
    const sidebarProfile = await readFile('src/app/(twitter-clone)/TwitterCloneSidebarProfile.tsx', 'utf8')
    expect(sidebarProfile).toContain("'/api/v1/users/me'")
    expect(sidebarProfile).toContain("credentials: 'include'")
    expect(sidebarProfile).toContain("profile?.username ? '/' + encodeURIComponent(profile.username) : '/me/profile'")
    expect(sidebarProfile).not.toContain('firebase/')
  })
})
