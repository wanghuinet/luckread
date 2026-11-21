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

