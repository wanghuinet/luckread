export type ProfilePinStorageRow = Readonly<{
  user_id: string
  content_id: string
  pinned_at: string
}>

export interface ProfilePinStore {
  pin(userId: string, contentId: string, pinnedAt: string): Promise<ProfilePinStorageRow | null>
  get(userId: string): Promise<ProfilePinStorageRow | null>
  unpin(userId: string, contentId: string): Promise<void>
}

export class ProfilePinStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('PROFILE_PIN_STORE_UNAVAILABLE')
    this.name = 'ProfilePinStoreError'
  }
}

export interface ProfilePinD1QueryExecutor {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>
      run(): Promise<unknown>
    }
  }
}

/** D1 remains the production default until the separately authorized cutover. */
export function createD1ProfilePinStore(db: ProfilePinD1QueryExecutor): ProfilePinStore {
  return {
    async pin(userId, contentId, pinnedAt) {
      try {
        await db.prepare(
          `INSERT INTO social_profile_pins (user_id, content_id, pinned_at)
           VALUES (?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             content_id = excluded.content_id,
             pinned_at = CASE
               WHEN social_profile_pins.content_id = excluded.content_id THEN social_profile_pins.pinned_at
               ELSE excluded.pinned_at
             END`,
        ).bind(userId, contentId, pinnedAt).run()
        return await db.prepare(
          'SELECT user_id, content_id, pinned_at FROM social_profile_pins WHERE user_id = ? LIMIT 1',
        ).bind(userId).first<ProfilePinStorageRow>()
      } catch {
        throw new ProfilePinStoreError()
      }
    },

    async get(userId) {
      try {
        return await db.prepare(
          'SELECT user_id, content_id, pinned_at FROM social_profile_pins WHERE user_id = ? LIMIT 1',
        ).bind(userId).first<ProfilePinStorageRow>()
      } catch {
        throw new ProfilePinStoreError()
      }
    },

    async unpin(userId, contentId) {
      try {
        await db.prepare(
          'DELETE FROM social_profile_pins WHERE user_id = ? AND content_id = ?',
        ).bind(userId, contentId).run()
      } catch {
        throw new ProfilePinStoreError()
      }
    },
  }
}
