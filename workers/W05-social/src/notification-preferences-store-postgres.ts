import {
  NotificationPreferencesStoreError,
  type NotificationPreferencePatch,
  type NotificationPreferenceValues,
  type NotificationPreferencesStore,
} from './notification-preferences-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/** Structural node-postgres subset; no Node driver is bundled into W05 Worker code. */
export interface NotificationPreferencesPostgresQueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

type NotificationPreferenceRow = Readonly<{
  follow_enabled: number | string | boolean
  like_enabled: number | string | boolean
  comment_enabled: number | string | boolean
  mention_enabled: number | string | boolean
}>

const DEFAULT_PREFERENCES: NotificationPreferenceValues = Object.freeze({
  follow: true,
  like: true,
  comment: true,
  mention: true,
})

const toPreferences = (row: NotificationPreferenceRow | undefined): NotificationPreferenceValues => ({
  follow: Number(row?.follow_enabled ?? 1) === 1,
  like: Number(row?.like_enabled ?? 1) === 1,
  comment: Number(row?.comment_enabled ?? 1) === 1,
  mention: Number(row?.mention_enabled ?? 1) === 1,
})

const toSqlValue = (value: boolean | undefined): number | null =>
  value === undefined ? null : value ? 1 : 0

/** PostgreSQL counterpart for W05-owned per-user notification preference reads and upserts. */
export function createPostgresNotificationPreferencesStore(
  db: NotificationPreferencesPostgresQueryExecutor,
): NotificationPreferencesStore {
  return {
    async get(userId: string) {
      try {
        const result = await db.query<NotificationPreferenceRow>(
          'SELECT follow_enabled, like_enabled, comment_enabled, mention_enabled FROM social_notification_preferences WHERE user_id = $1 LIMIT 1',
          [userId],
        )
        return result.rows[0] ? toPreferences(result.rows[0]) : { ...DEFAULT_PREFERENCES }
      } catch {
        // Never expose provider messages, SQL text or connection metadata.
        throw new NotificationPreferencesStoreError()
      }
    },

    async set(userId: string, input: NotificationPreferencePatch) {
      const values = {
        follow: toSqlValue(input.follow),
        like: toSqlValue(input.like),
        comment: toSqlValue(input.comment),
        mention: toSqlValue(input.mention),
      }
      try {
        const result = await db.query<NotificationPreferenceRow>(
          `INSERT INTO social_notification_preferences
            (user_id, follow_enabled, like_enabled, comment_enabled, mention_enabled, updated_at)
           VALUES ($1, COALESCE($2, 1), COALESCE($3, 1), COALESCE($4, 1), COALESCE($5, 1), CURRENT_TIMESTAMP)
           ON CONFLICT(user_id) DO UPDATE SET
             follow_enabled = COALESCE($6, social_notification_preferences.follow_enabled),
             like_enabled = COALESCE($7, social_notification_preferences.like_enabled),
             comment_enabled = COALESCE($8, social_notification_preferences.comment_enabled),
             mention_enabled = COALESCE($9, social_notification_preferences.mention_enabled),
             updated_at = CURRENT_TIMESTAMP
           RETURNING follow_enabled, like_enabled, comment_enabled, mention_enabled`,
          [
            userId,
            values.follow, values.like, values.comment, values.mention,
            values.follow, values.like, values.comment, values.mention,
          ],
        )
        const row = result.rows[0]
        if (!row) throw new NotificationPreferencesStoreError()
        return toPreferences(row)
      } catch {
        throw new NotificationPreferencesStoreError()
      }
    },
  }
}
