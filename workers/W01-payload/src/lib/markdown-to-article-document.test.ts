import { describe, expect, it } from 'vitest'
import { markdownToArticleDocument } from './markdown-to-article-document.js'
import { articleDocumentToMarkdown } from './article-document-to-markdown.js'

describe('Markdown to ArticleDocument', () => {
  it('imports the supported structural blocks', () => {
    const result = markdownToArticleDocument([
      '## 第一节',
      '',
      '正文内容',
      '',
      '> 引用第一行',
      '> 引用第二行',
      '',
      '- 第一项',
      '- 第二项',
      '',
      '1. A',
      '2. B',
      '',
      '---',
      '',
      '![图片说明](https://media.example/a.jpg)',
    ].join('\n'))

    expect(result.unsupported).toEqual([])
    expect(result.document.blocks.map((block) => block.type)).toEqual([
      'heading',
      'paragraph',
      'quote',
      'bulletList',
      'orderedList',
      'divider',
      'image',
    ])
    expect(result.document.blocks[0]).toMatchObject({
      level: 2,
      text: '第一节',
    })
    expect(result.document.blocks[2]?.text).toBe('引用第一行\n引用第二行')
    expect(result.document.blocks[3]?.text).toBe('第一项\n第二项')
    expect(result.document.blocks[6]).toMatchObject({
      mediaRefs: ['https://media.example/a.jpg'],
      text: '图片说明',
    })
  })

  it('rejects unsupported Markdown semantics instead of silently importing them', () => {
    const result = markdownToArticleDocument([
      '[外部链接](https://example.com)',
      '',
      '**加粗内容**',
      '',
      '<div>HTML</div>',
      '',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
    ].join('\n'))

    expect(result.unsupported).toEqual(
      expect.arrayContaining(['链接', '行内强调', 'HTML', '表格或管线语法']),
    )
  })

  it('reports unsupported heading levels while preserving supported content', () => {
    const result = markdownToArticleDocument([
      '# H1',
      '',
      '## H2',
      '',
      '#### H4',
    ].join('\n'))

    expect(result.unsupported).toContain('H1/H4-H6 标题层级')
    expect(result.document.blocks.map((block) => block.type)).toEqual(['heading'])
    expect(result.document.blocks[0]?.level).toBe(2)
  })

  it('recognizes all supported Markdown divider spellings', () => {
    for (const source of ['---', '___', '***', '* * *']) {
      const result = markdownToArticleDocument('正文\\n\\n' + source)
      expect(result.unsupported).toEqual([])
      expect(result.document.blocks[1]?.type).toBe('divider')
    }
  })

  it('fails closed for an oversized imported text block', () => {
    expect(() =>
      markdownToArticleDocument('a'.repeat(20_001)),
    ).toThrow('MARKDOWN_BLOCK_TOO_LARGE')
  })
  it('round-trips paragraph lines that look like Markdown structure', () => {
    const source = {
      version: 2 as const,
      blocks: [
        { id: 'p', type: 'paragraph' as const, text: '# 不是标题\n- 不是列表\n> 不是引用\n---\n___\n* * *' },
      ],
    }

    const markdown = articleDocumentToMarkdown(source)
    const result = markdownToArticleDocument(markdown)

    expect(result.unsupported).toEqual([])
    expect(result.document.blocks).toEqual(source.blocks)
  })

})
