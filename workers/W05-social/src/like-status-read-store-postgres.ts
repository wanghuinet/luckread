import {
  LikeStatusReadStoreError,
  type LikeStatusReadInput,
  type LikeStatusReadStore,
} from './like-status-read-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/** Structural node-postgres subset; no Node driver is bundled into W05 Worker code. */
export interface LikeStatusPostgresQueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

const toSafeCount = (value: unknown): number => {
  const count = Number(value ?? 0)
  if (!Number.isSafeInteger(count) || count < 0) throw new LikeStatusReadStoreError()
  return count
}

/** PostgreSQL point/aggregate read for one actor and one content-or-comment target. */
export function createPostgresLikeStatusReadStore(
  db: LikeStatusPostgresQueryExecutor,
): LikeStatusReadStore {
  return {
    async read(input: LikeStatusReadInput) {
      const values: unknown[] = [input.actorUserId, input.targetType, input.targetId]
      const countSelect = input.includeCount
        ? `, (SELECT COUNT(*)
             FROM interaction_likes il_count
            WHERE il_count.target_type = $4
              AND il_count.target_id = $5) AS like_count`
        : ''
      if (input.includeCount) values.push(input.targetType, input.targetId)

      try {
        const result = await db.query<{ liked: boolean; like_count?: string | number }>(
          `SELECT EXISTS (
             SELECT 1
               FROM interaction_likes il
              WHERE il.actor_user_id = $1
                AND il.target_type = $2
                AND il.target_id = $3
           ) AS liked${countSelect}`,
          values,
        )
        const row = result.rows[0]
        return {
          liked: row?.liked === true,
          likeCount: input.includeCount ? toSafeCount(row?.like_count) : null,
        }
      } catch {
        // Never expose provider messages, SQL text or connection metadata.
        throw new LikeStatusReadStoreError()
      }
    },
  }
}
