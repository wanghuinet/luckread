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
