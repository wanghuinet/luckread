import { describe, expect, it } from 'vitest'
import {
  createD1CommentNotificationContextStore,
  CommentNotificationContextStoreError,
  type CommentNotificationContextD1Executor,
} from './comment-notification-context-store.js'

describe('W05 comment notification context D1 store', () => {
  it('reads only published comments and returns the recipient plus parent content', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const row = {
      comment_id: 'comment-1',
      content_id: 'content-1',
      author_user_id: 'author-1',
    }
    const db: CommentNotificationContextD1Executor = {
      prepare(sql) {
        return {
          bind(...values) {
            calls.push({ sql, values })
            return { async first<Row>() { return row as Row } }
          },
        }
      },
    }

    await expect(createD1CommentNotificationContextStore(db).getPublishedContext('comment-1'))
      .resolves.toEqual(row)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.sql).toContain('FROM social_comments')
    expect(calls[0]?.sql).toContain("state = 'PUBLISHED'")
    expect(calls[0]?.values).toEqual(['comment-1'])
  })

  it('returns null when a comment is missing or not published', async () => {
    const db: CommentNotificationContextD1Executor = {
      prepare() {
        return {
          bind() { return { async first<Row>() { return null as Row | null } } },
        }
      },
    }
    await expect(createD1CommentNotificationContextStore(db).getPublishedContext('comment-hidden'))
      .resolves.toBeNull()
  })

  it('sanitizes D1 storage errors', async () => {
    const db: CommentNotificationContextD1Executor = {
      prepare() {
        return {
          bind() {
            return { async first<Row>() { throw new Error('private D1 connection metadata') } }
          },
        }
      },
    }
    await expect(createD1CommentNotificationContextStore(db).getPublishedContext('comment-1'))
      .rejects.toBeInstanceOf(CommentNotificationContextStoreError)
    await expect(createD1CommentNotificationContextStore(db).getPublishedContext('comment-1'))
      .rejects.toThrow('COMMENT_NOTIFICATION_CONTEXT_STORE_UNAVAILABLE')
  })
})
