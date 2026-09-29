import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const frontendDir = fileURLToPath(new URL('../../src/app/(frontend)/', import.meta.url))

describe('LuckRead homepage', () => {
  it('declares the public platform hero and creator entry points', async () => {
    const [page, styles] = await Promise.all([
      readFile(fileURLToPath(new URL('page.tsx', import.meta.url)), 'utf8'),
      readFile(fileURLToPath(new URL('styles.css', import.meta.url)), 'utf8'),
    ])

    expect(page).toContain('让好内容被看见')
    expect(page).toContain('发现 · 创作 · 连接')
    expect(page).toContain('href="/publish"')
    expect(page).toContain('立即创作')
    expect(styles).toContain('.home-shell')
    expect(styles).toContain('.hero')
    expect(styles).toContain('prefers-reduced-motion')
    expect(frontendDir).toContain('/workers/W01-payload/src/app/(frontend)')
  })
})
