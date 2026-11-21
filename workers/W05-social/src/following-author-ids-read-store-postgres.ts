import {
  FollowingAuthorIdsReadStoreError,
  type FollowingAuthorIdRow,
  type FollowingAuthorIdsReadStore,
} from './following-author-ids-read-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/** Structural node-postgres subset; no Node driver is bundled into W05 Worker code. */
export interface FollowingAuthorIdsPostgresQueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

/**
 * PostgreSQL counterpart for W05's bounded Following-feed author candidate
 * query. Block is excluded in both directions; Mute is intentionally
 * directional from the viewer to each followed author.
 */
export function createPostgresFollowingAuthorIdsReadStore(
  db: FollowingAuthorIdsPostgresQueryExecutor,
): FollowingAuthorIdsReadStore {
  return {
    async list(viewerUserId, limit) {
      try {
        const result = await db.query<FollowingAuthorIdRow>(
          `SELECT f.target_user_id AS user_id
             FROM social_follow_relationships f
            WHERE f.follower_user_id = $1
              AND NOT EXISTS (
                SELECT 1
                  FROM social_user_interactions b
                 WHERE b.relation_type = 'block'
                   AND (
                     (b.actor_user_id = $1 AND b.target_user_id = f.target_user_id)
                     OR
                     (b.actor_user_id = f.target_user_id AND b.target_user_id = $1)
                   )
              )
              AND NOT EXISTS (
                SELECT 1
                  FROM social_user_interactions m
                 WHERE m.relation_type = 'mute'
                   AND m.actor_user_id = $1
                   AND m.target_user_id = f.target_user_id
              )
            ORDER BY f.created_at DESC, f.target_user_id DESC
            LIMIT $2`,
          [viewerUserId, limit],
        )
        return result.rows
      } catch {
        // Never expose driver messages, SQL text or connection metadata.
        throw new FollowingAuthorIdsReadStoreError()
      }
    },
  }
}
