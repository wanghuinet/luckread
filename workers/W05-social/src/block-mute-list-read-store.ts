export type BlockMuteListDirection = 'block' | 'mute'

export type BlockMuteListCursor = Readonly<{
  createdAt: string
  relationshipId: string
}>

export type BlockMuteListReadInput = Readonly<{
  actorUserId: string
  relationType: BlockMuteListDirection
  cursor: BlockMuteListCursor | null
  limit: number
}>

export type BlockMuteListReadRow = Readonly<{
  relationship_id: string
  target_user_id: string
  created_at: string
  /** Exact database ordering value carried by the opaque keyset cursor. */
  cursor_created_at?: string
}>

export interface BlockMuteListReadStore {
  list(input: BlockMuteListReadInput): Promise<readonly BlockMuteListReadRow[]>
}

export class BlockMuteListReadStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('BLOCK_MUTE_LIST_READ_UNAVAILABLE')
    this.name = 'BlockMuteListReadStoreError'
  }
}
