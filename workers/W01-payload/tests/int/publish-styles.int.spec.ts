import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('publish stylesheet integrity', () => {
  it('parses editor utility selectors as standalone CSS selectors', () => {
    const styles = read('src/app/(frontend)/publish/publish.css')
    const root = postcss.parse(styles, { from: 'src/app/(frontend)/publish/publish.css' })
    const selectors = new Set<string>()

    root.walkRules((rule) => {
      for (const selector of rule.selectors) selectors.add(selector.trim())
    })

    expect(styles).not.toMatch(/^\\n$/m)
    expect(selectors).toContain('.lr-editor-plugin-button')
    expect(selectors).toContain('.lr-editor-outline nav')
    expect(selectors).toContain('.lr-editor-writer-stats-grid')
    expect(selectors).toContain('.lr-editor-markdown-actions')
  })
})
