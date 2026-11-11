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

export interface FavoriteMutationD1Executor {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>
      run(): Promise<unknown>
    }
  }
}

/** D1 remains the production-default adapter until a separately authorized cutover. */
export function createD1FavoriteMutationStore(db: FavoriteMutationD1Executor): FavoriteMutationStore {
  return {
    async create(input) {
      try {
        const row = await db.prepare(
          `INSERT INTO interaction_favorites
             (relationship_id, actor_user_id, target_type, target_id, created_at)
           VALUES (?, ?, 'content', ?, ?)
           ON CONFLICT(actor_user_id, target_type, target_id)
           DO UPDATE SET relationship_id = interaction_favorites.relationship_id
           RETURNING relationship_id, actor_user_id, target_type, target_id, created_at`,
        ).bind(
          input.relationshipId,
          input.actorUserId,
          input.targetId,
          input.createdAt,
        ).first<FavoriteMutationRow>()
        return row ?? null
      } catch {
        throw new FavoriteMutationStoreError()
      }
    },

    async remove(input) {
      try {
        await db.prepare(
          'DELETE FROM interaction_favorites WHERE actor_user_id = ? AND target_type = ? AND target_id = ?',
        ).bind(input.actorUserId, input.targetType, input.targetId).run()
      } catch {
        throw new FavoriteMutationStoreError()
      }
    },
  }
}
