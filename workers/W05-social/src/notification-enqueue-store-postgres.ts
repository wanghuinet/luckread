import {
  NotificationEnqueueStoreError,
  type NotificationEnqueueInput,
  type NotificationEnqueueStore,
  type NotificationEnqueueType,
} from './notification-enqueue-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/** Structural node-postgres subset; the Worker bundle does not import a PostgreSQL driver. */
export interface NotificationEnqueuePostgresQueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

const PREFERENCE_COLUMN: Readonly<Record<NotificationEnqueueType, string>> = Object.freeze({
  FOLLOW: 'follow_enabled',
  LIKE: 'like_enabled',
  COMMENT: 'comment_enabled',
  REPLY: 'comment_enabled',
  MENTION: 'mention_enabled',
})

const RETRYABLE_SQLSTATES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '55P03', // lock_not_available
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
])

const isRetryablePostgresFailure = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false
  const value = error as { code?: unknown; name?: unknown }
  if (typeof value.code === 'string') {
    if (value.code.startsWith('08') || RETRYABLE_SQLSTATES.has(value.code)) return true
    if (['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ECONNREFUSED', 'EHOSTUNREACH'].includes(value.code)) return true
  }
  return value.name === 'TimeoutError'
}

/**
 * One parameterized INSERT..SELECT checks both-direction blocks and the
 * recipient preference in the same statement, then relies on the existing
 * unique dedupe key. The AFTER INSERT trigger creates the D1-02 push outbox
 * row atomically in the same PostgreSQL transaction.
 */
export function createPostgresNotificationEnqueueStore(
  db: NotificationEnqueuePostgresQueryExecutor,
): NotificationEnqueueStore {
  return {
    async enqueue(input: NotificationEnqueueInput): Promise<void> {
      const preferenceColumn = PREFERENCE_COLUMN[input.notificationType]
      try {
        await db.query(
          `INSERT INTO social_notifications
             (notification_id, recipient_user_id, actor_user_id, notification_type,
              target_type, target_id, dedupe_key, payload_json, created_at)
           SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9
            WHERE NOT EXISTS (
              SELECT 1
                FROM social_user_interactions
               WHERE relation_type = 'block'
                 AND (
                   (actor_user_id = $3 AND target_user_id = $2)
                   OR (actor_user_id = $2 AND target_user_id = $3)
                 )
            )
              AND COALESCE((
                SELECT ${preferenceColumn}
                  FROM social_notification_preferences
                 WHERE user_id = $2
                 LIMIT 1
              ), 1) <> 0
           ON CONFLICT DO NOTHING`,
          [
            input.notificationId,
            input.recipientUserId,
            input.actorUserId,
            input.notificationType,
            input.targetType,
            input.targetId,
            input.dedupeKey,
            input.payloadJson,
            input.createdAt,
          ],
        )
      } catch (error) {
        throw new NotificationEnqueueStoreError(isRetryablePostgresFailure(error))
      }
    },
  }
}
