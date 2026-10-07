import { describe, expect, it } from 'vitest'

import { collectImportedImages } from './collect-images.js'

const image = (mediaKey: string) => ({
  kind: 'image' as const,
  mediaKey,
  mimeType: 'image/png',
  bytes: new Uint8Array([1, 2, 3]),
})

describe('Word image collection', () => {
  it('collects top-level and inline images', () => {
    const images = collectImportedImages([
      image('top.png'),
      {
        kind: 'paragraph',
        inlines: [
          { kind: 'text', text: '正文', marks: [] },
          { kind: 'inlineImage', image: image('inline.png') },
        ],
      },
      {
        kind: 'list',
        items: [{
          kind: 'listItem',
          level: 0,
          ordered: false,
          inlines: [{ kind: 'inlineImage', image: image('list.png') }],
        }],
      },
    ])

    expect(images.map((item) => item.mediaKey)).toEqual(['top.png', 'inline.png', 'list.png'])
  })

  it('recursively collects images nested inside table cells', () => {
    const images = collectImportedImages([
      {
        kind: 'table',
        rows: [[{
          blocks: [{
            kind: 'paragraph',
            inlines: [{ kind: 'inlineImage', image: image('table.png') }],
          }],
        }]],
      },
    ])

    expect(images.map((item) => item.mediaKey)).toEqual(['table.png'])
  })
})
