import { describe, expect, it } from 'vitest'
import { createPublicMediaUrl } from '../../src/media/public-media-url'

describe('public media URL routing', () => {
  it('uses the image host for image assets and encodes nested object keys', () => {
    expect(createPublicMediaUrl({ filename: '1000140398.png', prefix: 'media' }))
      .toBe('https://img.luckread.com/media/1000140398.png')
    expect(createPublicMediaUrl({ filename: 'profile photo.webp', prefix: 'users/42' }))
      .toBe('https://img.luckread.com/users/42/profile%20photo.webp')
  })

  it('uses the video host for video files and adaptive-streaming resources', () => {
    expect(createPublicMediaUrl({ filename: 'clip.MP4', prefix: 'media' }))
      .toBe('https://video.luckread.com/media/clip.MP4')
    expect(createPublicMediaUrl({ filename: 'clip.MP4' })).toBe('https://video.luckread.com/clip.MP4')
    expect(createPublicMediaUrl({ filename: 'index.m3u8', prefix: 'streams/abc' }))
      .toBe('https://video.luckread.com/streams/abc/index.m3u8')
  })

  it('rejects empty filenames, path separators in filenames, and traversal segments', () => {
    expect(() => createPublicMediaUrl({ filename: '' })).toThrow()
    expect(() => createPublicMediaUrl({ filename: '../private.jpg' })).toThrow()
    expect(() => createPublicMediaUrl({ filename: 'folder/file.jpg' })).toThrow()
    expect(() => createPublicMediaUrl({ filename: 'file.jpg', prefix: '../private' })).toThrow()
  })
})
