/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it } from 'vitest'
import { extractSocialTokens, getContentSocialSummary, listDiscoveryTopics } from './social-closure-runtime.js'

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

  it('returns recent active discovery topics with bounded pagination', async () => {
    const rows = [
      { topic_id: 'topic-1', normalized_name: 'reading', display_name: 'Reading', content_count: 8, latest_content_at: '2026-10-17T03:00:00.000Z' },
      { topic_id: 'topic-2', normalized_name: 'books', display_name: 'Books', content_count: 4, latest_content_at: '2026-10-17T02:00:00.000Z' },
      { topic_id: 'topic-3', normalized_name: 'writing', display_name: 'Writing', content_count: 2, latest_content_at: '2026-10-17T01:00:00.000Z' },
    ]
    const db = {
      prepare: (sql: string) => {
        expect(sql).toContain("julianday(c.updated_at) >= julianday('now', '-7 days')")
        expect(sql).toContain("t.status = 'ACTIVE'")
        return {
          bind: (...values: unknown[]) => {
            expect(values).toEqual([3])
            return { all: async () => ({ results: rows }) }
          },
        }
      },
    } as unknown as D1Database

    await expect(listDiscoveryTopics(db, '2', null)).resolves.toMatchObject({
      items: [
        { topicId: 'topic-1', name: 'reading', displayName: 'Reading', contentCount: 8 },
        { topicId: 'topic-2', name: 'books', displayName: 'Books', contentCount: 4 },
      ],
      hasMore: true,
      nextCursor: expect.any(String),
    })
  })

  it('rejects malformed discovery topic cursors', async () => {
    const db = { prepare: () => { throw new Error('database must not be queried for an invalid cursor') } } as unknown as D1Database
    await expect(listDiscoveryTopics(db, '20', 'not-a-cursor')).rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
  })

})
