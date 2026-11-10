export type FollowStatusReadInput = Readonly<{
  followerUserId: string
  targetUserId: string
}>

export type FollowStatusReadRow = Readonly<{
  relationship_id: string
  created_at: string
  /** D1 returns 0/1; PostgreSQL returns a native boolean. */
  blocked: boolean | number
}>

export interface FollowStatusReadStore {
  getStatus(input: FollowStatusReadInput): Promise<FollowStatusReadRow | null>
}

export interface FollowStatusD1Database {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>
    }
  }
}

/** D1 remains the production-default follow-status adapter. */
export function createD1FollowStatusReadStore(
  db: FollowStatusD1Database,
): FollowStatusReadStore {
  return {
    async getStatus(input) {
      return db.prepare(
        `SELECT
           r.relationship_id,
           r.created_at,
           EXISTS (
             SELECT 1
               FROM social_user_interactions block
              WHERE block.relation_type = 'block'
                AND (
                  (block.actor_user_id = ? AND block.target_user_id = ?)
                  OR
                  (block.actor_user_id = ? AND block.target_user_id = ?)
                )
           ) AS blocked
         FROM social_follow_relationships r
         WHERE r.follower_user_id = ? AND r.target_user_id = ?
         LIMIT 1`,
      ).bind(
        input.followerUserId,
        input.targetUserId,
        input.targetUserId,
        input.followerUserId,
        input.followerUserId,
        input.targetUserId,
      ).first<FollowStatusReadRow>()
    },
  }
}
