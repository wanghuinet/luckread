export type FavoriteStatusReadInput = Readonly<{
  actorUserId: string
  targetId: string
}>

export interface FavoriteStatusReadStore {
  isFavorited(input: FavoriteStatusReadInput): Promise<boolean>
}

export class FavoriteStatusReadStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('FAVORITE_STATUS_READ_UNAVAILABLE')
    this.name = 'FavoriteStatusReadStoreError'
  }
}

