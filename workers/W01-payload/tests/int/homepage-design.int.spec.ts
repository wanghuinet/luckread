import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('LuckRead homepage', () => {
  it('declares the reader-first homepage, left discussion tree, and creator entry points', async () => {
    const [page, styles] = await Promise.all([
      readFile('src/app/(frontend)/page.tsx', 'utf8'),
      readFile('src/app/(frontend)/styles.css', 'utf8'),
    ])

    expect(page).toContain('copy.home.heroTitle')
    expect(page).toContain('copy.home.heroLead')
    expect(page).toContain("const CREATOR_CENTER_URL = 'https://mp.luckread.com/'")
    expect(page).toContain('copy.common.createNow')
    expect(styles).toContain('.home-shell')
    expect(styles).toContain('.hero')
    expect(styles).toContain('prefers-reduced-motion')
    expect(page).toContain('className="home-reading-layout"')
    expect(page).toContain('className="home-rail-link home-rail-tree"')
    expect(page.indexOf('home-rail-tree')).toBeLessThan(page.indexOf('home-rail-active'))
    expect(page).toContain("href=\"/content\"")
    expect(styles).toContain('.home-left-rail')
    expect(styles).toContain('.home-reading-main .content-feed-grid')
  })
})


  it('exposes the signed-in profile entry from the public header', async () => {
    const page = await readFile('src/app/(frontend)/page.tsx', 'utf8')
    expect(page).toContain('copy.common.profile')
  })
