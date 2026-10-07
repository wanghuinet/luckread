import { describe, expect, it } from 'vitest'

import type { ImportedDocument } from '../../src/features/word-import/model.js'
import { renderImportedDocument } from '../../src/features/word-import/html-builder.js'
import { normalizeImportedDocument } from '../../src/features/word-import/normalizer.js'

const baseStats = (): ImportedDocument['stats'] => ({
  paragraphs: 0,
  headings: 0,
  lists: 0,
  images: 0,
  tables: 0,
  mediaBytes: 0,
  normalizedLineBreaks: 0,
  normalizedWideMedia: 0,
})

describe('Word import layout normalization', () => {
  it('joins obvious Word-style hard wrapped paragraphs without joining punctuated prose', () => {
    const document: ImportedDocument = {
      warnings: [],
      stats: baseStats(),
      blocks: [
        {
          kind: 'paragraph',
          inlines: [
            {
              kind: 'text',
              marks: [],
              text: '这是第一行文字\n这是第二行文字\n这是第三行文字。',
            },
          ],
        },
        {
          kind: 'paragraph',
          inlines: [
            {
              kind: 'text',
              marks: [],
              text: '第一句。\n第二句。\n第三句。',
            },
          ],
        },
      ],
    }

    const normalized = normalizeImportedDocument(document)

    expect(normalized.blocks[0]).toMatchObject({
      kind: 'paragraph',
      inlines: [{ text: '这是第一行文字这是第二行文字这是第三行文字。' }],
    })
    expect(normalized.blocks[1]).toMatchObject({
      kind: 'paragraph',
      inlines: [{ text: '第一句。\n第二句。\n第三句。' }],
    })
    expect(normalized.stats.normalizedLineBreaks).toBe(1)
  })

  it('groups consecutive list items and clamps over-deep levels', () => {
    const document: ImportedDocument = {
      warnings: [],
      stats: baseStats(),
      blocks: [
        { kind: 'listItem', ordered: false, level: 0, inlines: [{ kind: 'text', marks: [], text: 'A' }] },
        { kind: 'listItem', ordered: false, level: 9, inlines: [{ kind: 'text', marks: [], text: 'B' }] },
        { kind: 'paragraph', inlines: [{ kind: 'text', marks: [], text: 'tail' }] },
      ],
    }

    const normalized = normalizeImportedDocument(document)

    expect(normalized.blocks[0]?.kind).toBe('list')
    if (normalized.blocks[0]?.kind === 'list') {
      expect(normalized.blocks[0].items).toHaveLength(2)
      expect(normalized.blocks[0].items[1]?.level).toBe(8)
    }
  })

  it('clamps wide imported media to an article-safe display width', () => {
    const document: ImportedDocument = {
      warnings: [],
      stats: baseStats(),
      blocks: [
        {
          kind: 'image',
          mediaKey: 'word/media/image1.png',
          mimeType: 'image/png',
          bytes: new Uint8Array([1, 2, 3]),
          widthPx: 2400,
          heightPx: 1200,
          alt: 'wide',
        },
      ],
    }

    const normalized = normalizeImportedDocument(document)

    expect(normalized.blocks[0]).toMatchObject({ kind: 'image', widthPx: 1600 })
    expect(normalized.stats.normalizedWideMedia).toBe(1)

    const html = renderImportedDocument(normalized, () => ({ id: '42', alt: 'wide' }))
    expect(html).toContain('data-lexical-upload-id="42"')
    expect(html).toContain('max-width:100%')
  })
})

describe('Word import image node preservation', () => {
  it('does not merge text across an imported inline image', () => {
    const document: ImportedDocument = {
      warnings: [],
      stats: baseStats(),
      blocks: [{
        kind: 'paragraph',
        inlines: [
          { kind: 'text', marks: [], text: 'before' },
          {
            kind: 'inlineImage',
            image: {
              kind: 'image',
              mediaKey: 'word/media/image1.png',
              mimeType: 'image/png',
              bytes: new Uint8Array([1]),
            },
          },
          { kind: 'text', marks: [], text: 'after' },
        ],
      }],
    }

    const normalized = normalizeImportedDocument(document)
    const block = normalized.blocks[0]
    expect(block?.kind).toBe('paragraph')
    if (block?.kind === 'paragraph') {
      expect(block.inlines).toHaveLength(3)
      expect(block.inlines[0]).toMatchObject({ kind: 'text', text: 'before' })
      expect(block.inlines[1]).toMatchObject({ kind: 'inlineImage' })
      expect(block.inlines[2]).toMatchObject({ kind: 'text', text: 'after' })
    }
  })
})

describe('Word import rich media rendering', () => {
  it('keeps media relationships for images nested inside tables', () => {
    const document: ImportedDocument = {
      warnings: [],
      stats: baseStats(),
      blocks: [{
        kind: 'table',
        rows: [[{
          blocks: [{
            kind: 'image',
            mediaKey: 'word/media/image1.png',
            mimeType: 'image/png',
            bytes: new Uint8Array([1]),
            alt: 'table image',
          }],
        }]],
      }],
    }

    const html = renderImportedDocument(document, () => ({ id: 'media-1', alt: 'table image' }))
    expect(html).toContain('data-lexical-upload-id="media-1"')
    expect(html).toContain('<td')
  })

  it('does not emit unsafe external URL protocols during HTML generation', () => {
    const document: ImportedDocument = {
      warnings: [],
      stats: baseStats(),
      blocks: [{
        kind: 'paragraph',
        inlines: [{
          kind: 'link',
          href: 'javascript:alert(1)',
          children: [{ kind: 'text', marks: [], text: 'unsafe' }],
        }],
      }],
    }

    const html = renderImportedDocument(document)
    expect(html).not.toContain('javascript:')
    expect(html).toContain('unsafe')
  })
})
