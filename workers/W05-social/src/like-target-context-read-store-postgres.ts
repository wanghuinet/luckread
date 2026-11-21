import {
  LikeTargetContextReadStoreError,
  type LikeCommentTargetReadRow,
  type LikeTargetContextReadStore,
} from './like-target-context-read-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/** Structural node-postgres subset; no Node driver is bundled into W05 Worker code. */
export interface LikeTargetContextPostgresQueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

function normalizedTargets(actorUserId: string, relatedUserIds: readonly string[]): string[] {
  return [...new Set(relatedUserIds.filter((userId) => userId && userId !== actorUserId))]
}

/** PostgreSQL counterpart for W05 like target/comment visibility and bidirectional Block preflight. */
export function createPostgresLikeTargetContextReadStore(
  db: LikeTargetContextPostgresQueryExecutor,
): LikeTargetContextReadStore {
  return {
    async readCommentTarget(commentId) {
      try {
        const result = await db.query<LikeCommentTargetReadRow>(
          'SELECT id, state, author_user_id, content_id FROM social_comments WHERE id = $1 LIMIT 1',
          [commentId],
        )
        return result.rows[0] ?? null
      } catch {
        throw new LikeTargetContextReadStoreError()
      }
    },

    async hasBidirectionalBlock(actorUserId, relatedUserIds) {
      const targets = normalizedTargets(actorUserId, relatedUserIds)
      if (targets.length === 0) return false
      const targetParameters = targets.map((_, index) => '$' + (index + 2)).join(', ')
      const reverseActorParameter = '$' + (targets.length + 2)
      const reverseTargets = targets.map((_, index) => '$' + (targets.length + 3 + index)).join(', ')
      const values = [actorUserId, ...targets, actorUserId, ...targets]
      try {
        const result = await db.query<{ blocked: boolean }>(
          `SELECT EXISTS (
             SELECT 1
             FROM social_user_interactions block
             WHERE block.relation_type = 'block'
               AND (
                 (block.actor_user_id = $1 AND block.target_user_id IN (${targetParameters}))
                 OR
                 (block.target_user_id = ${reverseActorParameter} AND block.actor_user_id IN (${reverseTargets}))
               )
           ) AS blocked`,
          values,
        )
        return result.rows[0]?.blocked === true
      } catch {
        throw new LikeTargetContextReadStoreError()
      }
    },
  }
}
