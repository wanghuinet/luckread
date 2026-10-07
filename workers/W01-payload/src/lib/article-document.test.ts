import { describe, expect, it } from 'vitest'

import {
  ARTICLE_MAX_BLOCKS,
  ARTICLE_MAX_MEDIA_PER_BLOCK,
  createArticleMediaBlock,
  articleDocumentFromBody,
  createArticleDocument,
  normalizeArticleDocument,
  plainTextFromArticleDocument,
  mediaRefsFromArticleDocument,
  hasArticleDocumentContent,
  duplicateArticleBlock,
  insertArticleBlockAfter,
  insertArticleMediaBlockAfter,
  removeMediaRefFromArticleDocument,
  reorderArticleMediaRef,
  transformArticleBlock,
  serializeArticleDocument,
  tryDeserializeArticleDocument,
} from './article-document.js'
import {
  ARTICLE_DOCUMENT_HISTORY_LIMIT,
  createArticleDocumentHistory,
  recordArticleDocumentHistory,
  redoArticleDocumentHistory,
  undoArticleDocumentHistory,
} from './article-document-history.js'

describe('article structured document', () => {
  it('round-trips structured blocks without losing ordering or headings', () => {
    const document = createArticleDocument()
    document.blocks = [
      { id: 'a', type: 'heading', text: '第一节', level: 2 },
      { id: 'b', type: 'paragraph', text: '正文内容' },
      { id: 'c', type: 'bulletList', text: '第一项\n第二项' },
      { id: 'd', type: 'divider', text: '' },
    ]

    const restored = tryDeserializeArticleDocument(serializeArticleDocument(document))
    expect(restored).toEqual(document)
    expect(plainTextFromArticleDocument(document)).toBe('第一节\n\n正文内容\n\n第一项\n\n第二项')
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

  it('collects canonical media references from structured article blocks', () => {
    const document = {
      version: 2 as const,
      blocks: [
        createArticleMediaBlock('image', ['https://media.example/1.jpg']),
        createArticleMediaBlock('gallery', [
          'https://media.example/1.jpg',
          'https://media.example/2.jpg',
        ]),
        { id: 'p', type: 'paragraph' as const, text: '正文' },
      ],
    }

    expect(mediaRefsFromArticleDocument(document)).toEqual([
      'https://media.example/1.jpg',
      'https://media.example/2.jpg',
    ])
  })

  it('detects meaningful article content before a destructive import', () => {
    expect(hasArticleDocumentContent(createArticleDocument())).toBe(false)
    expect(hasArticleDocumentContent(createArticleDocument('已有正文'))).toBe(true)

    expect(hasArticleDocumentContent({
      version: 2,
      blocks: [createArticleMediaBlock('image', ['https://media.example/image.jpg'])],
    })).toBe(true)
  })

  it('duplicates article blocks without sharing media arrays', () => {
    const source = createArticleMediaBlock('gallery', [
      'https://media.example/1.jpg',
      'https://media.example/2.jpg',
    ], '说明')

    const duplicate = duplicateArticleBlock(source)

    expect(duplicate).not.toBe(source)
    expect(duplicate.id).not.toBe(source.id)
    expect(duplicate.type).toBe(source.type)
    expect(duplicate.text).toBe(source.text)
    expect(duplicate.mediaRefs).toEqual(source.mediaRefs)
    expect(duplicate.mediaRefs).not.toBe(source.mediaRefs)
  })

  it('supports bounded undo and redo without sharing mutable document state', () => {
    const first = createArticleDocument('第一版')
    const second = { ...first, blocks: [{ ...first.blocks[0], text: '第二版' }] }
    const third = { ...second, blocks: [{ ...second.blocks[0], text: '第三版' }] }

    let history = createArticleDocumentHistory(2)
    history = recordArticleDocumentHistory(history, first, second)
    history = recordArticleDocumentHistory(history, second, third)

    const undone = undoArticleDocumentHistory(history, third)
    expect(undone.document?.blocks[0].text).toBe('第二版')

    const redone = redoArticleDocumentHistory(undone.history, undone.document!)
    expect(redone.document?.blocks[0].text).toBe('第三版')
    expect(redone.history.future).toHaveLength(0)
  })

  it('caps article document history to the configured limit', () => {
    let history = createArticleDocumentHistory(2)
    const first = createArticleDocument()
    const versions = ['2', '3', '4'].map((text) => ({
      version: 2 as const,
      blocks: [{ id: text, type: 'paragraph' as const, text }],
    }))

    let current = first
    for (const next of versions) {
      history = recordArticleDocumentHistory(history, current, next)
      current = next
    }

    expect(history.past).toHaveLength(2)
    expect(ARTICLE_DOCUMENT_HISTORY_LIMIT).toBeGreaterThanOrEqual(2)
  })

  it('inserts a new paragraph after the requested article block', () => {
    const document = {
      version: 2 as const,
      blocks: [
        { id: 'a', type: 'paragraph' as const, text: '第一段' },
        { id: 'b', type: 'heading' as const, text: '第二节', level: 2 as const },
      ],
    }

    const next = insertArticleBlockAfter(document, 0)

    expect(next.blocks.map((block) => block.id)).toEqual(['a', next.blocks[1].id, 'b'])
    expect(next.blocks[1]?.type).toBe('paragraph')
    expect(next.blocks[1]?.text).toBe('')
    expect(document.blocks).toHaveLength(2)
  })

  it('inserts media after the requested block without mutating the original', () => {
    const document = {
      version: 2 as const,
      blocks: [
        { id: 'a', type: 'paragraph' as const, text: '前文' },
        { id: 'b', type: 'paragraph' as const, text: '后文' },
      ],
    }

    const next = insertArticleMediaBlockAfter(document, 0, 'gallery', [
      'https://media.example/1.jpg',
      'https://media.example/2.jpg',
      'https://media.example/3.jpg',
    ])

    expect(next.blocks.map((block) => block.type)).toEqual(['paragraph', 'gallery', 'paragraph'])
    expect(next.blocks[1]?.mediaRefs).toEqual([
      'https://media.example/1.jpg',
      'https://media.example/2.jpg',
      'https://media.example/3.jpg',
    ])
    expect(document.blocks).toHaveLength(2)
  })

  it('caps contextual media insertion to the gallery media limit', () => {
    const document = createArticleDocument('正文')
    const refs = Array.from({ length: ARTICLE_MAX_MEDIA_PER_BLOCK + 5 }, (_, index) =>
      'https://media.example/' + String(index) + '.jpg',
    )

    const next = insertArticleMediaBlockAfter(document, 0, 'gallery', refs)

    expect(next.blocks[1]?.mediaRefs).toHaveLength(ARTICLE_MAX_MEDIA_PER_BLOCK)
  })

  it('returns the original document for invalid contextual media insertion', () => {
    const document = createArticleDocument('正文')

    expect(insertArticleMediaBlockAfter(document, 99, 'image', ['https://media.example/1.jpg'])).toBe(document)
    expect(insertArticleMediaBlockAfter(document, 0, 'image', [])).toEqual(document)
    expect(insertArticleMediaBlockAfter(document, 0, 'gallery', ['https://media.example/1.jpg'])).toEqual(document)
  })

  it('does not mutate the document for an invalid insertion index', () => {
    const document = createArticleDocument('正文')
    expect(insertArticleBlockAfter(document, 99)).toBe(document)
    expect(insertArticleBlockAfter(document, -2)).toBe(document)
  })

  it('removes a media reference without leaving invalid structured media blocks', () => {
    const document = {
      version: 2 as const,
      blocks: [
        createArticleMediaBlock('image', ['https://media.example/1.jpg'], '单图'),
        createArticleMediaBlock('gallery', [
          'https://media.example/1.jpg',
          'https://media.example/2.jpg',
        ], '图库'),
      ],
    }

    const next = removeMediaRefFromArticleDocument(document, 'https://media.example/1.jpg')

    expect(next).not.toBe(document)
    expect(next.blocks[0]?.type).toBe('paragraph')
    expect(next.blocks[0]?.text).toBe('单图')
    expect(next.blocks[1]?.type).toBe('image')
    expect(next.blocks[1]?.mediaRefs).toEqual(['https://media.example/2.jpg'])
    expect(document.blocks[0]?.mediaRefs).toEqual(['https://media.example/1.jpg'])
  })

  it('reorders gallery media without changing block identity or other content', () => {
    const document = {
      version: 2 as const,
      blocks: [
        createArticleMediaBlock('gallery', [
          'https://media.example/1.jpg',
          'https://media.example/2.jpg',
          'https://media.example/3.jpg',
        ], '图库说明'),
      ],
    }

    const next = reorderArticleMediaRef(document, 0, 2, 0)

    expect(next).not.toBe(document)
    expect(next.blocks[0]?.id).toBe(document.blocks[0]?.id)
    expect(next.blocks[0]?.text).toBe('图库说明')
    expect(next.blocks[0]?.mediaRefs).toEqual([
      'https://media.example/3.jpg',
      'https://media.example/1.jpg',
      'https://media.example/2.jpg',
    ])
    expect(document.blocks[0]?.mediaRefs).toEqual([
      'https://media.example/1.jpg',
      'https://media.example/2.jpg',
      'https://media.example/3.jpg',
    ])
  })

  it('is a no-op for invalid gallery media reorder requests', () => {
    const document = {
      version: 2 as const,
      blocks: [
        createArticleMediaBlock('image', ['https://media.example/1.jpg']),
        createArticleMediaBlock('gallery', [
          'https://media.example/2.jpg',
          'https://media.example/3.jpg',
        ]),
      ],
    }

    expect(reorderArticleMediaRef(document, 0, 0, 1)).toBe(document)
    expect(reorderArticleMediaRef(document, 1, -1, 1)).toBe(document)
    expect(reorderArticleMediaRef(document, 1, 0, 2)).toBe(document)
    expect(reorderArticleMediaRef(document, 1, 1, 1)).toBe(document)
  })

  it('is a no-op for an empty media reference', () => {
    const document = createArticleDocument('正文')
    expect(removeMediaRefFromArticleDocument(document, '   ')).toBe(document)
  })

  it('transforms text blocks while preserving content and identity', () => {
    const source = { id: 'block-1', type: 'paragraph' as const, text: '核心观点' }
    const heading = transformArticleBlock(source, 'heading')

    expect(heading).toEqual({
      id: 'block-1',
      type: 'heading',
      text: '核心观点',
      level: 2,
    })
  })

  it('converts a gallery to an image using its first media reference', () => {
    const source = createArticleMediaBlock('gallery', [
      'https://media.example/1.jpg',
      'https://media.example/2.jpg',
    ], '说明')

    const image = transformArticleBlock(source, 'image')

    expect(image).toEqual({
      id: source.id,
      type: 'image',
      text: '说明',
      mediaRefs: ['https://media.example/1.jpg'],
    })
  })

  it('does not fabricate media when transforming text into image or gallery', () => {
    const source = createArticleDocument('正文').blocks[0]
    expect(transformArticleBlock(source, 'image')).toBe(source)
    expect(transformArticleBlock(source, 'gallery')).toBe(source)
  })

  it('strips control characters before persistence', () => {
    const document = normalizeArticleDocument({
      version: 1,
      blocks: [{ id: 'p', type: 'paragraph', text: 'hello\u0000\u0007world' }],
    })
    expect(document.blocks[0].text).toBe('helloworld')
  })
})
