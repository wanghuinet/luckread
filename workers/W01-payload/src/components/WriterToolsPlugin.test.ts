import { describe, expect, it } from 'vitest'
import { getWriterStats } from './WriterToolsPlugin.js'

describe('article writer statistics', () => {
  it('counts Unicode characters and structural article blocks', () => {
    const value = {
      version: 2 as const,
      blocks: [
        { id: 'h', type: 'heading' as const, text: '标题', level: 2 as const },
        { id: 'p', type: 'paragraph' as const, text: 'Hello world' },
        { id: 'l', type: 'bulletList' as const, text: 'A\nB' },
        { id: 'i', type: 'image' as const, text: '', mediaRefs: ['https://media.example/a.jpg'] },
        { id: 'g', type: 'gallery' as const, text: '', mediaRefs: [
          'https://media.example/a.jpg',
          'https://media.example/b.jpg',
        ] },
      ],
    }

    expect(getWriterStats('标题 😊\nHello world', value)).toEqual({
      characters: 15,
      words: 3,
      headings: 1,
      lists: 1,
      media: 2,
    })
  })

  it('returns zero word count for whitespace-only text', () => {
    const value = {
      version: 2 as const,
      blocks: [{ id: 'p', type: 'paragraph' as const, text: '' }],
    }

    expect(getWriterStats('   \n\t', value).words).toBe(0)
  })
})
