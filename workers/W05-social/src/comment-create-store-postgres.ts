import {
  CommentCreateStoreError,
  type CommentCreateFinalState,
  type CommentCreateInsertInput,
  type CommentCreateStore,
  type CommentCreateValidation,
  type CommentCreateValidationInput,
  type StoredCommentCreate,
} from './comment-create-store.js'
import {
  replyAudienceAllowedPostgresParams,
  replyAudienceAllowedPostgresSql,
} from './reply-audience-postgres-predicate.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/** Structural node-postgres subset; no driver is bundled into the W05 Worker. */
export interface CommentCreatePostgresQueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

const validateSql = `WITH existing_comment AS (
  SELECT id, content_id, parent_id, body, author_user_id, state, depth,
         to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
         to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at
    FROM social_comments
   WHERE author_user_id = $1 AND idempotency_key = $10
   LIMIT 1
)
SELECT
  ec.id AS existing_id,
  ec.content_id AS existing_content_id,
  ec.parent_id AS existing_parent_id,
  ec.body AS existing_body,
  ec.author_user_id AS existing_author_user_id,
  ec.state AS existing_state,
  ec.depth AS existing_depth,
  ec.created_at AS existing_created_at,
  ec.updated_at AS existing_updated_at,
  (SELECT state FROM contents WHERE id = $11 LIMIT 1) AS content_state,
  (SELECT owner_user_id FROM contents WHERE id = $11 LIMIT 1) AS content_owner_user_id,
  (SELECT content_id FROM social_comments WHERE id = $12::text LIMIT 1) AS parent_content_id,
  (SELECT author_user_id FROM social_comments WHERE id = $12::text LIMIT 1) AS parent_author_user_id,
  (SELECT state FROM social_comments WHERE id = $12::text LIMIT 1) AS parent_state,
  (SELECT depth FROM social_comments WHERE id = $12::text LIMIT 1) AS parent_depth,
  (SELECT COUNT(*)::integer FROM social_comments
    WHERE author_user_id = $1 AND created_at > NOW() - INTERVAL '60 seconds') AS recent_count,
  EXISTS (
    SELECT 1
      FROM social_user_interactions block
     WHERE block.relation_type = 'block'
       AND (
         (block.actor_user_id = $1 AND block.target_user_id = (SELECT owner_user_id FROM contents WHERE id = $11 LIMIT 1))
         OR
         (block.actor_user_id = (SELECT owner_user_id FROM contents WHERE id = $11 LIMIT 1) AND block.target_user_id = $1)
         OR
         (block.actor_user_id = $1 AND block.target_user_id = (SELECT author_user_id FROM social_comments WHERE id = $12::text LIMIT 1))
         OR
         (block.actor_user_id = (SELECT author_user_id FROM social_comments WHERE id = $12::text LIMIT 1) AND block.target_user_id = $1)
       )
  ) AS blocked,
  (
    SELECT CASE WHEN ${replyAudienceAllowedPostgresSql} THEN TRUE ELSE FALSE END
      FROM contents content
     WHERE content.id = $11
  ) AS reply_audience_allowed
FROM (SELECT 1) seed
LEFT JOIN existing_comment ec ON TRUE`

const insertSql = `INSERT INTO social_comments
  (id, content_id, author_user_id, parent_id, body, state, depth, idempotency_key, created_at, updated_at)
SELECT $10, $11, $12, $13::text, $14, 'PUBLISHED', $15, $16, $17::timestamptz, $18::timestamptz
  FROM contents content
 WHERE content.id = $19
   AND content.state = 'PUBLISHED'
   AND (
     $20::text IS NULL
     OR EXISTS (
       SELECT 1
         FROM social_comments parent
        WHERE parent.id = $21
          AND parent.content_id = content.id
          AND parent.state = 'PUBLISHED'
          AND parent.depth < 3
     )
   )
   AND NOT EXISTS (
     SELECT 1
       FROM social_user_interactions block
      WHERE block.relation_type = 'block'
        AND (
          (block.actor_user_id = $22 AND block.target_user_id = content.owner_user_id)
          OR
          (block.actor_user_id = content.owner_user_id AND block.target_user_id = $23)
          OR
          (block.actor_user_id = $24 AND block.target_user_id = (
            SELECT author_user_id FROM social_comments WHERE id = $25 LIMIT 1
          ))
          OR
          (block.actor_user_id = (
            SELECT author_user_id FROM social_comments WHERE id = $26 LIMIT 1
          ) AND block.target_user_id = $27)
        )
   )
   AND ${replyAudienceAllowedPostgresSql}
ON CONFLICT (author_user_id, idempotency_key)
DO UPDATE SET id = social_comments.id
RETURNING id, content_id, author_user_id, parent_id, body, state, depth,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at`

const finalStateSql = `SELECT content.state AS content_state,
  CASE WHEN ${replyAudienceAllowedPostgresSql} THEN TRUE ELSE FALSE END AS reply_audience_allowed
FROM contents content
WHERE content.id = $10
LIMIT 1`

export function createPostgresCommentCreateStore(
  db: CommentCreatePostgresQueryExecutor,
): CommentCreateStore {
  return {
    async validate(input: CommentCreateValidationInput) {
      try {
        const result = await db.query<CommentCreateValidation>(validateSql, [
          ...replyAudienceAllowedPostgresParams(input.actorUserId, input.actorVerified),
          input.idempotencyKey,
          input.contentId,
          input.parentId,
        ])
        return result.rows[0] ?? null
      } catch {
        throw new CommentCreateStoreError()
      }
    },

    async insert(input: CommentCreateInsertInput) {
      try {
        const values = [
          ...replyAudienceAllowedPostgresParams(input.actorUserId, input.actorVerified),
          input.id,
          input.contentId,
          input.actorUserId,
          input.parentId,
          input.body,
          input.depth,
          input.idempotencyKey,
          input.now,
          input.now,
          input.contentId,
          input.parentId,
          input.parentId,
          input.actorUserId,
          input.actorUserId,
          input.actorUserId,
          input.parentId,
          input.parentId,
          input.actorUserId,
        ]
        const result = await db.query<StoredCommentCreate>(insertSql, values)
        return result.rows[0] ?? null
      } catch {
        throw new CommentCreateStoreError()
      }
    },

    async getFinalState(input) {
      try {
        const result = await db.query<CommentCreateFinalState>(finalStateSql, [
          ...replyAudienceAllowedPostgresParams(input.actorUserId, input.actorVerified),
          input.contentId,
        ])
        return result.rows[0] ?? null
      } catch {
        throw new CommentCreateStoreError()
      }
    },
  }
}
