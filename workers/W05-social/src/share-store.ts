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

