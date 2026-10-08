import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('Markdown editor plugin', () => {
  it('registers Markdown import and export through the existing editor host', () => {
    const plugin = read('src/components/MarkdownEditorPlugin.tsx')
    const registry = read('src/components/article-editor-plugins.ts')
    const styles = read('src/app/(frontend)/publish/publish.css')

    expect(plugin).toContain('markdownToArticleDocument')
    expect(plugin).toContain('articleDocumentToMarkdown')
    expect(plugin).toContain('hasArticleDocumentContent')
    expect(plugin).toContain('window.confirm')
    expect(plugin).toContain('未执行导入')
    expect(plugin).toContain('Blob([markdown]')
    expect(plugin).toContain('download = \'luckread-article.md\'')
    expect(plugin).toContain("id: 'content.markdown'")
    expect(plugin).toContain('Toolbar: MarkdownExportToolbar')
    expect(plugin).toContain('Panel: MarkdownPanel')
    expect(registry).toContain("import { markdownEditorPlugin } from './MarkdownEditorPlugin.js'")
    expect(registry).toContain('markdownEditorPlugin')
    expect(styles).toContain('.lr-editor-markdown-input')
    expect(styles).toContain('.lr-editor-markdown-actions')
  })
})
