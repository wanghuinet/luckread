export type ShareStorageRow = Readonly<{
  share_id: string
  content_id: string
  actor_user_id: string
  created_at: string
}>

export interface ShareStore {
  findByActorAndKey(actorUserId: string, idempotencyKey: string): Promise<ShareStorageRow | null>
  insertIfAbsent(shareId: string, contentId: string, actorUserId: string, idempotencyKey: string, createdAt: string): Promise<void>
  findById(shareId: string): Promise<Pick<ShareStorageRow, 'share_id' | 'content_id' | 'created_at'> | null>
}

export class ShareStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('SHARE_STORE_UNAVAILABLE')
    this.name = 'ShareStoreError'
  }
}

export interface ShareD1QueryExecutor {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>
      run(): Promise<unknown>
    }
  }
}

/** D1 remains the production default until the separately authorized cutover. */
export function createD1ShareStore(db: ShareD1QueryExecutor): ShareStore {
  return {
    async findByActorAndKey(actorUserId, idempotencyKey) {
      try {
        return await db.prepare(
          'SELECT share_id, content_id, actor_user_id, created_at FROM social_share_links WHERE actor_user_id = ? AND idempotency_key = ? LIMIT 1',
        ).bind(actorUserId, idempotencyKey).first<ShareStorageRow>()
      } catch {
        throw new ShareStoreError()
      }
    },

    async insertIfAbsent(shareId, contentId, actorUserId, idempotencyKey, createdAt) {
      try {
        await db.prepare(
          'INSERT OR IGNORE INTO social_share_links (share_id, content_id, actor_user_id, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?)',
        ).bind(shareId, contentId, actorUserId, idempotencyKey, createdAt).run()
      } catch {
        throw new ShareStoreError()
      }
    },

    async findById(shareId) {
      try {
        return await db.prepare(
          'SELECT share_id, content_id, created_at FROM social_share_links WHERE share_id = ? LIMIT 1',
        ).bind(shareId).first<Pick<ShareStorageRow, 'share_id' | 'content_id' | 'created_at'>>()
      } catch {
        throw new ShareStoreError()
      }
    },
  }
}
