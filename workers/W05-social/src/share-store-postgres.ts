import {
  ShareStoreError,
  type ShareStorageRow,
  type ShareStore,
} from './share-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/** Structural node-postgres subset; no Node driver is bundled into W05 Worker code. */
export interface SharePostgresQueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

const RETURNING = `share_id, content_id, actor_user_id,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at`

export function createPostgresShareStore(db: SharePostgresQueryExecutor): ShareStore {
  return {
    async findByActorAndKey(actorUserId, idempotencyKey) {
      try {
        const result = await db.query<ShareStorageRow>(
          `SELECT ${RETURNING} FROM social_share_links
            WHERE actor_user_id = $1 AND idempotency_key = $2 LIMIT 1`,
          [actorUserId, idempotencyKey],
        )
        return result.rows[0] ?? null
      } catch {
        throw new ShareStoreError()
      }
    },

    async insertIfAbsent(shareId, contentId, actorUserId, idempotencyKey, createdAt) {
      try {
        await db.query(
          `INSERT INTO social_share_links (share_id, content_id, actor_user_id, idempotency_key, created_at)
           VALUES ($1, $2, $3, $4, $5::timestamptz)
           ON CONFLICT (actor_user_id, idempotency_key) DO NOTHING`,
          [shareId, contentId, actorUserId, idempotencyKey, createdAt],
        )
      } catch {
        throw new ShareStoreError()
      }
    },

    async findById(shareId) {
      try {
        const result = await db.query<Pick<ShareStorageRow, 'share_id' | 'content_id' | 'created_at'>>(
          `SELECT share_id, content_id,
             to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
             FROM social_share_links WHERE share_id = $1 LIMIT 1`,
          [shareId],
        )
        return result.rows[0] ?? null
      } catch {
        throw new ShareStoreError()
      }
    },
  }
}
