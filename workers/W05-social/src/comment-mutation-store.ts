/// <reference types="@cloudflare/workers-types" />

export type CommentMutationState = 'PENDING' | 'PUBLISHED' | 'REJECTED' | 'AUTHOR_DELETED'

export type CommentDeleteRow = {
  id: string
  content_id: string
  author_user_id: string
  state: CommentMutationState
  has_replies: number | boolean
}

export type CommentUpdateRow = {
  id: string
  content_id: string
  author_user_id: string
  parent_id: string | null
  body: string
  state: 'PENDING' | 'PUBLISHED' | 'REJECTED'
  depth: number
  created_at: string
  updated_at: string
}

export type CommentDeleteInput = {
  commentId: string
  actorUserId: string
  now: string
}

export type CommentUpdateStoreInput = {
  commentId: string
  actorUserId: string
  body: string
  now: string
  expectedUpdatedAt: string
}

export interface CommentMutationStore {
  getForDelete(commentId: string): Promise<CommentDeleteRow | null>
  markDeleted(input: CommentDeleteInput): Promise<boolean>
  getDeleteState(commentId: string, actorUserId: string): Promise<CommentMutationState | null>
  getForUpdate(commentId: string): Promise<CommentUpdateRow | null>
  update(input: CommentUpdateStoreInput): Promise<CommentUpdateRow | null>
}

export class CommentMutationStoreError extends Error {
  constructor() { super('COMMENT_MUTATION_STORE_UNAVAILABLE') }
}

export function createD1CommentMutationStore(db: D1Database): CommentMutationStore {
  return {
    async getForDelete(commentId) {
      try {
        return await db.prepare(
          `SELECT
             c.id,
             c.content_id,
             c.author_user_id,
             c.state,
             EXISTS (
               SELECT 1
                 FROM social_comments child
                WHERE child.parent_id = c.id
             ) AS has_replies
           FROM social_comments c
           WHERE c.id = ?
           LIMIT 1`,
        ).bind(commentId).first<CommentDeleteRow>()
      } catch {
        throw new CommentMutationStoreError()
      }
    },

    async markDeleted(input) {
      try {
        const result = await db.prepare(
          `UPDATE social_comments
              SET state = 'AUTHOR_DELETED', updated_at = ?
            WHERE id = ?
              AND author_user_id = ?
              AND state = 'PUBLISHED'
              AND NOT EXISTS (
                SELECT 1
                  FROM social_comments child
                 WHERE child.parent_id = social_comments.id
              )`,
        ).bind(input.now, input.commentId, input.actorUserId).run()
        return Number(result.meta?.changes ?? 0) === 1
      } catch {
        throw new CommentMutationStoreError()
      }
    },

    async getDeleteState(commentId, actorUserId) {
      try {
        const row = await db.prepare(
          `SELECT state
             FROM social_comments
            WHERE id = ?
              AND author_user_id = ?
            LIMIT 1`,
        ).bind(commentId, actorUserId).first<{ state: CommentMutationState }>()
        return row?.state ?? null
      } catch {
        throw new CommentMutationStoreError()
      }
    },

    async getForUpdate(commentId) {
      try {
        return await db.prepare(
          `SELECT
             c.id,
             c.content_id,
             c.author_user_id,
             c.parent_id,
             c.body,
             c.state,
             c.depth,
             c.created_at,
             c.updated_at
           FROM social_comments c
           WHERE c.id = ?
           LIMIT 1`,
        ).bind(commentId).first<CommentUpdateRow>()
      } catch {
        throw new CommentMutationStoreError()
      }
    },

    async update(input) {
      try {
        return await db.prepare(
          `UPDATE social_comments
              SET body = ?, updated_at = ?
            WHERE id = ?
              AND author_user_id = ?
              AND state = 'PUBLISHED'
              AND updated_at = ?
            RETURNING id, content_id, author_user_id, parent_id, body, state, depth, created_at, updated_at`,
        ).bind(
          input.body,
          input.now,
          input.commentId,
          input.actorUserId,
          input.expectedUpdatedAt,
        ).first<CommentUpdateRow>()
      } catch {
        throw new CommentMutationStoreError()
      }
    },
  }
}
