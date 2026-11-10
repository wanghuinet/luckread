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

export interface BlockMuteRelationD1QueryExecutor {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>
      run(): Promise<unknown>
    }
  }
}

/** The current production adapter. Cloudflare D1 remains the default authority. */
export function createD1BlockMuteRelationStore(
  db: BlockMuteRelationD1QueryExecutor,
): BlockMuteRelationStore {
  return {
    async get(input) {
      const row = await db.prepare(
        'SELECT relationship_id, actor_user_id, target_user_id, relation_type, created_at, updated_at FROM social_user_interactions WHERE actor_user_id = ? AND target_user_id = ? AND relation_type = ? LIMIT 1',
      ).bind(input.actorUserId, input.targetUserId, input.relationType).first<BlockMuteRelationRow>()
      return row ?? null
    },

    async set(input) {
      const row = await db.prepare(
        'INSERT INTO social_user_interactions (relationship_id, actor_user_id, target_user_id, relation_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(actor_user_id, target_user_id, relation_type) DO UPDATE SET updated_at = social_user_interactions.updated_at RETURNING relationship_id, actor_user_id, target_user_id, relation_type, created_at, updated_at',
      ).bind(
        input.relationshipId,
        input.actorUserId,
        input.targetUserId,
        input.relationType,
        input.createdAt,
        input.updatedAt,
      ).first<BlockMuteRelationRow>()
      return row ?? null
    },

    async remove(input) {
      await db.prepare(
        'DELETE FROM social_user_interactions WHERE actor_user_id = ? AND target_user_id = ? AND relation_type = ?',
      ).bind(input.actorUserId, input.targetUserId, input.relationType).run()
    },
  }
}
