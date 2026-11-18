export type ContentLikerReadRow = Readonly<{
  relationship_id: string
  actor_user_id: string
  created_at: string
}>

export type ContentLikerReadInput = Readonly<{
  contentId: string
  contentOwnerUserId: string | null
  viewerUserId: string | null
  cursor: Readonly<{ createdAt: string; relationshipId: string }> | null
  /** Includes the extra row used by the runtime to determine hasMore. */
  limit: number
}>

export interface ContentLikerReadStore {
  list(input: ContentLikerReadInput): Promise<readonly ContentLikerReadRow[]>
}

export class ContentLikerReadStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('CONTENT_LIKER_READ_UNAVAILABLE')
    this.name = 'ContentLikerReadStoreError'
  }
}

