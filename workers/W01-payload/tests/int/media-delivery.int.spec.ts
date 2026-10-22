import { describe, expect, it } from 'vitest'
import {
  mediaHostKind,
  mediaTypeAllowed,
  parseMediaByteRange,
  resolveMediaObjectKey,
} from '../../src/media/media-delivery'

describe('authorized media CDN delivery primitives', () => {
  it('accepts nested keys but rejects traversal and encoded path separators after decoding', () => {
    expect(resolveMediaObjectKey(['2026', '10', 'photo one.webp'])).toBe('2026/10/photo one.webp')
    expect(resolveMediaObjectKey(['..', 'secret.jpg'])).toBeNull()
    expect(resolveMediaObjectKey(['folder/name.jpg'])).toBeNull()
    expect(resolveMediaObjectKey(['folder\\name.jpg'])).toBeNull()
    expect(resolveMediaObjectKey([''])).toBeNull()
  })

  it('recognizes only the two explicitly assigned CDN hosts', () => {
    expect(mediaHostKind('img.luckread.com')).toBe('image')
    expect(mediaHostKind('VIDEO.LUCKREAD.COM')).toBe('video')
    expect(mediaHostKind('evil.example')).toBeNull()
  })

  it('does not serve video objects from the image host or image objects from the video host', () => {
    expect(mediaTypeAllowed('image', 'folder/picture.webp', 'image/webp')).toBe(true)
    expect(mediaTypeAllowed('image', 'folder/clip.mp4', 'video/mp4')).toBe(false)
    expect(mediaTypeAllowed('video', 'folder/clip.mp4', 'video/mp4')).toBe(true)
    expect(mediaTypeAllowed('video', 'folder/clip.m3u8', 'application/vnd.apple.mpegurl')).toBe(true)
    expect(mediaTypeAllowed('video', 'folder/picture.webp', 'image/webp')).toBe(false)
    expect(mediaTypeAllowed('image', 'picture.webp', null)).toBe(false)
  })

  it('supports bounded single byte ranges and rejects invalid or multipart ranges', () => {
    expect(parseMediaByteRange(null, 100)).toBeNull()
    expect(parseMediaByteRange('bytes=10-19', 100)).toEqual({ offset: 10, length: 10 })
    expect(parseMediaByteRange('bytes=90-', 100)).toEqual({ offset: 90, length: 10 })
    expect(parseMediaByteRange('bytes=-10', 100)).toEqual({ offset: 90, length: 10 })
    expect(parseMediaByteRange('bytes=100-120', 100)).toBe('invalid')
    expect(parseMediaByteRange('bytes=0-1,4-5', 100)).toBe('invalid')
  })
})
