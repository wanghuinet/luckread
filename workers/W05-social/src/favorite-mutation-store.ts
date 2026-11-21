export type FavoriteMutationRow = Readonly<{
  relationship_id: string
  actor_user_id: string
  target_type: 'content'
  target_id: string
  created_at: string
}>

export type FavoriteMutationCreateInput = Readonly<{
  relationshipId: string
  actorUserId: string
  targetType: 'content'
  targetId: string
  createdAt: string
}>

export type FavoriteMutationRemoveInput = Readonly<{
  actorUserId: string
  targetType: 'content'
  targetId: string
}>

export interface FavoriteMutationStore {
  create(input: FavoriteMutationCreateInput): Promise<FavoriteMutationRow | null>
  remove(input: FavoriteMutationRemoveInput): Promise<void>
}

export class FavoriteMutationStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('FAVORITE_MUTATION_STORE_UNAVAILABLE')
    this.name = 'FavoriteMutationStoreError'
  }
}

