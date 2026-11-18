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

