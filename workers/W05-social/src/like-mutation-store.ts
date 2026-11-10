export type LikeMutationRow = Readonly<{
  relationship_id: string
  actor_user_id: string
  target_type: 'content' | 'comment'
  target_id: string
  created_at: string
}>

export type CreateLikeMutationInput = Readonly<{
  relationshipId: string
  actorUserId: string
  targetType: 'content' | 'comment'
  targetId: string
  createdAt: string
  /** W03-authoritative parent owner used for the final comment-like Block race check. */
  parentOwnerUserId?: string | null
}>

export type RemoveLikeMutationInput = Readonly<{
  actorUserId: string
  targetType: 'content' | 'comment'
  targetId: string
}>

export interface LikeMutationStore {
  create(input: CreateLikeMutationInput): Promise<LikeMutationRow | null>
  remove(input: RemoveLikeMutationInput): Promise<void>
}

export class LikeMutationStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('LIKE_MUTATION_STORE_UNAVAILABLE')
    this.name = 'LikeMutationStoreError'
  }
}

export interface LikeMutationD1QueryExecutor {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>
      run(): Promise<unknown>
    }
  }
}

const CONTENT_LIKE_SQL = `INSERT INTO interaction_likes
  (relationship_id, actor_user_id, target_type, target_id, created_at)
 SELECT ?, ?, 'content', c.id, ?
   FROM contents c
  WHERE c.id = ?
    AND c.state = 'PUBLISHED'
    AND NOT EXISTS (
      SELECT 1
        FROM social_user_interactions block
       WHERE block.relation_type = 'block'
         AND (
           (block.actor_user_id = ? AND block.target_user_id = c.owner_user_id)
           OR
           (block.actor_user_id = c.owner_user_id AND block.target_user_id = ?)
         )
    )
 ON CONFLICT(actor_user_id, target_type, target_id)
 DO UPDATE SET relationship_id = interaction_likes.relationship_id
 RETURNING relationship_id, actor_user_id, target_type, target_id, created_at`

const COMMENT_LIKE_SQL = `INSERT INTO interaction_likes
  (relationship_id, actor_user_id, target_type, target_id, created_at)
 SELECT ?, ?, 'comment', c.id, ?
   FROM social_comments c
  WHERE c.id = ?
    AND c.state = 'PUBLISHED'
    AND NOT EXISTS (
      SELECT 1
        FROM social_user_interactions block
       WHERE block.relation_type = 'block'
         AND (
           (block.actor_user_id = ? AND block.target_user_id = c.author_user_id)
           OR
           (block.actor_user_id = c.author_user_id AND block.target_user_id = ?)
           OR
           (block.actor_user_id = ? AND block.target_user_id = ?)
           OR
           (block.actor_user_id = ? AND block.target_user_id = ?)
         )
    )
 ON CONFLICT(actor_user_id, target_type, target_id)
 DO UPDATE SET relationship_id = interaction_likes.relationship_id
 RETURNING relationship_id, actor_user_id, target_type, target_id, created_at`

/** D1 remains the default production adapter until a separately authorized cutover. */
export function createD1LikeMutationStore(db: LikeMutationD1QueryExecutor): LikeMutationStore {
  return {
    async create(input) {
      const sql = input.targetType === 'content' ? CONTENT_LIKE_SQL : COMMENT_LIKE_SQL
      const values = [
        input.relationshipId,
        input.actorUserId,
        input.createdAt,
        input.targetId,
        ...(input.targetType === 'content'
          ? [input.actorUserId, input.actorUserId]
          : [
              input.actorUserId,
              input.actorUserId,
              input.actorUserId,
              input.parentOwnerUserId ?? null,
              input.parentOwnerUserId ?? null,
              input.actorUserId,
            ]),
      ]

      try {
        return await db.prepare(sql).bind(...values).first<LikeMutationRow>()
      } catch {
        throw new LikeMutationStoreError()
      }
    },

    async remove(input) {
      try {
        await db.prepare(
          'DELETE FROM interaction_likes WHERE actor_user_id = ? AND target_type = ? AND target_id = ?',
        ).bind(input.actorUserId, input.targetType, input.targetId).run()
      } catch {
        throw new LikeMutationStoreError()
      }
    },
  }
}
