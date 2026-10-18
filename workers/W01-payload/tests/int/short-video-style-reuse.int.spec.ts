import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('Short video UI style reuse', () => {
  it('uses shared Tailwind utilities instead of a bespoke CSS module', () => {
    const source = read('src/app/(frontend)/shorts/ShortVideoFeed.tsx')
    expect(source).not.toContain("import styles from './short-video.module.css'")
    expect(source).not.toContain('styles.')
    expect(source).toContain('snap-y snap-mandatory')
    expect(source).toContain('touch-pan-y')
    expect(source).toContain('max-[640px]')
    expect(source).toContain('retryPlayback(item)')
    expect(source).toContain('toggleComments(item)')
    expect(source).toContain('setMuted((value) => !value)')
  })
})
