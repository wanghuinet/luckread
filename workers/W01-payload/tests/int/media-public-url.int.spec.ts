import { describe, expect, it } from 'vitest'

import {
  createPublicMediaUrl,
  PUBLIC_IMAGE_MEDIA_ORIGIN,
  PUBLIC_VIDEO_MEDIA_ORIGIN,
} from '../../src/media/public-media-url.js'

describe('canonical R2 public media URLs', () => {
  it('routes image and non-video assets through the image hostname', () => {
    expect(createPublicMediaUrl({ filename: 'photo.png' })).toBe(
      'https://img.luckread.com/photo.png',
    )
    expect(createPublicMediaUrl({ filename: 'article-body.json' })).toBe(
      'https://img.luckread.com/article-body.json',
    )
    expect(PUBLIC_IMAGE_MEDIA_ORIGIN).toBe('https://img.luckread.com')
  })

  it('routes video files through the video hostname case-insensitively', () => {
    expect(createPublicMediaUrl({ filename: 'launch.MP4' })).toBe(
      'https://video.luckread.com/launch.MP4',
    )
    expect(createPublicMediaUrl({ filename: 'clip.webm' })).toBe(
      'https://video.luckread.com/clip.webm',
    )
    expect(PUBLIC_VIDEO_MEDIA_ORIGIN).toBe('https://video.luckread.com')
  })

  it('routes HLS/DASH manifests and segments through the video hostname', () => {
    expect(createPublicMediaUrl({ filename: 'master.m3u8' })).toBe(
      'https://video.luckread.com/master.m3u8',
    )
    expect(createPublicMediaUrl({ filename: 'segment.m4s' })).toBe(
      'https://video.luckread.com/segment.m4s',
    )
    expect(createPublicMediaUrl({ filename: 'manifest.mpd' })).toBe(
      'https://video.luckread.com/manifest.mpd',
    )
  })

  it('preserves nested object prefixes and encodes each path segment', () => {
    expect(createPublicMediaUrl({
      prefix: '/creator uploads/2026/',
      filename: 'photo (1).png',
    })).toBe('https://img.luckread.com/creator%20uploads/2026/photo%20(1).png')
    expect(createPublicMediaUrl({
      prefix: 'creator uploads/2026/',
      filename: 'clip (1).mp4',
    })).toBe('https://video.luckread.com/creator%20uploads/2026/clip%20(1).mp4')
  })

  it('rejects empty filenames and traversal segments', () => {
    expect(() => createPublicMediaUrl({ filename: ' ' })).toThrow('Invalid R2 media object key')
    expect(() => createPublicMediaUrl({ filename: '../secret.png' })).toThrow('Invalid R2 media object key')
    expect(() => createPublicMediaUrl({ prefix: 'creator/../private', filename: 'secret.png' }))
      .toThrow('Invalid R2 media object key')
  })
})
