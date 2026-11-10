import {
  RepostStoreError,
  type RepostStorageRow,
  type RepostStore,
} from './repost-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/** Structural node-postgres subset; no driver is bundled into W05 Worker code. */
export interface RepostPostgresQueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

const RETURNING = `repost_id, content_id, actor_user_id,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at`

export function createPostgresRepostStore(db: RepostPostgresQueryExecutor): RepostStore {
  return {
    async isBlocked(actorUserId, ownerUserId) {
      if (!ownerUserId || actorUserId === ownerUserId) return false
      try {
        const result = await db.query<{ blocked: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM social_user_interactions block
              WHERE block.relation_type = 'block'
                AND (
                  (block.actor_user_id = $1 AND block.target_user_id = $2)
                  OR (block.actor_user_id = $2 AND block.target_user_id = $1)
                )
           ) AS blocked`,
          [actorUserId, ownerUserId],
        )
        return result.rows[0]?.blocked === true
      } catch {
        throw new RepostStoreError()
      }
    },

    async find(actorUserId, contentId) {
      try {
        const result = await db.query<RepostStorageRow>(
          `SELECT ${RETURNING} FROM social_reposts
            WHERE actor_user_id = $1 AND content_id = $2 LIMIT 1`,
          [actorUserId, contentId],
        )
        return result.rows[0] ?? null
      } catch {
        throw new RepostStoreError()
      }
    },

    async insertIfAbsent(repostId, contentId, actorUserId, createdAt) {
      try {
        await db.query(
          `INSERT INTO social_reposts (repost_id, content_id, actor_user_id, created_at)
           VALUES ($1, $2, $3, $4::timestamptz)
           ON CONFLICT (actor_user_id, content_id) DO NOTHING`,
          [repostId, contentId, actorUserId, createdAt],
        )
      } catch {
        throw new RepostStoreError()
      }
    },

    async remove(actorUserId, contentId) {
      try {
        await db.query(
          'DELETE FROM social_reposts WHERE actor_user_id = $1 AND content_id = $2',
          [actorUserId, contentId],
        )
      } catch {
        throw new RepostStoreError()
      }
    },
  }
}
