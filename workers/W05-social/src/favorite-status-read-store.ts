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

export interface FavoriteStatusD1QueryExecutor {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>
    }
  }
}

/** D1 remains the default production adapter until an explicit cutover. */
export function createD1FavoriteStatusReadStore(
  db: FavoriteStatusD1QueryExecutor,
): FavoriteStatusReadStore {
  return {
    async isFavorited(input) {
      try {
        const row = await db.prepare(
          `SELECT EXISTS (
             SELECT 1
               FROM interaction_favorites
              WHERE actor_user_id = ?
                AND target_type = 'content'
                AND target_id = ?
           ) AS favorited`,
        ).bind(input.actorUserId, input.targetId).first<{ favorited: number }>()
        return Boolean(row?.favorited)
      } catch {
        throw new FavoriteStatusReadStoreError()
      }
    },
  }
}
