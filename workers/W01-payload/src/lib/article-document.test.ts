import { describe, expect, it } from 'vitest'

import {
  ARTICLE_MAX_BLOCKS,
  ARTICLE_MAX_MEDIA_PER_BLOCK,
  ARTICLE_TABLE_MAX_COLUMNS,
  ARTICLE_TABLE_MAX_ROWS,
  ARTICLE_TABLE_MAX_CELL_TEXT,
  createArticleTableBlock,
  createArticleMediaBlock,
  articleDocumentFromBody,
  createArticleDocument,
  normalizeArticleDocument,
  plainTextFromArticleDocument,
  serializeArticleDocument,
  tryDeserializeArticleDocument,
} from './article-document.js'

describe('article structured document', () => {
  it('round-trips structured blocks without losing ordering or headings', () => {
    const document = createArticleDocument()
    document.blocks = [
      { id: 'a', type: 'heading', text: '第一节', level: 2 },
      { id: 'b', type: 'paragraph', text: '正文内容' },
      { id: 'c', type: 'bulletList', text: '第一项\n第二项' },
      { id: 'd', type: 'divider', text: '' },
      { id: 'e', type: 'code', text: 'const answer = 42', language: 'javascript' },
    ]

    const restored = tryDeserializeArticleDocument(serializeArticleDocument(document))
    expect(restored).toEqual(document)
    expect(plainTextFromArticleDocument(document)).toBe('第一节\n\n正文内容\n\n第一项\n\n第二项\n\nconst answer = 42')
  })

  it('persists a newly inserted table before any data rows are filled', () => {
    const document = {
      version: 2 as const,
      blocks: [createArticleTableBlock(['列 1', '列 2'], [['', '']])],
    }

    expect(() => serializeArticleDocument(document)).not.toThrow()
  })

  it('round-trips structured table blocks and extracts tabular text', () => {
    const document = {
      version: 2 as const,
      blocks: [
        createArticleTableBlock(
          ['名称', '状态'],
          [
            ['Markdown', '已完成'],
            ['代码块', '已完成'],
          ],
        ),
      ],
    }
    const restored = tryDeserializeArticleDocument(serializeArticleDocument(document))
    expect(restored).toEqual(document)
    expect(plainTextFromArticleDocument(document)).toBe('名称\t状态\nMarkdown\t已完成\n代码块\t已完成')
  })

  it('round-trips image and gallery blocks and keeps media out of extracted text', () => {
    const document = {
      version: 2 as const,
      blocks: [
        createArticleMediaBlock('image', ['https://media.example/image-1.jpg'], '图 1'),
        createArticleMediaBlock('gallery', [
          'https://media.example/image-1.jpg',
          'https://media.example/image-2.jpg',
        ], '图片组'),
      ],
    }
    const restored = tryDeserializeArticleDocument(serializeArticleDocument(document))
    expect(restored).toEqual(document)
    expect(plainTextFromArticleDocument(document)).toBe('图 1\\n\\n图片组')
  })

  it('converts legacy plain-text bodies into paragraph blocks and upgrades the document version', () => {
    const document = articleDocumentFromBody('第一段\n\n第二段\n第三行')
    expect(document.version).toBe(2)
    expect(document.blocks.map((block) => [block.type, block.text])).toEqual([
      ['paragraph', '第一段'],
      ['paragraph', '第二段\n第三行'],
    ])
  })

  it('rejects invalid block counts and refuses an entirely empty persisted document', () => {
    expect(() => normalizeArticleDocument({
      version: 1,
      blocks: [],
    })).toThrow('INVALID_ARTICLE_DOCUMENT')

    expect(() => normalizeArticleDocument({
      version: 1,
      blocks: Array.from({ length: ARTICLE_MAX_BLOCKS + 1 }, (_, index) => ({
        id: String(index),
        type: 'paragraph',
        text: 'x',
      })),
    })).toThrow('INVALID_ARTICLE_DOCUMENT')

    expect(() => serializeArticleDocument({
      version: 2,
      blocks: [{ id: 'empty', type: 'paragraph', text: '   ' }],
    })).toThrow('ARTICLE_DOCUMENT_EMPTY')

    expect(() => createArticleMediaBlock('gallery', ['https://media.example/only.jpg'])).toThrow('INVALID_ARTICLE_BLOCK')

    expect(() => createArticleTableBlock(
      Array.from({ length: ARTICLE_TABLE_MAX_COLUMNS + 1 }, () => 'x'),
      [['x', 'x']],
    )).toThrow('INVALID_ARTICLE_BLOCK')

    expect(() => createArticleTableBlock(
      ['x'],
      Array.from({ length: ARTICLE_TABLE_MAX_ROWS + 1 }, () => ['x']),
    )).toThrow('INVALID_ARTICLE_BLOCK')

    expect(() => createArticleTableBlock(
      ['x'],
      [['x'.repeat(ARTICLE_TABLE_MAX_CELL_TEXT + 1)]],
    )).toThrow('INVALID_ARTICLE_BLOCK')

    expect(() => normalizeArticleDocument({
      version: 2,
      blocks: [{
        id: 'table',
        type: 'table',
        text: '',
        table: { headers: ['x'], rows: [['x'.repeat(ARTICLE_TABLE_MAX_CELL_TEXT + 1)]] },
      }],
    })).toThrow('INVALID_ARTICLE_BLOCK')

    expect(() => normalizeArticleDocument({
      version: 2,
      blocks: [{
        id: 'gallery',
        type: 'gallery',
        text: '',
        mediaRefs: Array.from({ length: ARTICLE_MAX_MEDIA_PER_BLOCK + 1 }, (_, index) => 'https://media.example/' + index + '.jpg'),
      }],
    })).toThrow('INVALID_ARTICLE_BLOCK')
  })

  it('strips control characters before persistence', () => {
    const document = normalizeArticleDocument({
      version: 1,
      blocks: [{ id: 'p', type: 'paragraph', text: 'hello\u0000\u0007world' }],
    })
    expect(document.blocks[0].text).toBe('helloworld')
  })
})
