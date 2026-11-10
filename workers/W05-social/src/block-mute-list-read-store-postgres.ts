import {
  BlockMuteListReadStoreError,
  type BlockMuteListReadInput,
  type BlockMuteListReadRow,
  type BlockMuteListReadStore,
} from './block-mute-list-read-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/** Structural node-postgres subset; no Node driver is bundled into W05 Worker code. */
export interface BlockMuteListPostgresQueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

/**
 * PostgreSQL counterpart for the viewer-owned Block/Mute list. The public
 * timestamp remains millisecond-compatible while the opaque cursor carries
 * PostgreSQL's microsecond ordering value to avoid gaps between pages.
 */
export function createPostgresBlockMuteListReadStore(
  db: BlockMuteListPostgresQueryExecutor,
): BlockMuteListReadStore {
  return {
    async list(input: BlockMuteListReadInput) {
      const cursorPredicate = input.cursor
        ? 'AND (created_at < $3::timestamptz OR (created_at = $3::timestamptz AND relationship_id < $4))'
        : ''
      const limitParameter = input.cursor ? '$5' : '$3'
      const values = input.cursor
        ? [
            input.actorUserId,
            input.relationType,
            input.cursor.createdAt,
            input.cursor.relationshipId,
            input.limit + 1,
          ]
        : [input.actorUserId, input.relationType, input.limit + 1]

      try {
        const result = await db.query<BlockMuteListReadRow>(
          `SELECT
             relationship_id,
             target_user_id,
             to_char(
               created_at AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
             ) AS created_at,
             to_char(
               created_at AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
             ) AS cursor_created_at
           FROM social_user_interactions
           WHERE actor_user_id = $1
             AND relation_type = $2
             ${cursorPredicate}
           ORDER BY social_user_interactions.created_at DESC, social_user_interactions.relationship_id DESC
           LIMIT ${limitParameter}`,
          values,
        )
        return result.rows
      } catch {
        // Never leak driver messages, query text or connection metadata.
        throw new BlockMuteListReadStoreError()
      }
    },
  }
}
