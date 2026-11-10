export type FollowingAuthorIdRow = Readonly<{
  user_id: string
}>

export interface FollowingAuthorIdsReadStore {
  /** Return at most the requested number of unblocked, unmuted followed author IDs. */
  list(viewerUserId: string, limit: number): Promise<readonly FollowingAuthorIdRow[]>
}

export interface FollowingAuthorIdsD1QueryExecutor {
  prepare(query: string): {
    bind(...values: unknown[]): {
      all<T>(): Promise<{ results?: T[] | null }>
    }
  }
}

export class FollowingAuthorIdsReadStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('FOLLOWING_AUTHOR_IDS_READ_UNAVAILABLE')
    this.name = 'FollowingAuthorIdsReadStoreError'
  }
}

/** D1 remains the production adapter; this preserves the existing candidate query. */
export function createD1FollowingAuthorIdsReadStore(
  db: FollowingAuthorIdsD1QueryExecutor,
): FollowingAuthorIdsReadStore {
  return {
    async list(viewerUserId, limit) {
      const result = await db.prepare(`
        SELECT f.target_user_id AS user_id
          FROM social_follow_relationships f
         WHERE f.follower_user_id = ?
           AND NOT EXISTS (
             SELECT 1
               FROM social_user_interactions b
              WHERE b.relation_type = 'block'
                AND (
                  (b.actor_user_id = ? AND b.target_user_id = f.target_user_id)
                  OR
                  (b.actor_user_id = f.target_user_id AND b.target_user_id = ?)
                )
           )
           AND NOT EXISTS (
             SELECT 1
               FROM social_user_interactions m
              WHERE m.relation_type = 'mute'
                AND m.actor_user_id = ?
                AND m.target_user_id = f.target_user_id
           )
         ORDER BY f.created_at DESC, f.target_user_id DESC
         LIMIT ?`).bind(
           viewerUserId,
           viewerUserId,
           viewerUserId,
           viewerUserId,
           limit,
         ).all<FollowingAuthorIdRow>()
      return result.results ?? []
    },
  }
}
