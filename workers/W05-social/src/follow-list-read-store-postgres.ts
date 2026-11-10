import {
  FollowStoreError,
} from './follow-store.js'
import type {
  FollowListCountInput,
  FollowListReadInput,
  FollowListReadRow,
  FollowListReadStore,
} from './follow-list-read-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

export interface FollowListPostgresQueryExecutor {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

/**
 * PostgreSQL 18 adapter for follower/following pages and their filtered counts.
 * Block filtering, ordering, timestamp cursors and row bounds mirror the D1
 * adapter. It deliberately does not own relationship-graph or Block/Mute APIs.
 */
export function createPostgresFollowListReadStore(
  db: FollowListPostgresQueryExecutor,
): FollowListReadStore {
  return {
    async list(input: FollowListReadInput) {
      const isFollowers = input.direction === 'followers'
      const relationColumn = isFollowers ? 'target_user_id' : 'follower_user_id'
      const itemColumn = isFollowers ? 'follower_user_id' : 'target_user_id'
      const cursorPredicate = input.cursor
        ? 'AND (rel.created_at < $2::timestamptz OR (rel.created_at = $2::timestamptz AND rel.relationship_id < $3))'
        : ''
      const limitParameter = input.cursor ? '$4' : '$2'
      const values = input.cursor
        ? [input.userId, input.cursor.createdAt, input.cursor.relationshipId, input.limit + 1]
        : [input.userId, input.limit + 1]

      try {
        const result = await db.query<FollowListReadRow>(
          `SELECT
             rel.relationship_id,
             rel.${itemColumn} AS user_id,
             to_char(
               rel.created_at AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
             ) AS followed_at,
             to_char(
               rel.created_at AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
             ) AS cursor_created_at
           FROM social_follow_relationships rel
           WHERE rel.${relationColumn} = $1
             ${cursorPredicate}
             AND NOT EXISTS (
               SELECT 1
                 FROM social_user_interactions block
                WHERE block.relation_type = 'block'
                  AND (
                    (block.actor_user_id = $1 AND block.target_user_id = rel.${itemColumn})
                    OR
                    (block.actor_user_id = rel.${itemColumn} AND block.target_user_id = $1)
                  )
             )
           ORDER BY rel.created_at DESC, rel.relationship_id DESC
           LIMIT ${limitParameter}`,
          values,
        )
        return result.rows
      } catch {
        throw new FollowStoreError()
      }
    },

    async count(input: FollowListCountInput) {
      const isFollowers = input.direction === 'followers'
      const relationColumn = isFollowers ? 'target_user_id' : 'follower_user_id'
      const itemColumn = isFollowers ? 'follower_user_id' : 'target_user_id'

      try {
        const result = await db.query<{ total_count: number }>(
          `SELECT COUNT(*)::int AS total_count
             FROM social_follow_relationships rel_count
            WHERE rel_count.${relationColumn} = $1
              AND NOT EXISTS (
                SELECT 1
                  FROM social_user_interactions block
                 WHERE block.relation_type = 'block'
                   AND (
                     (block.actor_user_id = $1 AND block.target_user_id = rel_count.${itemColumn})
                     OR
                     (block.actor_user_id = rel_count.${itemColumn} AND block.target_user_id = $1)
                   )
              )`,
          [input.userId],
        )
        return Number(result.rows[0]?.total_count ?? 0)
      } catch {
        throw new FollowStoreError()
      }
    },
  }
}
