import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { markdownToArticleDocument } from '../../src/lib/markdown-to-article-document.js'

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('Markdown editor plugin', () => {
  it('converts supported Markdown blocks into the stable ArticleDocument', () => {
    const result = markdownToArticleDocument([
      '# 主标题',
      '',
      '正文 **加粗**',
      '',
      '> 引用',
      '',
      '- 第一项',
      '- 第二项',
      '',
      '1. A',
      '2. B',
      '',
      '---',
      '',
      '\x60\x60\x60ts',
      'const answer: number = 42',
      '\x60\x60\x60',
    ].join('\n'))

    expect(result.unsupported).toEqual([])
    expect(result.document.blocks.map((block) => block.type)).toEqual([
      'heading',
      'paragraph',
      'quote',
      'bulletList',
      'orderedList',
      'divider',
      'code',
    ])
    expect(result.document.blocks[0]?.level).toBe(2)
    expect(result.document.blocks[3]?.text).toBe('第一项\n第二项')
    expect(result.document.blocks[6]).toMatchObject({
      type: 'code',
      language: 'typescript',
      text: 'const answer: number = 42',
    })
    expect(result.document.version).toBe(2)
  })

  it('imports a standalone remote image as a media block', () => {
    const result = markdownToArticleDocument(
      '![封面](https://cdn.example.com/cover.webp)',
    )

    expect(result.unsupported).toEqual([])
    expect(result.document.blocks[0]).toMatchObject({
      type: 'image',
      text: '封面',
      mediaRefs: ['https://cdn.example.com/cover.webp'],
    })
  })

  it('fails closed for content the current document schema cannot preserve', () => {
    const result = markdownToArticleDocument([
      '[保留链接地址](https://example.com)',
      '',
      '**\x60inline\x60**',
      '',
      '| A | B |',
      '| - | - |',
      '| 1 | 2 |',
    ].join('\n'))

    expect(result.unsupported).toEqual(
      expect.arrayContaining(['链接', '表格']),
    )
  })

  it('registers the open-source plugin through the existing host', () => {
    const registry = read(
      'src/components/article-editor-plugins.ts',
    )
    const plugin = read(
      'src/components/MarkdownImportPlugin.tsx',
    )

    expect(registry).toContain(
      "import { markdownImportPlugin } from './MarkdownImportPlugin.js'",
    )
    expect(registry).toContain("id: 'content.markdown-import'")
    expect(registry).toContain("id: 'content.code-block'")
    expect(plugin).toContain(
      "import { markdownToArticleDocument } from '../lib/markdown-to-article-document.js'",
    )
    expect(plugin).toContain('className="lr-editor-markdown-input"')
    expect(plugin).toContain('本次不会导入，避免静默丢失内容')
  })
})
