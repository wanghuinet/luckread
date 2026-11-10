import {
  CommentMutationStoreError,
  type CommentDeleteInput,
  type CommentDeleteRow,
  type CommentMutationState,
  type CommentMutationStore,
  type CommentUpdateRow,
  type CommentUpdateStoreInput,
} from './comment-mutation-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/** Structural node-postgres subset; no driver is bundled into the W05 Worker. */
export interface CommentMutationPostgresQueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

const COMMENT_UPDATE_RETURNING = \`id, content_id, author_user_id, parent_id, body, state, depth,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at\`

const getForDeleteSql = \`SELECT
    c.id,
    c.content_id,
    c.author_user_id,
    c.state,
    EXISTS (
      SELECT 1
        FROM social_comments child
       WHERE child.parent_id = c.id
    ) AS has_replies
  FROM social_comments c
 WHERE c.id = $1
 LIMIT 1\`

const markDeletedSql = \`UPDATE social_comments
   SET state = 'AUTHOR_DELETED', updated_at = $1::timestamptz
 WHERE id = $2
   AND author_user_id = $3
   AND state = 'PUBLISHED'
   AND NOT EXISTS (
     SELECT 1
       FROM social_comments child
      WHERE child.parent_id = social_comments.id
   )
 RETURNING id\`

const getDeleteStateSql = \`SELECT state
  FROM social_comments
 WHERE id = $1
   AND author_user_id = $2
 LIMIT 1\`

const getForUpdateSql = \`SELECT \${COMMENT_UPDATE_RETURNING}
  FROM social_comments c
 WHERE c.id = $1
 LIMIT 1\`

const updateSql = \`UPDATE social_comments
   SET body = $1, updated_at = $2::timestamptz
 WHERE id = $3
   AND author_user_id = $4
   AND state = 'PUBLISHED'
   AND updated_at = $5::timestamptz
 RETURNING \${COMMENT_UPDATE_RETURNING}\`

export function createPostgresCommentMutationStore(
  db: CommentMutationPostgresQueryExecutor,
): CommentMutationStore {
  return {
    async getForDelete(commentId: string): Promise<CommentDeleteRow | null> {
      try {
        const result = await db.query<CommentDeleteRow>(getForDeleteSql, [commentId])
        return result.rows[0] ?? null
      } catch {
        throw new CommentMutationStoreError()
      }
    },

    async markDeleted(input: CommentDeleteInput): Promise<boolean> {
      try {
        const result = await db.query<{ id: string }>(markDeletedSql, [
          input.now,
          input.commentId,
          input.actorUserId,
        ])
        return result.rows.length === 1
      } catch {
        throw new CommentMutationStoreError()
      }
    },

    async getDeleteState(commentId: string, actorUserId: string): Promise<CommentMutationState | null> {
      try {
        const result = await db.query<{ state: CommentMutationState }>(getDeleteStateSql, [
          commentId,
          actorUserId,
        ])
        return result.rows[0]?.state ?? null
      } catch {
        throw new CommentMutationStoreError()
      }
    },

    async getForUpdate(commentId: string): Promise<CommentUpdateRow | null> {
      try {
        const result = await db.query<CommentUpdateRow>(getForUpdateSql, [commentId])
        return result.rows[0] ?? null
      } catch {
        throw new CommentMutationStoreError()
      }
    },

    async update(input: CommentUpdateStoreInput): Promise<CommentUpdateRow | null> {
      try {
        const result = await db.query<CommentUpdateRow>(updateSql, [
          input.body,
          input.now,
          input.commentId,
          input.actorUserId,
          input.expectedUpdatedAt,
        ])
        return result.rows[0] ?? null
      } catch {
        throw new CommentMutationStoreError()
      }
    },
  }
}
