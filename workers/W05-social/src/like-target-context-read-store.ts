export type LikeCommentTargetReadRow = Readonly<{
  id: string
  state: string
  author_user_id: string | null
  content_id: string
}>

export interface LikeTargetContextReadStore {
  readCommentTarget(commentId: string): Promise<LikeCommentTargetReadRow | null>
  hasBidirectionalBlock(actorUserId: string, relatedUserIds: readonly string[]): Promise<boolean>
}

export interface LikeTargetContextD1QueryExecutor {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>
    }
  }
}

export class LikeTargetContextReadStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('LIKE_TARGET_CONTEXT_READ_UNAVAILABLE')
    this.name = 'LikeTargetContextReadStoreError'
  }
}

function normalizedTargets(actorUserId: string, relatedUserIds: readonly string[]): string[] {
  return [...new Set(relatedUserIds.filter((userId) => userId && userId !== actorUserId))]
}

/** D1 remains the default production adapter until a separately authorized cutover. */
export function createD1LikeTargetContextReadStore(
  db: LikeTargetContextD1QueryExecutor,
): LikeTargetContextReadStore {
  return {
    async readCommentTarget(commentId) {
      try {
        return await db.prepare(
          'SELECT id, state, author_user_id, content_id FROM social_comments WHERE id = ? LIMIT 1',
        ).bind(commentId).first<LikeCommentTargetReadRow>()
      } catch {
        throw new LikeTargetContextReadStoreError()
      }
    },

    async hasBidirectionalBlock(actorUserId, relatedUserIds) {
      const targets = normalizedTargets(actorUserId, relatedUserIds)
      if (targets.length === 0) return false
      const placeholders = targets.map(() => '?').join(', ')
      try {
        const row = await db.prepare(
          `SELECT EXISTS (
             SELECT 1
             FROM social_user_interactions block
             WHERE block.relation_type = 'block'
               AND (
                 (block.actor_user_id = ? AND block.target_user_id IN (${placeholders}))
                 OR
                 (block.target_user_id = ? AND block.actor_user_id IN (${placeholders}))
               )
           ) AS blocked`,
        ).bind(actorUserId, ...targets, actorUserId, ...targets)
          .first<{ blocked: number | boolean }>()
        return row?.blocked === true || Number(row?.blocked ?? 0) === 1
      } catch {
        throw new LikeTargetContextReadStoreError()
      }
    },
  }
}
