import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('content detail page', () => {
  it('hides follow action when the relationship graph is blocked', () => {
    const page = read('src/app/(frontend)/content/[contentId]/page.tsx')
    expect(page).toContain('followRestricted')
    expect(page).toContain('relationship?.blocked')
    expect(page).toContain('relationship?.blockedBy')
    expect(page).toContain('copy.detail.restricted')
    expect(page).not.toContain("setFollowing(followData.data.following)")
  })
})
