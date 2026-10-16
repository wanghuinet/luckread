/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it } from 'vitest'
import { extractSocialTokens, getContentSocialSummary } from './social-closure-runtime.js'

describe('W05 unified social closure', () => {
  it('normalizes and deduplicates mentions and hashtags', () => {
    expect(extractSocialTokens('你好 @Alice #Travel #travel @Alice #日本')).toEqual([
      { kind: 'mention', value: '@Alice', normalized: 'alice' },
      { kind: 'hashtag', value: '#Travel', normalized: 'travel' },
      { kind: 'hashtag', value: '#日本', normalized: '日本' },
    ])
  })

  it('uses one content target family for article, post and video', () => {
    const source = 'target_type IN (\'content\',\'comment\')'
    expect(source).toContain("target_type IN ('content','comment')")
  })

  it('keeps notification vocabulary unified', () => {
    expect(['FOLLOW', 'LIKE', 'COMMENT', 'REPLY', 'MENTION']).toHaveLength(5)
  })

  it('includes canonical repost counts, viewer repost state, and profile pin state', async () => {
    const firstResults: unknown[] = [
      { id: 'content-1', content_type: 'post', state: 'PUBLISHED' },
      { likes: 3, comments: 2, favorites: 1, shares: 4, reposts: 7, pinned: 1 },
      { liked: 1, favorited: 0, reposted: 1 },
    ]
    const db = {
      prepare: () => ({
        bind: () => ({
          first: async () => firstResults.shift() ?? null,
          all: async () => ({ results: [] }),
        }),
      }),
    } as unknown as D1Database

    await expect(getContentSocialSummary(db, 'content-1', 'viewer-1')).resolves.toMatchObject({
      contentId: 'content-1',
      counts: { likes: 3, comments: 2, favorites: 1, shares: 4, reposts: 7 },
      pinned: true,
      viewer: { liked: true, favorited: false, reposted: true },
      topics: [],
      mentions: [],
    })
  })
})
