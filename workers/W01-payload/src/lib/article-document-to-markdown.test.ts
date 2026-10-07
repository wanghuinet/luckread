import { describe, expect, it } from 'vitest'
import { articleDocumentToMarkdown } from './article-document-to-markdown.js'
import { createArticleTableBlock } from './article-document.js'
import { markdownToArticleDocument } from './markdown-to-article-document.js'

describe('article document markdown serializer', () => {
  it('serializes structured blocks without using editor DOM', () => {
    const document = {
      version: 2 as const,
      blocks: [
        { id: 'h', type: 'heading' as const, text: '标题', level: 2 as const },
        { id: 'p', type: 'paragraph' as const, text: '正文 *不是格式*' },
        { id: 'q', type: 'quote' as const, text: '引用' },
        { id: 'c', type: 'code' as const, text: 'const answer = 42', language: 'javascript' as const },
        { id: 'm', type: 'math' as const, text: '\\frac{a}{b}' },
        createArticleTableBlock(['名称', '状态'], [['Markdown', '已完成']]),
        { id: 'd', type: 'divider' as const, text: '' },
      ],
    }

    const markdown = articleDocumentToMarkdown(document)

    expect(markdown).toContain('## 标题')
    expect(markdown).toContain('正文 \\*不是格式\\*')
    expect(markdown).toContain('> 引用')
    expect(markdown).toContain('$')
    expect(markdown).toContain('\\frac{a}{b}')
    expect(markdown).toContain('\x60\x60\x60javascript')
    expect(markdown).toContain('| 名称 | 状态 |')
    expect(markdown).toContain('| --- | --- |')
    expect(markdown).toContain('---')
  })

  it('round-trips core blocks through the Markdown parser', () => {
    const document = {
      version: 2 as const,
      blocks: [
        { id: 'h', type: 'heading' as const, text: '标题', level: 2 as const },
        { id: 'p', type: 'paragraph' as const, text: '正文' },
        { id: 'c', type: 'code' as const, text: 'const x = 1', language: 'javascript' as const },
        createArticleTableBlock(['A', 'B'], [['1', '2']]),
      ],
    }

    const markdown = articleDocumentToMarkdown(document)
    const imported = markdownToArticleDocument(markdown)

    expect(imported.unsupported).toEqual([])
    expect(imported.document.blocks.map((block) => block.type)).toEqual([
      'heading',
      'paragraph',
      'code',
      'math',
      'table',
    ])
    expect(imported.document.blocks[2]).toMatchObject({
      language: 'javascript',
      text: 'const x = 1',
    })
    expect(imported.document.blocks[3]).toMatchObject({
      table: { headers: ['A', 'B'], rows: [['1', '2']] },
    })
  })

  it('escapes markdown table cell delimiters safely', () => {
    const document = {
      version: 2 as const,
      blocks: [
        createArticleTableBlock(['A|B'], [['line 1\nline 2']]),
      ],
    }

    const markdown = articleDocumentToMarkdown(document)

    expect(markdown).toContain('| A\\|B |')
    expect(markdown).toContain('| line 1 line 2 |')
  })

  it('keeps empty documents deterministic', () => {
    const document = {
      version: 2 as const,
      blocks: [{ id: 'empty', type: 'paragraph' as const, text: '' }],
    }

    expect(articleDocumentToMarkdown(document)).toBe('')
  })
})
