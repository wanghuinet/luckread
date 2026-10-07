import { describe, expect, it } from 'vitest'

import type { ImportedDocument } from './model.js'
import { articleDocumentFromImportedDocument } from './article-document-adapter.js'

const baseStats = (): ImportedDocument['stats'] => ({
  paragraphs: 1,
  headings: 1,
  lists: 1,
  images: 1,
  tables: 1,
  mediaBytes: 10,
  normalizedLineBreaks: 0,
  normalizedWideMedia: 0,
})

describe('Word article document adapter', () => {
  it('maps headings, lists, paragraphs and uploaded images into ArticleDocument blocks', () => {
    const document: ImportedDocument = {
      blocks: [
        { kind: 'heading', level: 2, inlines: [{ kind: 'text', text: 'Word 标题', marks: [] }] },
        { kind: 'paragraph', inlines: [{ kind: 'text', text: '正文', marks: [] }] },
        {
          kind: 'list',
          items: [
            { kind: 'listItem', ordered: false, level: 0, inlines: [{ kind: 'text', text: '第一项', marks: [] }] },
            { kind: 'listItem', ordered: false, level: 0, inlines: [{ kind: 'text', text: '第二项', marks: [] }] },
          ],
        },
        {
          kind: 'image',
          mediaKey: 'media/image1.png',
          mimeType: 'image/png',
          bytes: new Uint8Array([1, 2, 3]),
          alt: '封面',
        },
      ],
      warnings: [],
      stats: baseStats(),
    }

    const result = articleDocumentFromImportedDocument(
      document,
      new Map([['media/image1.png', 'https://cdn.example/image1.png']]),
    )

    expect(result.document.blocks.map((block) => block.type)).toEqual([
      'heading',
      'paragraph',
      'bulletList',
      'image',
    ])
    expect(result.document.blocks[0]?.text).toBe('Word 标题')
    expect(result.document.blocks[0]?.level).toBe(2)
    expect(result.document.blocks[2]?.text).toBe('第一项\n第二项')
    expect(result.document.blocks[3]?.mediaRefs).toEqual(['https://cdn.example/image1.png'])
  })

  it('maps tables to readable paragraphs and reports the controlled degradation', () => {
    const document: ImportedDocument = {
      blocks: [
        {
          kind: 'table',
          rows: [
            [
              { blocks: [{ kind: 'paragraph', inlines: [{ kind: 'text', text: 'A', marks: [] }] }] },
              { blocks: [{ kind: 'paragraph', inlines: [{ kind: 'text', text: 'B', marks: [] }] }] },
            ],
          ],
        },
      ],
      warnings: [],
      stats: baseStats(),
    }

    const result = articleDocumentFromImportedDocument(document, new Map())
    expect(result.document.blocks[0]?.type).toBe('paragraph')
    expect(result.document.blocks[0]?.text).toBe('A ｜ B')
    expect(result.warnings.some((warning) => warning.includes('Word 表格已转为段落文本'))).toBe(true)
  })
})
