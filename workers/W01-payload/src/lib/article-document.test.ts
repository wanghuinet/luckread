import { describe, expect, it } from 'vitest'

import {
  ARTICLE_MAX_BLOCKS,
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
    ]

    const restored = tryDeserializeArticleDocument(serializeArticleDocument(document))
    expect(restored).toEqual(document)
    expect(plainTextFromArticleDocument(document)).toBe('第一节\n\n正文内容\n\n第一项\n\n第二项')
  })

  it('converts legacy plain-text bodies into paragraph blocks', () => {
    const document = articleDocumentFromBody('第一段\n\n第二段\n第三行')
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
      version: 1,
      blocks: [{ id: 'empty', type: 'paragraph', text: '   ' }],
    })).toThrow('ARTICLE_DOCUMENT_EMPTY')
  })

  it('strips control characters before persistence', () => {
    const document = normalizeArticleDocument({
      version: 1,
      blocks: [{ id: 'p', type: 'paragraph', text: 'hello\u0000\u0007world' }],
    })
    expect(document.blocks[0].text).toBe('helloworld')
  })
})
