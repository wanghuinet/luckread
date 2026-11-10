export type NotificationPreferenceValues = Readonly<{
  follow: boolean
  like: boolean
  comment: boolean
  mention: boolean
}>

export type NotificationPreferencePatch = Partial<NotificationPreferenceValues>

export interface NotificationPreferencesStore {
  get(userId: string): Promise<NotificationPreferenceValues>
  set(userId: string, input: NotificationPreferencePatch): Promise<NotificationPreferenceValues>
}

export class NotificationPreferencesStoreError extends Error {
  readonly code = 'INTERNAL_ERROR'
  readonly status = 500

  constructor() {
    super('NOTIFICATION_PREFERENCES_STORE_UNAVAILABLE')
    this.name = 'NotificationPreferencesStoreError'
  }
}

type NotificationPreferenceRow = Readonly<{
  follow_enabled: number | string | boolean
  like_enabled: number | string | boolean
  comment_enabled: number | string | boolean
  mention_enabled: number | string | boolean
}>

export interface NotificationPreferencesD1QueryExecutor {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>
    }
  }
}

const DEFAULT_PREFERENCES: NotificationPreferenceValues = Object.freeze({
  follow: true,
  like: true,
  comment: true,
  mention: true,
})

const toPreferences = (row: NotificationPreferenceRow | null | undefined): NotificationPreferenceValues => ({
  follow: Number(row?.follow_enabled ?? 1) === 1,
  like: Number(row?.like_enabled ?? 1) === 1,
  comment: Number(row?.comment_enabled ?? 1) === 1,
  mention: Number(row?.mention_enabled ?? 1) === 1,
})

const toSqlValue = (value: boolean | undefined): number | null =>
  value === undefined ? null : value ? 1 : 0

/** D1 remains the default production adapter until an explicit database cutover. */
export function createD1NotificationPreferencesStore(
  db: NotificationPreferencesD1QueryExecutor,
): NotificationPreferencesStore {
  return {
    async get(userId: string) {
      try {
        const row = await db.prepare(
          'SELECT follow_enabled, like_enabled, comment_enabled, mention_enabled FROM social_notification_preferences WHERE user_id = ? LIMIT 1',
        ).bind(userId).first<NotificationPreferenceRow>()
        return row ? toPreferences(row) : { ...DEFAULT_PREFERENCES }
      } catch {
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
        const row = await db.prepare(
          `INSERT INTO social_notification_preferences
            (user_id, follow_enabled, like_enabled, comment_enabled, mention_enabled, updated_at)
           VALUES (?, COALESCE(?, 1), COALESCE(?, 1), COALESCE(?, 1), COALESCE(?, 1), CURRENT_TIMESTAMP)
           ON CONFLICT(user_id) DO UPDATE SET
             follow_enabled = COALESCE(?, social_notification_preferences.follow_enabled),
             like_enabled = COALESCE(?, social_notification_preferences.like_enabled),
             comment_enabled = COALESCE(?, social_notification_preferences.comment_enabled),
             mention_enabled = COALESCE(?, social_notification_preferences.mention_enabled),
             updated_at = CURRENT_TIMESTAMP
           RETURNING follow_enabled, like_enabled, comment_enabled, mention_enabled`,
        ).bind(
          userId,
          values.follow, values.like, values.comment, values.mention,
          values.follow, values.like, values.comment, values.mention,
        ).first<NotificationPreferenceRow>()
        if (!row) throw new NotificationPreferencesStoreError()
        return toPreferences(row)
      } catch {
        throw new NotificationPreferencesStoreError()
      }
    },
  }
}
