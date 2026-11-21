import {
  BlockMuteRelationStoreError,
  type BlockMuteRelationLookup,
  type BlockMuteRelationRow,
  type BlockMuteRelationStore,
  type BlockMuteRelationUpsert,
} from './block-mute-relation-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/** Structural node-postgres subset; no Node driver is bundled into W05 Worker code. */
export interface BlockMuteRelationPostgresQueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

/** PostgreSQL counterpart for W05 Block/Mute point reads and mutations. */
export function createPostgresBlockMuteRelationStore(
  db: BlockMuteRelationPostgresQueryExecutor,
): BlockMuteRelationStore {
  return {
    async get(input: BlockMuteRelationLookup) {
      try {
        const result = await db.query<BlockMuteRelationRow>(
          `SELECT
             relationship_id,
             actor_user_id,
             target_user_id,
             relation_type,
             to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
             to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at
           FROM social_user_interactions
           WHERE actor_user_id = $1
             AND target_user_id = $2
             AND relation_type = $3
           LIMIT 1`,
          [input.actorUserId, input.targetUserId, input.relationType],
        )
        return result.rows[0] ?? null
      } catch {
        // Never leak driver messages, query text or connection metadata.
        throw new BlockMuteRelationStoreError()
      }
    },

    async set(input: BlockMuteRelationUpsert) {
      try {
        const result = await db.query<BlockMuteRelationRow>(
          `INSERT INTO social_user_interactions
             (relationship_id, actor_user_id, target_user_id, relation_type, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz)
           ON CONFLICT (actor_user_id, target_user_id, relation_type)
           DO UPDATE SET updated_at = social_user_interactions.updated_at
           RETURNING
             relationship_id,
             actor_user_id,
             target_user_id,
             relation_type,
             to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
             to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at`,
          [
            input.relationshipId,
            input.actorUserId,
            input.targetUserId,
            input.relationType,
            input.createdAt,
            input.updatedAt,
          ],
        )
        return result.rows[0] ?? null
      } catch {
        throw new BlockMuteRelationStoreError()
      }
    },

    async remove(input: BlockMuteRelationLookup) {
      try {
        await db.query(
          `DELETE FROM social_user_interactions
            WHERE actor_user_id = $1
              AND target_user_id = $2
              AND relation_type = $3`,
          [input.actorUserId, input.targetUserId, input.relationType],
        )
      } catch {
        throw new BlockMuteRelationStoreError()
      }
    },
  }
}
