export type RepostStorageRow = Readonly<{
  repost_id: string
  content_id: string
  actor_user_id: string
  created_at: string
}>

export interface RepostStore {
  isBlocked(actorUserId: string, ownerUserId: string | null): Promise<boolean>
  find(actorUserId: string, contentId: string): Promise<RepostStorageRow | null>
  insertIfAbsent(repostId: string, contentId: string, actorUserId: string, createdAt: string): Promise<void>
  remove(actorUserId: string, contentId: string): Promise<void>
}

export class RepostStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('REPOST_STORE_UNAVAILABLE')
    this.name = 'RepostStoreError'
  }
}

export interface RepostD1QueryExecutor {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>
      run(): Promise<unknown>
    }
  }
}

/** D1 remains the production default until the separately authorized cutover. */
export function createD1RepostStore(db: RepostD1QueryExecutor): RepostStore {
  return {
    async isBlocked(actorUserId, ownerUserId) {
      if (!ownerUserId || actorUserId === ownerUserId) return false
      try {
        const row = await db.prepare(
          `SELECT EXISTS (
             SELECT 1 FROM social_user_interactions block
              WHERE block.relation_type = 'block'
                AND (
                  (block.actor_user_id = ? AND block.target_user_id = ?)
                  OR (block.actor_user_id = ? AND block.target_user_id = ?)
                )
           ) AS blocked`,
        ).bind(actorUserId, ownerUserId, ownerUserId, actorUserId).first<{ blocked: number }>()
        return Number(row?.blocked ?? 0) === 1
      } catch {
        throw new RepostStoreError()
      }
    },

    async find(actorUserId, contentId) {
      try {
        return await db.prepare(
          'SELECT repost_id, content_id, actor_user_id, created_at FROM social_reposts WHERE actor_user_id = ? AND content_id = ? LIMIT 1',
        ).bind(actorUserId, contentId).first<RepostStorageRow>()
      } catch {
        throw new RepostStoreError()
      }
    },

    async insertIfAbsent(repostId, contentId, actorUserId, createdAt) {
      try {
        await db.prepare(
          'INSERT OR IGNORE INTO social_reposts (repost_id, content_id, actor_user_id, created_at) VALUES (?, ?, ?, ?)',
        ).bind(repostId, contentId, actorUserId, createdAt).run()
      } catch {
        throw new RepostStoreError()
      }
    },

    async remove(actorUserId, contentId) {
      try {
        await db.prepare(
          'DELETE FROM social_reposts WHERE actor_user_id = ? AND content_id = ?',
        ).bind(actorUserId, contentId).run()
      } catch {
        throw new RepostStoreError()
      }
    },
  }
}
