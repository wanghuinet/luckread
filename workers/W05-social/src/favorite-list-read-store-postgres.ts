import {
  FavoriteListReadStoreError,
  type FavoriteListReadInput,
  type FavoriteListReadRow,
  type FavoriteListReadStore,
} from './favorite-list-read-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/** Structural node-postgres subset; no driver is bundled into W05 Worker code. */
export interface FavoriteListPostgresQueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

/** PostgreSQL adapter for the actor-scoped, bounded W05 favorites page. */
export function createPostgresFavoriteListReadStore(
  db: FavoriteListPostgresQueryExecutor,
): FavoriteListReadStore {
  return {
    async list(input: FavoriteListReadInput) {
      const values: unknown[] = [input.actorUserId]
      let cursorSql = ''
      if (input.cursor) {
        const timestampParameter = values.length + 1
        const relationshipParameter = timestampParameter + 1
        cursorSql =
          ' AND (created_at < $' + timestampParameter + '::timestamptz' +
          ' OR (created_at = $' + timestampParameter + '::timestamptz' +
          ' AND relationship_id < $' + relationshipParameter + '))'
        values.push(input.cursor.createdAt, input.cursor.relationshipId)
      }
      values.push(input.limit)

      const sql = [
        'SELECT',
        '  relationship_id,',
        '  target_id,',
        '  to_char(created_at AT TIME ZONE \'UTC\',',
        '    \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS created_at,',
        '  to_char(created_at AT TIME ZONE \'UTC\',',
        '    \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS cursor_created_at',
        'FROM interaction_favorites',
        "WHERE actor_user_id = $1 AND target_type = 'content'",
        cursorSql,
        'ORDER BY created_at DESC, relationship_id DESC',
        'LIMIT $' + values.length,
      ].filter(Boolean).join('\n')

      try {
        const result = await db.query<FavoriteListReadRow>(sql, values)
        return result.rows
      } catch {
        // Never expose provider messages, SQL text or connection metadata.
        throw new FavoriteListReadStoreError()
      }
    },
  }
}
