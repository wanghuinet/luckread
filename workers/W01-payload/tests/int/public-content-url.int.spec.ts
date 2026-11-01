import { describe, expect, it } from 'vitest'

import { buildPublicContentHref } from '../../src/lib/public-content-url.js'

describe('canonical public content URLs', () => {
  it('uses the author handle and immutable content ID for articles, posts, and videos', () => {
    expect(buildPublicContentHref({
      id: 'content-article-1',
      slug: 'a-readable-article-slug',
      contentType: 'article',
      creator: { username: 'writer' },
    })).toBe('/@writer/article/content-article-1')

    expect(buildPublicContentHref({
      id: 'content-post-1',
      contentType: 'post',
      author: { username: 'writer' },
    })).toBe('/@writer/post/content-post-1')

    expect(buildPublicContentHref({
      id: 'content-video-1',
      contentType: 'video',
      creator: { username: '@video-maker' },
    })).toBe('/@video-maker/video/content-video-1')
  })

  it('uses the short-video segment when requested', () => {
    expect(buildPublicContentHref({
      id: 'content-short-1',
      contentType: 'video',
      authorUsername: 'creator',
    }, { short: true })).toBe('/@creator/short/content-short-1')
  })

  it('keeps older links compatible when an author handle is not available', () => {
    expect(buildPublicContentHref({
      id: 'content-legacy-1',
      slug: 'old-readable-slug',
      contentType: 'article',
    })).toBe('/content/old-readable-slug')
  })
})
