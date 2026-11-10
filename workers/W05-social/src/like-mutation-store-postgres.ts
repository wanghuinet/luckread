import {
  LikeMutationStoreError,
  type CreateLikeMutationInput,
  type LikeMutationRow,
  type LikeMutationStore,
  type RemoveLikeMutationInput,
} from './like-mutation-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/** Structural node-postgres subset; no Node driver is bundled into W05 Worker code. */
export interface LikeMutationPostgresQueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

const RETURNING = `relationship_id, actor_user_id, target_type, target_id,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at`

const CONTENT_LIKE_SQL = `INSERT INTO interaction_likes
  (relationship_id, actor_user_id, target_type, target_id, created_at)
 SELECT $1, $2, 'content', c.id, $3
   FROM contents c
  WHERE c.id = $4
    AND c.state = 'PUBLISHED'
    AND NOT EXISTS (
      SELECT 1
        FROM social_user_interactions block
       WHERE block.relation_type = 'block'
         AND (
           (block.actor_user_id = $5 AND block.target_user_id = c.owner_user_id)
           OR
           (block.actor_user_id = c.owner_user_id AND block.target_user_id = $6)
         )
    )
 ON CONFLICT (actor_user_id, target_type, target_id)
 DO UPDATE SET relationship_id = interaction_likes.relationship_id
 RETURNING ${RETURNING}`

const COMMENT_LIKE_SQL = `INSERT INTO interaction_likes
  (relationship_id, actor_user_id, target_type, target_id, created_at)
 SELECT $1, $2, 'comment', c.id, $3
   FROM social_comments c
  WHERE c.id = $4
    AND c.state = 'PUBLISHED'
    AND NOT EXISTS (
      SELECT 1
        FROM social_user_interactions block
       WHERE block.relation_type = 'block'
         AND (
           (block.actor_user_id = $5 AND block.target_user_id = c.author_user_id)
           OR
           (block.actor_user_id = c.author_user_id AND block.target_user_id = $6)
           OR
           (block.actor_user_id = $7 AND block.target_user_id = $8)
           OR
           (block.actor_user_id = $9 AND block.target_user_id = $10)
         )
    )
 ON CONFLICT (actor_user_id, target_type, target_id)
 DO UPDATE SET relationship_id = interaction_likes.relationship_id
 RETURNING ${RETURNING}`

/** PostgreSQL counterpart for W05's final guarded like write and idempotent removal. */
export function createPostgresLikeMutationStore(db: LikeMutationPostgresQueryExecutor): LikeMutationStore {
  return {
    async create(input: CreateLikeMutationInput) {
      const sql = input.targetType === 'content' ? CONTENT_LIKE_SQL : COMMENT_LIKE_SQL
      const values = [
        input.relationshipId,
        input.actorUserId,
        input.createdAt,
        input.targetId,
        ...(input.targetType === 'content'
          ? [input.actorUserId, input.actorUserId]
          : [
              input.actorUserId,
              input.actorUserId,
              input.actorUserId,
              input.parentOwnerUserId ?? null,
              input.parentOwnerUserId ?? null,
              input.actorUserId,
            ]),
      ]

      try {
        const result = await db.query<LikeMutationRow>(sql, values)
        return result.rows[0] ?? null
      } catch {
        // Never expose SQL, driver messages, connection metadata or secrets.
        throw new LikeMutationStoreError()
      }
    },

    async remove(input: RemoveLikeMutationInput) {
      try {
        await db.query(
          'DELETE FROM interaction_likes WHERE actor_user_id = $1 AND target_type = $2 AND target_id = $3',
          [input.actorUserId, input.targetType, input.targetId],
        )
      } catch {
        throw new LikeMutationStoreError()
      }
    },
  }
}
