export type LikeStatusReadInput = Readonly<{
  actorUserId: string
  targetType: 'content' | 'comment'
  targetId: string
  /** Skip the aggregate subquery when the shared count cache is already warm. */
  includeCount: boolean
}>

export type LikeStatusReadResult = Readonly<{
  liked: boolean
  /** Null only when includeCount is false. */
  likeCount: number | null
}>

export interface LikeStatusReadStore {
  read(input: LikeStatusReadInput): Promise<LikeStatusReadResult>
}

export class LikeStatusReadStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('LIKE_STATUS_READ_UNAVAILABLE')
    this.name = 'LikeStatusReadStoreError'
  }
}
