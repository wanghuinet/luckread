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

  it('keeps the clone feed, compose entry, profile, and discovery routes connected', async () => {
    const home = await readFile('src/app/(twitter-clone)/home/page.tsx', 'utf8')
    expect(home).toContain('<TwitterCloneHomeFeed initialPage={initialPage} locale={locale} />')
    expect(home).toContain('href="/publish"')
    expect(home).toContain('href="/me/profile"')
    expect(home).toContain('TwitterCloneSidebarProfile locale={locale}')
    const sidebarProfile = await readFile('src/app/(twitter-clone)/TwitterCloneSidebarProfile.tsx', 'utf8')
    expect(sidebarProfile).toContain("'/api/v1/users/me'")
    expect(sidebarProfile).toContain('credentials: \'include\'')
    expect(sidebarProfile).not.toContain('firebase/')
    expect(home).toContain('href="/me/subscriptions"')
    expect(home).toContain('href="/shorts"')
  })
})
