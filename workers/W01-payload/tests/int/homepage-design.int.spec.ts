import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('LuckRead homepage', () => {
  it('declares the public platform hero and creator entry points', async () => {
    const [page, styles] = await Promise.all([
      readFile('src/app/(frontend)/page.tsx', 'utf8'),
      readFile('src/app/(frontend)/styles.css', 'utf8'),
    ])

    expect(page).toContain('让好内容被看见')
    expect(page).toContain('发现 · 创作 · 连接')
    expect(page).toContain('href="/publish"')
    expect(page).toContain('立即创作')
    expect(styles).toContain('.home-shell')
    expect(styles).toContain('.hero')
    expect(styles).toContain('prefers-reduced-motion')
  })
})
