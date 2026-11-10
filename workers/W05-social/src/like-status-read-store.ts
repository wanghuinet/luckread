export type LikeStatusReadInput = Readonly<{
  actorUserId: string
  targetType: 'content' | 'comment'
  targetId: string
  /** Skip the aggregate subquery when the shared count cache is already warm. */
  includeCount: boolean
}>

export type LikeStatusReadResult = Readonly<{
  liked: boolean
  /** Null only when includeCount is false. */
  likeCount: number | null
}>

export interface LikeStatusReadStore {
  read(input: LikeStatusReadInput): Promise<LikeStatusReadResult>
}

export class LikeStatusReadStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('LIKE_STATUS_READ_UNAVAILABLE')
    this.name = 'LikeStatusReadStoreError'
  }
}

export interface LikeStatusD1QueryExecutor {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>
    }
  }
}

const toSafeCount = (value: unknown): number => {
  const count = Number(value ?? 0)
  if (!Number.isSafeInteger(count) || count < 0) throw new LikeStatusReadStoreError()
  return count
}

/** D1 remains the default production adapter until an explicit cutover. */
export function createD1LikeStatusReadStore(
  db: LikeStatusD1QueryExecutor,
): LikeStatusReadStore {
  return {
    async read(input: LikeStatusReadInput) {
      const countSelect = input.includeCount
        ? `, (SELECT COUNT(*)
             FROM interaction_likes il_count
            WHERE il_count.target_type = ?
              AND il_count.target_id = ?) AS like_count`
        : ''
      try {
        const row = await db.prepare(
          `SELECT EXISTS (
             SELECT 1
               FROM interaction_likes il
              WHERE il.actor_user_id = ?
                AND il.target_type = ?
                AND il.target_id = ?
           ) AS liked${countSelect}`,
        ).bind(
          input.actorUserId,
          input.targetType,
          input.targetId,
          ...(input.includeCount ? [input.targetType, input.targetId] : []),
        ).first<{ liked: number; like_count?: number }>()
        return {
          liked: Number(row?.liked ?? 0) === 1,
          likeCount: input.includeCount ? toSafeCount(row?.like_count) : null,
        }
      } catch {
        throw new LikeStatusReadStoreError()
      }
    },
  }
}
