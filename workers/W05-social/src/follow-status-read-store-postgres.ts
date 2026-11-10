import { FollowStoreError } from './follow-store.js'
import type {
  FollowStatusReadInput,
  FollowStatusReadRow,
  FollowStatusReadStore,
} from './follow-status-read-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

export interface FollowStatusPostgresQueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

/** PostgreSQL counterpart to the bounded W05 follow-status point read. */
export function createPostgresFollowStatusReadStore(
  db: FollowStatusPostgresQueryExecutor,
): FollowStatusReadStore {
  return {
    async getStatus(input: FollowStatusReadInput) {
      try {
        const result = await db.query<FollowStatusReadRow>(
          `SELECT
             rel.relationship_id,
             to_char(
               rel.created_at AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
             ) AS created_at,
             EXISTS (
               SELECT 1
                 FROM social_user_interactions block
                WHERE block.relation_type = 'block'
                  AND (
                    (block.actor_user_id = $1 AND block.target_user_id = $2)
                    OR
                    (block.actor_user_id = $2 AND block.target_user_id = $1)
                  )
             ) AS blocked
           FROM social_follow_relationships rel
           WHERE rel.follower_user_id = $1 AND rel.target_user_id = $2
           LIMIT 1`,
          [input.followerUserId, input.targetUserId],
        )
        return result.rows[0] ?? null
      } catch {
        // Never expose provider diagnostics, SQL text or connection details.
        throw new FollowStoreError()
      }
    },
  }
}
