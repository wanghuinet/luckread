import {
  FollowStoreError,
  type FollowRow,
  type FollowStore,
} from './follow-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/** Structural subset of node-postgres Pool/Client; no Node driver enters W05 Worker bundles. */
export interface FollowPostgresQueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

/**
 * PostgreSQL counterpart for the W05 Follow/Unfollow write boundary.
 *
 * Follow is one atomic INSERT .. SELECT guarded by both directions of the
 * block relationship. The unique (follower_user_id, target_user_id) conflict
 * returns the existing immutable relationship without changing its ID/time.
 */
export function createPostgresFollowStore(db: FollowPostgresQueryExecutor): FollowStore {
  return {
    async follow(input) {
      try {
        const result = await db.query<FollowRow>(
          `INSERT INTO social_follow_relationships
             (relationship_id, follower_user_id, target_user_id, created_at)
           SELECT $1, $2, $3, $4
            WHERE NOT EXISTS (
              SELECT 1
                FROM social_user_interactions block
               WHERE block.relation_type = 'block'
                 AND (
                   (block.actor_user_id = $2 AND block.target_user_id = $3)
                   OR
                   (block.actor_user_id = $3 AND block.target_user_id = $2)
                 )
            )
           ON CONFLICT (follower_user_id, target_user_id)
           DO UPDATE SET relationship_id = social_follow_relationships.relationship_id
           RETURNING
             relationship_id,
             follower_user_id,
             target_user_id,
             to_char(
               created_at AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
             ) AS created_at`,
          [
            input.relationshipId,
            input.followerUserId,
            input.targetUserId,
            input.createdAt,
          ],
        )
        return result.rows[0] ?? null
      } catch {
        // Never leak driver messages, query text or connection metadata.
        throw new FollowStoreError()
      }
    },

    async unfollow(followerUserId, targetUserId) {
      try {
        await db.query(
          `DELETE FROM social_follow_relationships
            WHERE follower_user_id = $1 AND target_user_id = $2`,
          [followerUserId, targetUserId],
        )
      } catch {
        throw new FollowStoreError()
      }
    },
  }
}
