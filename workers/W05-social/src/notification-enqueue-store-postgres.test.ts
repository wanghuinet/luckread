import { describe, expect, it } from 'vitest'

import { NotificationEnqueueStoreError } from './notification-enqueue-store.js'
import {
  createPostgresNotificationEnqueueStore,
  type NotificationEnqueuePostgresQueryExecutor,
} from './notification-enqueue-store-postgres.js'
import type { NotificationEnqueueInput } from './notification-enqueue-store.js'

const input: NotificationEnqueueInput = {
  notificationId: 'notification-1',
  recipientUserId: 'recipient-1',
  actorUserId: 'actor-1',
  notificationType: 'MENTION',
  targetType: 'comment',
  targetId: 'comment-1',
  dedupeKey: 'MENTION:recipient-1:actor-1:comment:comment-1',
  payloadJson: '{"handle":"reader"}',
  createdAt: '2026-11-10T00:00:00.000Z',
}

function executor(options: {
  error?: { code?: string; name?: string; message?: string }
} = {}) {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const db: NotificationEnqueuePostgresQueryExecutor = {
    async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
      calls.push({ sql, values })
      if (options.error) throw options.error
      return { rows: [] as Row[] }
    },
  }
  return { db, calls }
}

describe('W05 PostgreSQL notification enqueue store', () => {
  it('checks bilateral blocks and default-on preferences atomically with an idempotent notification insert', async () => {
    const { db, calls } = executor()
    await createPostgresNotificationEnqueueStore(db).enqueue(input)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.sql).toContain('INSERT INTO social_notifications')
    expect(calls[0]?.sql).toContain('SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9')
    expect(calls[0]?.sql).toContain("relation_type = 'block'")
    expect(calls[0]?.sql).toContain('(actor_user_id = $3 AND target_user_id = $2)')
    expect(calls[0]?.sql).toContain('(actor_user_id = $2 AND target_user_id = $3)')
    expect(calls[0]?.sql).toContain('mention_enabled')
    expect(calls[0]?.sql).toContain('WHERE user_id = $2')
    expect(calls[0]?.sql).toContain('COALESCE((')
    expect(calls[0]?.sql).toContain('ON CONFLICT DO NOTHING')
    expect(calls[0]?.values).toEqual([
      'notification-1', 'recipient-1', 'actor-1', 'MENTION', 'comment', 'comment-1',
      input.dedupeKey, input.payloadJson, input.createdAt,
    ])
  })

  it.each([
    ['FOLLOW', 'follow_enabled'],
    ['LIKE', 'like_enabled'],
    ['COMMENT', 'comment_enabled'],
    ['REPLY', 'comment_enabled'],
    ['MENTION', 'mention_enabled'],
  ] as const)('selects the allowlist preference column for %s', async (notificationType, column) => {
    const { db, calls } = executor()
    await createPostgresNotificationEnqueueStore(db).enqueue({ ...input, notificationType })
    expect(calls[0]?.sql).toContain(column)
  })

  it('sanitizes permanent provider errors and preserves retry classification', async () => {
    const permanent = createPostgresNotificationEnqueueStore(executor({
      error: { code: '23514', message: 'secret host, schema and payload detail' },
    }).db)
    await expect(permanent.enqueue(input)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
      message: 'NOTIFICATION_ENQUEUE_STORE_UNAVAILABLE',
      retryable: false,
    })

    const transient = createPostgresNotificationEnqueueStore(executor({
      error: { code: '40001', message: 'private serialization detail' },
    }).db)
    await expect(transient.enqueue(input)).rejects.toBeInstanceOf(NotificationEnqueueStoreError)
    await expect(transient.enqueue(input)).rejects.toMatchObject({ retryable: true })
  })

  it('treats connection resets and driver timeouts as retryable without exposing details', async () => {
    const reset = createPostgresNotificationEnqueueStore(executor({
      error: { code: 'ECONNRESET', message: 'secret connection string' },
    }).db)
    await expect(reset.enqueue(input)).rejects.toMatchObject({ retryable: true, message: 'NOTIFICATION_ENQUEUE_STORE_UNAVAILABLE' })

    const timeout = createPostgresNotificationEnqueueStore(executor({
      name: 'TimeoutError',
    }).db)
    await expect(timeout.enqueue(input)).rejects.toMatchObject({ retryable: true })
  })
})
