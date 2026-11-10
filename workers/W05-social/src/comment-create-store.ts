/// <reference types="@cloudflare/workers-types" />
import { replyAudienceAllowedParams, replyAudienceAllowedSql } from './reply-audience-runtime.js'

export type CommentCreateState = 'PENDING' | 'PUBLISHED' | 'REJECTED' | 'AUTHOR_DELETED'

export type CommentCreateValidation = {
  existing_id: string | null
  existing_content_id: string | null
  existing_parent_id: string | null
  existing_body: string | null
  existing_author_user_id: string | null
  existing_state: CommentCreateState | null
  existing_depth: number | null
  existing_created_at: string | null
  existing_updated_at: string | null
  content_state: string | null
  content_owner_user_id: string | null
  parent_content_id: string | null
  parent_author_user_id: string | null
  parent_state: string | null
  parent_depth: number | null
  recent_count: number
  blocked: number | boolean
  reply_audience_allowed: number | boolean
}

export type CommentCreateValidationInput = {
  actorUserId: string
  contentId: string
  parentId: string | null
  idempotencyKey: string
  actorVerified: boolean
}

export type CommentCreateInsertInput = CommentCreateValidationInput & {
  id: string
  body: string
  depth: number
  now: string
}

export type StoredCommentCreate = {
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

export type CommentCreateFinalState = {
  content_state: string
  reply_audience_allowed: number | boolean
}

export interface CommentCreateStore {
  validate(input: CommentCreateValidationInput): Promise<CommentCreateValidation | null>
  insert(input: CommentCreateInsertInput): Promise<StoredCommentCreate | null>
  getFinalState(input: Pick<CommentCreateValidationInput, 'actorUserId' | 'contentId' | 'actorVerified'>): Promise<CommentCreateFinalState | null>
}

export class CommentCreateStoreError extends Error {
  constructor() { super('COMMENT_CREATE_STORE_UNAVAILABLE') }
}

const validateSql = `WITH existing_comment AS (
       SELECT id, content_id, parent_id, body, author_user_id, state, depth, created_at, updated_at
       FROM social_comments
       WHERE author_user_id = ? AND idempotency_key = ?
       LIMIT 1
     )
     SELECT
       ec.id AS existing_id,
       ec.content_id AS existing_content_id,
       ec.parent_id AS existing_parent_id,
       ec.body AS existing_body,
       ec.author_user_id AS existing_author_user_id,
       ec.state AS existing_state,
       ec.depth AS existing_depth,
       ec.created_at AS existing_created_at,
       ec.updated_at AS existing_updated_at,
       (SELECT state FROM contents WHERE id = ? LIMIT 1) AS content_state,
       (SELECT owner_user_id FROM contents WHERE id = ? LIMIT 1) AS content_owner_user_id,
       (SELECT content_id FROM social_comments WHERE id = ? LIMIT 1) AS parent_content_id,
       (SELECT author_user_id FROM social_comments WHERE id = ? LIMIT 1) AS parent_author_user_id,
       (SELECT state FROM social_comments WHERE id = ? LIMIT 1) AS parent_state,
       (SELECT depth FROM social_comments WHERE id = ? LIMIT 1) AS parent_depth,
       (SELECT COUNT(*) FROM social_comments WHERE author_user_id = ? AND created_at > datetime('now', '-60 seconds')) AS recent_count,
       EXISTS (
         SELECT 1
         FROM social_user_interactions block
         WHERE block.relation_type = 'block'
           AND (
             (block.actor_user_id = ? AND block.target_user_id = (SELECT owner_user_id FROM contents WHERE id = ? LIMIT 1))
             OR
             (block.actor_user_id = (SELECT owner_user_id FROM contents WHERE id = ? LIMIT 1) AND block.target_user_id = ?)
             OR
             (block.actor_user_id = ? AND block.target_user_id = (SELECT author_user_id FROM social_comments WHERE id = ? LIMIT 1))
             OR
             (block.actor_user_id = (SELECT author_user_id FROM social_comments WHERE id = ? LIMIT 1) AND block.target_user_id = ?)
           )
       ) AS blocked,
       (
         SELECT CASE WHEN ${replyAudienceAllowedSql} THEN 1 ELSE 0 END
           FROM contents content
          WHERE content.id = ?
       ) AS reply_audience_allowed
     FROM (SELECT 1) seed
     LEFT JOIN existing_comment ec ON 1 = 1`

const insertSql = `INSERT INTO social_comments
      (id, content_id, author_user_id, parent_id, body, state, depth, idempotency_key, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, 'PUBLISHED', ?, ?, ?, ?
       FROM contents content
      WHERE content.id = ?
        AND content.state = 'PUBLISHED'
        AND (
          ? IS NULL
          OR EXISTS (
            SELECT 1
              FROM social_comments parent
             WHERE parent.id = ?
               AND parent.content_id = content.id
               AND parent.state = 'PUBLISHED'
               AND parent.depth < 3
          )
        )
        AND NOT EXISTS (
          SELECT 1
            FROM social_user_interactions block
           WHERE block.relation_type = 'block'
             AND (
               (block.actor_user_id = ? AND block.target_user_id = content.owner_user_id)
               OR
               (block.actor_user_id = content.owner_user_id AND block.target_user_id = ?)
               OR
               (block.actor_user_id = ? AND block.target_user_id = (
                 SELECT author_user_id FROM social_comments WHERE id = ? LIMIT 1
               ))
               OR
               (block.actor_user_id = (
                 SELECT author_user_id FROM social_comments WHERE id = ? LIMIT 1
               ) AND block.target_user_id = ?)
             )
        )
        AND ${replyAudienceAllowedSql}
     ON CONFLICT(author_user_id, idempotency_key)
     DO UPDATE SET id = social_comments.id
     RETURNING id, content_id, author_user_id, parent_id, body, state, depth, created_at, updated_at`

export function createD1CommentCreateStore(db: D1Database): CommentCreateStore {
  return {
    async validate(input) {
      try {
        return await db.prepare(validateSql).bind(
          input.actorUserId,
          input.idempotencyKey,
          input.contentId,
          input.contentId,
          input.parentId,
          input.parentId,
          input.parentId,
          input.parentId,
          input.actorUserId,
          input.actorUserId,
          input.contentId,
          input.contentId,
          input.actorUserId,
          input.actorUserId,
          input.parentId,
          input.parentId,
          input.actorUserId,
          ...replyAudienceAllowedParams(input.actorUserId, input.actorVerified),
          input.contentId,
        ).first<CommentCreateValidation>()
      } catch {
        throw new CommentCreateStoreError()
      }
    },

    async insert(input) {
      try {
        return await db.prepare(insertSql).bind(
          input.id,
          input.contentId,
          input.actorUserId,
          input.parentId,
          input.body,
          input.depth,
          input.idempotencyKey,
          input.now,
          input.now,
          input.contentId,
          input.parentId,
          input.parentId,
          input.actorUserId,
          input.actorUserId,
          input.actorUserId,
          input.parentId,
          input.parentId,
          input.actorUserId,
          ...replyAudienceAllowedParams(input.actorUserId, input.actorVerified),
        ).first<StoredCommentCreate>()
      } catch {
        throw new CommentCreateStoreError()
      }
    },

    async getFinalState(input) {
      try {
        return await db.prepare(
          `SELECT content.state AS content_state,
                  CASE WHEN ${replyAudienceAllowedSql} THEN 1 ELSE 0 END AS reply_audience_allowed
             FROM contents content
            WHERE content.id = ? LIMIT 1`,
        ).bind(...replyAudienceAllowedParams(input.actorUserId, input.actorVerified), input.contentId)
          .first<CommentCreateFinalState>()
      } catch {
        throw new CommentCreateStoreError()
      }
    },
  }
}
