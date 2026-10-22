import { describe, expect, it } from 'vitest'

import { createPublicMediaUrl } from '../../src/media/public-media-url.js'

describe('canonical R2 public media URLs', () => {
  it('builds an absolute URL on the LuckRead CDN domain', () => {
    expect(createPublicMediaUrl({ filename: 'photo.png' })).toBe(
      'https://cdn.luckread.com/photo.png',
    )
  })

  it('preserves nested object prefixes and encodes each path segment', () => {
    expect(createPublicMediaUrl({
      prefix: '/creator uploads/2026/',
      filename: 'photo (1).png',
    })).toBe('https://cdn.luckread.com/creator%20uploads/2026/photo%20(1).png')
  })

  it('rejects empty filenames and traversal segments', () => {
    expect(() => createPublicMediaUrl({ filename: ' ' })).toThrow('Invalid R2 media object key')
    expect(() => createPublicMediaUrl({ prefix: 'creator/../private', filename: 'secret.png' }))
      .toThrow('Invalid R2 media object key')
  })
})
