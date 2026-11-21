import { describe, expect, it, vi } from 'vitest'
import {
  createPostgresCommentNotificationContextStore,
  type CommentNotificationContextPostgresExecutor,
} from './comment-notification-context-store-postgres.js'
import { CommentNotificationContextStoreError } from './comment-notification-context-store.js'

describe('W05 comment notification context PostgreSQL store', () => {
  it('uses a parameterized published-only projection', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const row = {
      comment_id: 'comment-1',
      content_id: 'content-1',
      author_user_id: 'author-1',
    }
    const db: CommentNotificationContextPostgresExecutor = {
      async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
        calls.push({ sql, values })
        return { rows: [row as Row] }
      },
    }

    await expect(createPostgresCommentNotificationContextStore(db).getPublishedContext('comment-1'))
      .resolves.toEqual(row)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.sql).toContain('FROM social_comments')
    expect(calls[0]?.sql).toContain("state = 'PUBLISHED'")
    expect(calls[0]?.sql).toContain('id = $1')
    expect(calls[0]?.values).toEqual(['comment-1'])
  })

  it('returns null for missing or non-published comments', async () => {
    const db: CommentNotificationContextPostgresExecutor = {
      async query<Row extends Record<string, unknown>>() { return { rows: [] as Row[] } },
    }
    await expect(createPostgresCommentNotificationContextStore(db).getPublishedContext('comment-hidden'))
      .resolves.toBeNull()
  })

  it('sanitizes PostgreSQL errors', async () => {
    const query = vi.fn(async () => { throw new Error('postgres://private:secret@host/db') })
    const store = createPostgresCommentNotificationContextStore({
      query,
    } as unknown as CommentNotificationContextPostgresExecutor)
    await expect(store.getPublishedContext('comment-1')).rejects.toBeInstanceOf(CommentNotificationContextStoreError)
    await expect(store.getPublishedContext('comment-1'))
      .rejects.toThrow('COMMENT_NOTIFICATION_CONTEXT_STORE_UNAVAILABLE')
  })
})
