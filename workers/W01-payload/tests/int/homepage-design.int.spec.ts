import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) =>
  readFileSync(relativePath, 'utf8')

describe('Twitter Clone-inspired LuckRead homepage', () => {
  it('uses the upstream-style landing, navigation, feed, and shared styles', () => {
    const landing = read('src/app/(twitter-clone)/TwitterCloneLanding.tsx')
    const styles = read('src/styles/twitter-clone-globals.scss')
    const home = read('src/app/(twitter-clone)/home/page.tsx')
    const feed = read('src/app/(twitter-clone)/TwitterCloneHomeFeed.tsx')

    expect(landing).toContain('Happening now')
    expect(landing).toContain('href="/register"')
    expect(landing).toContain('href="/login"')
    expect(landing).toContain('src="/twitter-clone/assets/twitter-banner.png"')
    expect(landing).toContain('font-twitter-chirp-extended')
    expect(styles).toContain('.custom-button')
    expect(styles).toContain('.custom-underline')
    expect(home).toContain('href="/shorts"')
    expect(home).toContain('href="/me/subscriptions"')
    expect(home).toContain('href="/creator-center"')
    expect(feed).toContain('<LuckReadSocialPostCard')
    expect(feed).toContain('/api/v1/contents?')
  })

  it('sends signed-in users to the feed and exposes their profile entry there', () => {
    const page = read('src/app/(twitter-clone)/page.tsx')
    const home = read('src/app/(twitter-clone)/home/page.tsx')

    expect(page).toContain("if (principal?.active) redirect('/home')")
    expect(home).toContain('href="/me/profile"')
  })
})
