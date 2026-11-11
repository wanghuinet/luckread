import {
  FavoriteMutationStoreError,
  type FavoriteMutationCreateInput,
  type FavoriteMutationRemoveInput,
  type FavoriteMutationRow,
  type FavoriteMutationStore,
} from './favorite-mutation-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/** Structural node-postgres subset; no Node driver is bundled into W05 Worker code. */
export interface FavoriteMutationPostgresExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

/** PostgreSQL counterpart for W05-owned favorite relation writes. */
export function createPostgresFavoriteMutationStore(
  db: FavoriteMutationPostgresExecutor,
): FavoriteMutationStore {
  const query = async <Row extends Record<string, unknown>>(
    sql: string,
    values: unknown[],
  ): Promise<Row[]> => {
    try {
      return (await db.query<Row>(sql, values)).rows
    } catch {
      // Keep database errors, connection metadata and SQL details out of API responses.
      throw new FavoriteMutationStoreError()
    }
  }

  return {
    async create(input: FavoriteMutationCreateInput) {
      const rows = await query<FavoriteMutationRow & Record<string, unknown>>(`
        INSERT INTO interaction_favorites
          (relationship_id, actor_user_id, target_type, target_id, created_at)
        VALUES ($1, $2, 'content', $3, $4::timestamptz)
        ON CONFLICT (actor_user_id, target_type, target_id)
        DO UPDATE SET relationship_id = interaction_favorites.relationship_id
        RETURNING
          relationship_id,
          actor_user_id,
          target_type,
          target_id,
          to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
      `, [
        input.relationshipId,
        input.actorUserId,
        input.targetId,
        input.createdAt,
      ])
      return rows[0] ?? null
    },

    async remove(input: FavoriteMutationRemoveInput) {
      await query(
        `DELETE FROM interaction_favorites
          WHERE actor_user_id = $1
            AND target_type = $2
            AND target_id = $3`,
        [input.actorUserId, input.targetType, input.targetId],
      )
    },
  }
}
