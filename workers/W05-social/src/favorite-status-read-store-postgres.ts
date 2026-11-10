import {
  FavoriteStatusReadStoreError,
  type FavoriteStatusReadInput,
  type FavoriteStatusReadStore,
} from './favorite-status-read-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/** Structural node-postgres subset; no driver is bundled into W05 Worker code. */
export interface FavoriteStatusPostgresQueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

/** PostgreSQL point-read adapter for an actor's content favorite state. */
export function createPostgresFavoriteStatusReadStore(
  db: FavoriteStatusPostgresQueryExecutor,
): FavoriteStatusReadStore {
  return {
    async isFavorited(input: FavoriteStatusReadInput) {
      try {
        const result = await db.query<{ favorited: boolean }>(
          `SELECT EXISTS (
             SELECT 1
               FROM interaction_favorites
              WHERE actor_user_id = $1
                AND target_type = 'content'
                AND target_id = $2
           ) AS favorited`,
          [input.actorUserId, input.targetId],
        )
        return Boolean(result.rows[0]?.favorited)
      } catch {
        // Never expose provider messages, SQL text or connection metadata.
        throw new FavoriteStatusReadStoreError()
      }
    },
  }
}
