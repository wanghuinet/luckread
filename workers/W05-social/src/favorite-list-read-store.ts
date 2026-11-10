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

export interface FavoriteListD1QueryExecutor {
  prepare(query: string): {
    bind(...values: unknown[]): {
      all<T>(): Promise<{ results?: T[] | null }>
    }
  }
}

/** D1 remains the default production adapter until a separate cutover. */
export function createD1FavoriteListReadStore(
  db: FavoriteListD1QueryExecutor,
): FavoriteListReadStore {
  return {
    async list(input) {
      const cursorSql = input.cursor
        ? ' AND (created_at < ? OR (created_at = ? AND relationship_id < ?))'
        : ''
      const values: unknown[] = [input.actorUserId]
      if (input.cursor) {
        values.push(
          input.cursor.createdAt,
          input.cursor.createdAt,
          input.cursor.relationshipId,
        )
      }
      values.push(input.limit)

      try {
        const result = await db.prepare(`
          SELECT relationship_id, target_id, created_at
            FROM interaction_favorites
           WHERE actor_user_id = ?
             AND target_type = 'content'
             ${cursorSql}
           ORDER BY created_at DESC, relationship_id DESC
           LIMIT ?
        `).bind(...values).all<FavoriteListReadRow>()
        return result.results ?? []
      } catch {
        throw new FavoriteListReadStoreError()
      }
    },
  }
}
