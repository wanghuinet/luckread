export type FavoriteListReadRow = Readonly<{
  relationship_id: string
  target_id: string
  created_at: string
  /** Exact PostgreSQL ordering value for the opaque keyset cursor. */
  cursor_created_at?: string
}>

export type FavoriteListReadInput = Readonly<{
  actorUserId: string
  cursor: Readonly<{ createdAt: string; relationshipId: string }> | null
  /** Includes one extra row so the runtime can determine hasMore. */
  limit: number
}>

export interface FavoriteListReadStore {
  list(input: FavoriteListReadInput): Promise<readonly FavoriteListReadRow[]>
}

export class FavoriteListReadStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('FAVORITE_LIST_READ_UNAVAILABLE')
    this.name = 'FavoriteListReadStoreError'
  }
}

