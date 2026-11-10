export type NotificationEnqueueType = 'FOLLOW' | 'LIKE' | 'COMMENT' | 'REPLY' | 'MENTION'
export type NotificationEnqueueTargetType = 'user' | 'content' | 'comment'

export type NotificationEnqueueInput = Readonly<{
  notificationId: string
  recipientUserId: string
  actorUserId: string
  notificationType: NotificationEnqueueType
  targetType: NotificationEnqueueTargetType
  targetId: string
  dedupeKey: string
  payloadJson: string
  createdAt: string
}>

export interface NotificationEnqueueStore {
  enqueue(input: NotificationEnqueueInput): Promise<void>
}

/** Provider failures are sanitized before crossing the W05 runtime boundary. */
export class NotificationEnqueueStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor(readonly retryable: boolean) {
    super('NOTIFICATION_ENQUEUE_STORE_UNAVAILABLE')
    this.name = 'NotificationEnqueueStoreError'
  }
}

export interface NotificationEnqueueD1Database {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>
      run(): Promise<unknown>
    }
  }
}

const PREFERENCE_COLUMN: Readonly<Record<NotificationEnqueueType, string>> = Object.freeze({
  FOLLOW: 'follow_enabled',
  LIKE: 'like_enabled',
  COMMENT: 'comment_enabled',
  REPLY: 'comment_enabled',
  MENTION: 'mention_enabled',
})

/** D1 remains the production-default adapter and preserves the existing bounded retry sequence. */
export function createD1NotificationEnqueueStore(
  db: NotificationEnqueueD1Database,
): NotificationEnqueueStore {
  return {
    async enqueue(input) {
      const blocked = await db.prepare(
        `SELECT 1 FROM social_user_interactions
          WHERE relation_type = 'block'
            AND (
              (actor_user_id = ? AND target_user_id = ?)
              OR (actor_user_id = ? AND target_user_id = ?)
            )
          LIMIT 1`,
      ).bind(
        input.actorUserId,
        input.recipientUserId,
        input.recipientUserId,
        input.actorUserId,
      ).first()
      if (blocked) return

      const preferenceColumn = PREFERENCE_COLUMN[input.notificationType]
      const preference = await db.prepare(
        'SELECT ' + preferenceColumn + ' AS enabled FROM social_notification_preferences WHERE user_id = ? LIMIT 1',
      ).bind(input.recipientUserId).first<{ enabled: number | string | boolean }>()
      if (preference && Number(preference.enabled) === 0) return

      await db.prepare(
        `INSERT OR IGNORE INTO social_notifications
          (notification_id, recipient_user_id, actor_user_id, notification_type, target_type, target_id, dedupe_key, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        input.notificationId,
        input.recipientUserId,
        input.actorUserId,
        input.notificationType,
        input.targetType,
        input.targetId,
        input.dedupeKey,
        input.payloadJson,
        input.createdAt,
      ).run()
    },
  }
}
