import { describe, expect, it } from 'vitest'

import type { ImportedDocument, TextMark } from './model.js'
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
        { kind: 'heading', level: 2, inlines: [{ kind: 'text', text: 'Word 标题', marks: [] as TextMark[] }] },
        { kind: 'paragraph', inlines: [{ kind: 'text', text: '正文', marks: [] as TextMark[] }] },
        {
          kind: 'list',
          items: [
            { kind: 'listItem', ordered: false, level: 0, inlines: [{ kind: 'text', text: '第一项', marks: [] as TextMark[] }] },
            { kind: 'listItem', ordered: false, level: 0, inlines: [{ kind: 'text', text: '第二项', marks: [] as TextMark[] }] },
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

  it('keeps table images when the table layout is deliberately degraded', () => {
    const document: ImportedDocument = {
      blocks: [{
        kind: 'table',
        rows: [[{
          blocks: [{
            kind: 'paragraph',
            inlines: [
              { kind: 'text', text: '单元格', marks: [] as TextMark[] },
              {
                kind: 'inlineImage',
                image: {
                  kind: 'image',
                  mediaKey: 'media/table.png',
                  mimeType: 'image/png',
                  bytes: new Uint8Array([4, 5, 6]),
                },
              },
            ],
          }],
        }]],
      }],
      warnings: [],
      stats: baseStats(),
    }

    const result = articleDocumentFromImportedDocument(
      document,
      new Map([['media/table.png', 'https://cdn.example/table.png']]),
    )

    expect(result.document.blocks.map((block) => block.type)).toEqual(['paragraph', 'image'])
    expect(result.document.blocks[1]?.mediaRefs).toEqual(['https://cdn.example/table.png'])
  })

  it('rejects imports that exceed the article block limit instead of silently truncating them', () => {
    const document: ImportedDocument = {
      blocks: Array.from({ length: 201 }, (_, index) => ({
        kind: 'paragraph' as const,
        inlines: [{ kind: 'text' as const, text: '段落 ' + String(index + 1), marks: [] as TextMark[] }],
      })),
      warnings: [],
      stats: baseStats(),
    }

    expect(() => articleDocumentFromImportedDocument(document, new Map())).toThrow(
      'Word 导入结果超过文章最多 200 个区块的限制',
    )
  })

  it('rejects imports that exceed the persisted article size limit', () => {
    const document: ImportedDocument = {
      blocks: Array.from({ length: 20 }, () => ({
        kind: 'paragraph' as const,
        inlines: [{ kind: 'text' as const, text: 'x'.repeat(18_000), marks: [] as TextMark[] }],
      })),
      warnings: [],
      stats: baseStats(),
    }

    expect(() => articleDocumentFromImportedDocument(document, new Map())).toThrow(
      'Word 导入结果超过文章保存大小限制',
    )
  })

  it('maps tables to readable paragraphs and reports the controlled degradation', () => {
    const document: ImportedDocument = {
      blocks: [
        {
          kind: 'table',
          rows: [
            [
              { blocks: [{ kind: 'paragraph', inlines: [{ kind: 'text', text: 'A', marks: [] as TextMark[] }] }] },
              { blocks: [{ kind: 'paragraph', inlines: [{ kind: 'text', text: 'B', marks: [] as TextMark[] }] }] },
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
