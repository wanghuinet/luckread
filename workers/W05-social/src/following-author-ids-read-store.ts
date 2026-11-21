export type FollowingAuthorIdRow = Readonly<{
  user_id: string
}>

export interface FollowingAuthorIdsReadStore {
  /** Return at most the requested number of unblocked, unmuted followed author IDs. */
  list(viewerUserId: string, limit: number): Promise<readonly FollowingAuthorIdRow[]>
}

export class FollowingAuthorIdsReadStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('FOLLOWING_AUTHOR_IDS_READ_UNAVAILABLE')
    this.name = 'FollowingAuthorIdsReadStoreError'
  }
}
