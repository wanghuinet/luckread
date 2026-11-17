export type RelationshipGraphReadRow = Readonly<{
  following: boolean | number
  followed_by: boolean | number
  relationship_id: string | null
  created_at: string | null
  blocked: boolean | number
  blocked_by: boolean | number
  muted: boolean | number
}>

export interface RelationshipGraphReadStore {
  read(viewerUserId: string, targetUserId: string): Promise<RelationshipGraphReadRow | null>
}

export class RelationshipGraphStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('RELATIONSHIP_GRAPH_STORE_UNAVAILABLE')
    this.name = 'RelationshipGraphStoreError'
  }
}
