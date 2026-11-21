import { describe, expect, it } from 'vitest'

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('public content browse delivery', () => {
  it('keeps public list fetches anonymous so signed-in browsers remain on the shared-cache path', () => {
    const page = read('src/app/(frontend)/content/ContentBrowsePage.tsx')

    expect(page).toContain("fetchJson<ContentApiResponse>('/api/v1/contents?' + params.toString()")
    expect(page).toContain("credentials: 'omit'")
    expect(page).toContain("headers: { accept: 'application/json' }")
    expect(page).toContain("cache: 'no-store'")
  })

  it('keeps public browse pagination and type filtering on the same v1 list endpoint', () => {
    const page = read('src/app/(frontend)/content/ContentBrowsePage.tsx')

    expect(page).toContain("const params = new URLSearchParams({ limit: '18' })")
    expect(page).toContain("if (cursor) params.set('cursor', cursor)")
    expect(page).toContain("if (selectedType !== 'all') params.set('type', selectedType)")
    expect(page).toContain("load(page.nextCursor, contentType, contentLoadError)")
  })

  it('routes Explore through the X-style layout without replacing the authoritative browse logic', () => {
    const page = read('src/app/(frontend)/content/ContentBrowsePage.tsx')
    const route = read('src/app/(twitter-clone)/content/page.tsx')

    expect(page).toContain('<TwitterCloneSecondaryPageLayout locale={locale} title={copy.content.title} active="explore">')
    expect(route).toContain("import ContentBrowsePage from '../../(frontend)/content/ContentBrowsePage'")
    expect(page).not.toContain('<PublicLanguageToggle locale={locale} />')
  })
})
