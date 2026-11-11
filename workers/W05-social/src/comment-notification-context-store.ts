export type CommentNotificationContextRow = Readonly<{
  comment_id: string
  content_id: string
  author_user_id: string | null
}>

export interface CommentNotificationContextStore {
  getPublishedContext(commentId: string): Promise<CommentNotificationContextRow | null>
}

export interface CommentNotificationContextD1Executor {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>
    }
  }
}

export class CommentNotificationContextStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('COMMENT_NOTIFICATION_CONTEXT_STORE_UNAVAILABLE')
    this.name = 'CommentNotificationContextStoreError'
  }
}

/** D1 remains the production-default adapter until a separately authorized cutover. */
export function createD1CommentNotificationContextStore(
  db: CommentNotificationContextD1Executor,
): CommentNotificationContextStore {
  return {
    async getPublishedContext(commentId) {
      try {
        const row = await db.prepare(
          `SELECT id AS comment_id, content_id, author_user_id
             FROM social_comments
            WHERE id = ? AND state = 'PUBLISHED'
            LIMIT 1`,
        ).bind(commentId).first<CommentNotificationContextRow>()
        return row ?? null
      } catch {
        throw new CommentNotificationContextStoreError()
      }
    },
  }
}
