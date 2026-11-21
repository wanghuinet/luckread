
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

