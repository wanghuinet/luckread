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
  /** Exact database ordering value for cursor pagination; omitted by D1. */
  cursor_created_at?: string
}>

export interface BlockMuteListReadStore {
  list(input: BlockMuteListReadInput): Promise<readonly BlockMuteListReadRow[]>
}

export interface BlockMuteListD1QueryExecutor {
  prepare(query: string): {
    bind(...values: unknown[]): {
      all<T>(): Promise<{ results?: T[] | null }>
    }
  }
}

export class BlockMuteListReadStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('BLOCK_MUTE_LIST_READ_UNAVAILABLE')
    this.name = 'BlockMuteListReadStoreError'
  }
}

/** D1 remains the production adapter and preserves the existing list query. */
export function createD1BlockMuteListReadStore(
  db: BlockMuteListD1QueryExecutor,
): BlockMuteListReadStore {
  return {
    async list(input) {
      const where = input.cursor
        ? `WHERE actor_user_id = ? AND relation_type = ?
           AND (created_at < ? OR (created_at = ? AND relationship_id < ?))`
        : 'WHERE actor_user_id = ? AND relation_type = ?'
      const statement = `SELECT relationship_id, target_user_id, created_at
        FROM social_user_interactions
        ${where}
        ORDER BY created_at DESC, relationship_id DESC
        LIMIT ?`
      const parameters = input.cursor
        ? [
            input.actorUserId,
            input.relationType,
            input.cursor.createdAt,
            input.cursor.createdAt,
            input.cursor.relationshipId,
            input.limit + 1,
          ]
        : [input.actorUserId, input.relationType, input.limit + 1]
      const result = await db.prepare(statement).bind(...parameters).all<BlockMuteListReadRow>()
      return result.results ?? []
    },
  }
}
