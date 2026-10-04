import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('public content type filter', () => {
  it('renders all, article, post and video tabs', () => {
    const page = read('src/app/(frontend)/content/page.tsx')

    expect(page).toContain("useState<ContentType | 'all'>('all')")
    expect(page).toContain('copy.content.tabs.all')
    expect(page).toContain('copy.content.tabs.article')
    expect(page).toContain('copy.content.tabs.post')
    expect(page).toContain('copy.content.tabs.video')
    expect(page).toContain('role="tablist"')
    expect(page).toContain('aria-selected={contentType === type}')
    expect(page).toContain('key={type}')
  })

  it('sends the selected type to the canonical contents API and resets pagination', () => {
    const page = read('src/app/(frontend)/content/page.tsx')
    const route = read('src/app/api/v1/contents/route.ts')

    expect(page).toContain("params.set('type', contentType)")
    expect(page).toContain("void load()")
    expect(route).toContain('validateContentListQuery')
    expect(route).toContain('validateContentListQuery')
  })

  it('keeps filter requests public and read-only', () => {
    const page = read('src/app/(frontend)/content/page.tsx')

    expect(page).toContain("headers: { accept: 'application/json' }")
    expect(page).toContain("cache: 'no-store'")
    expect(page).not.toContain("method: 'POST'")
    expect(page).not.toContain("method: 'PATCH'")
    expect(page).not.toContain("method: 'DELETE'")
  })
})
