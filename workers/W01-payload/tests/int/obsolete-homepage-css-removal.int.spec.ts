import { describe, expect, it } from 'vitest'

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('obsolete homepage CSS removal', () => {
  it('removes unused standalone homepage layouts while preserving active content-feed styles', () => {
    const styles = read('src/app/(frontend)/styles.css')
    const activeFeed = read('src/app/(twitter-clone)/TwitterCloneHomeFeed.tsx')

    for (const selector of [
      '.home-shell {',
      '.site-header {',
      '.brand {',
      '.hero {',
      '.hero-visual {',
      '.category-strip {',
      '.intro-section {',
      '.highlight-grid {',
      '.creator-banner {',
      '.site-footer {',
      '.home-reading-layout {',
      '.home-left-rail {',
      '.home-right-rail {',
      '.home-reading-main .content-feed',
    ]) {
      expect(styles).not.toContain(selector)
    }

    expect(styles).toContain('.eyebrow, .card-eyebrow')
    expect(styles).toContain('.button {')
    expect(styles).toContain('.content-feed {')
    expect(styles).toContain('.content-feed-card {')
    expect(styles).toContain('.content-feed-cover {')
    expect(activeFeed).toContain('LuckReadSocialPostCard')
    expect(activeFeed).toContain('presentation="x-timeline"')
  })
})
