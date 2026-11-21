import {
  ProfilePinStoreError,
  type ProfilePinStorageRow,
  type ProfilePinStore,
} from './profile-pin-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/** Structural node-postgres subset; no driver is bundled into W05 Worker code. */
export interface ProfilePinPostgresQueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

const RETURNING = `user_id, content_id,
  to_char(pinned_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS pinned_at`

export function createPostgresProfilePinStore(db: ProfilePinPostgresQueryExecutor): ProfilePinStore {
  return {
    async pin(userId, contentId, pinnedAt) {
      try {
        const result = await db.query<ProfilePinStorageRow>(
          `INSERT INTO social_profile_pins (user_id, content_id, pinned_at)
           VALUES ($1, $2, $3::timestamptz)
           ON CONFLICT (user_id) DO UPDATE SET
             content_id = EXCLUDED.content_id,
             pinned_at = CASE
               WHEN social_profile_pins.content_id = EXCLUDED.content_id THEN social_profile_pins.pinned_at
               ELSE EXCLUDED.pinned_at
             END
           RETURNING ${RETURNING}`,
          [userId, contentId, pinnedAt],
        )
        return result.rows[0] ?? null
      } catch {
        throw new ProfilePinStoreError()
      }
    },

    async get(userId) {
      try {
        const result = await db.query<ProfilePinStorageRow>(
          `SELECT ${RETURNING} FROM social_profile_pins WHERE user_id = $1 LIMIT 1`,
          [userId],
        )
        return result.rows[0] ?? null
      } catch {
        throw new ProfilePinStoreError()
      }
    },

    async unpin(userId, contentId) {
      try {
        await db.query(
          'DELETE FROM social_profile_pins WHERE user_id = $1 AND content_id = $2',
          [userId, contentId],
        )
      } catch {
        throw new ProfilePinStoreError()
      }
    },
  }
}
