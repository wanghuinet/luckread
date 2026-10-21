/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { enqueueNotification, extractSocialTokens, getContentSocialSummary, listDiscoveryTopics, syncSocialTokens } from './social-closure-runtime.js'

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

  it('uses W03 content context and W05-only SQL for social summary counts and pin state', async () => {
    const firstResults: unknown[] = [
      { likes: 3, comments: 2, favorites: 1, shares: 4, reposts: 7, pinned: 1 },
      { liked: 1, favorited: 0, reposted: 1 },
    ]
    const queries: string[] = []
    const db = {
      prepare: (sql: string) => {
        queries.push(sql)
        return {
          bind: (..._values: unknown[]) => ({
            first: async () => firstResults.shift() ?? null,
            all: async () => ({ results: [] }),
          }),
        }
      },
    } as unknown as D1Database
    const contentContext = {
      contentId: 'content-1',
      ownerUserId: 'owner-1',
      contentType: 'post',
      state: 'PUBLISHED',
      updatedAt: '2026-10-17T04:00:00.000Z',
    } as const

    await expect(getContentSocialSummary(db, 'content-1', contentContext, 'viewer-1')).resolves.toMatchObject({
      contentId: 'content-1',
      contentType: 'post',
      counts: { likes: 3, comments: 2, favorites: 1, shares: 4, reposts: 7 },
      pinned: true,
      viewer: { liked: true, favorited: false, reposted: true },
      topics: [],
      mentions: [],
    })
    expect(queries.some(sql => /(?:FROM|JOIN)\s+contents/i.test(sql))).toBe(false)
    const countsQuery = queries.find(sql => sql.includes('AS pinned'))
    expect(countsQuery).toContain('FROM social_profile_pins p')
    expect(countsQuery).not.toContain('JOIN contents')
  })

  it('rejects a mismatched or unpublished social context before querying W05', async () => {
    const prepare = vi.fn()
    const db = { prepare } as unknown as D1Database
    await expect(getContentSocialSummary(db, 'content-1', {
      contentId: 'another-content',
      ownerUserId: 'owner-1',
      contentType: 'post',
      state: 'PUBLISHED',
      updatedAt: '2026-10-17T04:00:00.000Z',
    })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    await expect(getContentSocialSummary(db, 'content-1', {
      contentId: 'content-1',
      ownerUserId: 'owner-1',
      contentType: 'post',
      state: 'UNPUBLISHED',
    } as never)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect(prepare).not.toHaveBeenCalled()
  })

  it('validates content token synchronization through W03 context and writes only W05-owned edges', async () => {
    const queries: string[] = []
    const batch = vi.fn(async () => [])
    const db = {
      prepare: (sql: string) => {
        queries.push(sql)
        return { bind: (..._values: unknown[]) => ({ run: async () => ({ success: true, meta: { changes: 1 } } }) }
      },
      batch,
    } as unknown as D1Database
    const contentContext = {
      contentId: 'content-1',
      ownerUserId: 'owner-1',
      contentType: 'post',
      state: 'PUBLISHED',
      updatedAt: '2026-10-17T04:00:00.000Z',
    } as const

    await expect(syncSocialTokens(db, 'owner-1', 'content', 'content-1', 'plain text', [], contentContext))
      .resolves.toEqual({ topics: 0, mentions: 0 })
    expect(batch).toHaveBeenCalledTimes(1)
    expect(queries.some(sql => /(?:FROM|JOIN)\s+contents/i.test(sql))).toBe(false)
    expect(queries.every(sql => !/\b(?:FROM|JOIN)\s+contents\b/i.test(sql))).toBe(true)
  })

  it('fails closed for content token sync without W03 context or when the actor is not the owner', async () => {
    const prepare = vi.fn()
    const db = { prepare } as unknown as D1Database
    await expect(syncSocialTokens(db, 'owner-1', 'content', 'content-1', 'plain text'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
    await expect(syncSocialTokens(db, 'owner-1', 'content', 'content-1', 'plain text', [], {
      contentId: 'content-1',
      ownerUserId: 'someone-else',
      contentType: 'post',
      state: 'PUBLISHED',
      updatedAt: '2026-10-17T04:00:00.000Z',
    })).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 })
    expect(prepare).not.toHaveBeenCalled()
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


  it('logs notification write failures without exposing identifiers or database details', async () => {
    const db = {
      prepare: (sql: string) => ({
        bind: (..._values: unknown[]) => ({
          first: async () => null,
          run: async () => {
            if (sql.includes('INSERT OR IGNORE INTO social_notifications')) {
              throw new Error('private database detail that must not be logged')
            }
            return { success: true, meta: { changes: 1 } }
          },
        }),
      }),
    } as unknown as D1Database
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      await expect(enqueueNotification(db, {
        recipientUserId: 'recipient-1',
        actorUserId: 'actor-1',
        type: 'COMMENT',
        targetType: 'content',
        targetId: 'content-1',
      })).resolves.toBeUndefined()

      expect(warning).toHaveBeenCalledWith('W05_SOCIAL_NOTIFICATION_WRITE_FAILED', {
        type: 'COMMENT',
        targetType: 'content',
        errorName: 'Error',
      })
      expect(JSON.stringify(warning.mock.calls)).not.toContain('recipient-1')
      expect(JSON.stringify(warning.mock.calls)).not.toContain('content-1')
      expect(JSON.stringify(warning.mock.calls)).not.toContain('private database detail')
    } finally {
      warning.mockRestore()
    }
  })

})
