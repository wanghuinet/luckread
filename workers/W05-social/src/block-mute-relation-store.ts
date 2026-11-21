import type { BlockMuteType } from './block-mute-runtime.js'

export type BlockMuteRelationRow = Readonly<{
  relationship_id: string
  actor_user_id: string
  target_user_id: string
  relation_type: BlockMuteType
  created_at: string
  updated_at: string
}>

export type BlockMuteRelationLookup = Readonly<{
  actorUserId: string
  targetUserId: string
  relationType: BlockMuteType
}>

export type BlockMuteRelationUpsert = BlockMuteRelationLookup & Readonly<{
  relationshipId: string
  createdAt: string
  updatedAt: string
}>

export interface BlockMuteRelationStore {
  get(input: BlockMuteRelationLookup): Promise<BlockMuteRelationRow | null>
  set(input: BlockMuteRelationUpsert): Promise<BlockMuteRelationRow | null>
  remove(input: BlockMuteRelationLookup): Promise<void>
}

export class BlockMuteRelationStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('BLOCK_MUTE_RELATION_STORE_UNAVAILABLE')
    this.name = 'BlockMuteRelationStoreError'
  }
}
