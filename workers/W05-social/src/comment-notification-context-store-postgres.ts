import {
  CommentNotificationContextStoreError,
  type CommentNotificationContextRow,
  type CommentNotificationContextStore,
} from './comment-notification-context-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/** Structural node-postgres subset; no Node driver is bundled into W05 Worker code. */
export interface CommentNotificationContextPostgresExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

/** PostgreSQL counterpart for the W05-owned published-comment projection. */
export function createPostgresCommentNotificationContextStore(
  db: CommentNotificationContextPostgresExecutor,
): CommentNotificationContextStore {
  return {
    async getPublishedContext(commentId: string) {
      try {
        const result = await db.query<CommentNotificationContextRow & Record<string, unknown>>(
          `SELECT
             id AS comment_id,
             content_id,
             author_user_id
           FROM social_comments
           WHERE id = $1
             AND state = 'PUBLISHED'
           LIMIT 1`,
          [commentId],
        )
        return result.rows[0] ?? null
      } catch {
        // Never expose driver messages or connection metadata to Worker callers.
        throw new CommentNotificationContextStoreError()
      }
    },
  }
}
