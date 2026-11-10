/// <reference types="@cloudflare/workers-types" />

export type FollowRow = Readonly<{
  relationship_id: string
  follower_user_id: string
  target_user_id: string
  created_at: string
}>

export type FollowMutation = Readonly<{
  followerUserId: string
  targetUserId: string
  relationshipId: string
  createdAt: string
}>

export interface FollowStore {
  /**
   * Return the active relationship, or null when the block policy prevents it.
   * An existing active relationship is returned unchanged.
   */
  follow(input: FollowMutation): Promise<FollowRow | null>
  /** Deleting a missing relationship is an idempotent success. */
  unfollow(followerUserId: string, targetUserId: string): Promise<void>
}

export class FollowStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('FOLLOW_STORE_UNAVAILABLE')
    this.name = 'FollowStoreError'
  }
}

/** The current production adapter. Cloudflare D1 remains the default authority. */
export function createD1FollowStore(db: D1Database): FollowStore {
  return {
    async follow(input) {
      const { followerUserId: follower, targetUserId: target } = input
      const state = await db.prepare(
        `SELECT
           EXISTS (
             SELECT 1
             FROM social_user_interactions
             WHERE relation_type = 'block'
               AND (
                 (actor_user_id = ? AND target_user_id = ?)
                 OR
                 (actor_user_id = ? AND target_user_id = ?)
               )
           ) AS blocked,
           r.relationship_id,
           r.follower_user_id,
           r.target_user_id,
           r.created_at
           FROM (SELECT 1) AS seed
           LEFT JOIN social_follow_relationships AS r
             ON r.follower_user_id = ? AND r.target_user_id = ?
           LIMIT 1`,
      ).bind(follower, target, target, follower, follower, target).first<{
        blocked: number
        relationship_id?: string
        follower_user_id?: string
        target_user_id?: string
        created_at?: string
      }>()

      if (Number(state?.blocked ?? 0) === 1) return null

      if (
        state?.relationship_id &&
        state.follower_user_id &&
        state.target_user_id &&
        state.created_at
      ) {
        return {
          relationship_id: state.relationship_id,
          follower_user_id: state.follower_user_id,
          target_user_id: state.target_user_id,
          created_at: state.created_at,
        }
      }

      const row = await db.prepare(
        `INSERT INTO social_follow_relationships
          (relationship_id, follower_user_id, target_user_id, created_at)
         SELECT ?, ?, ?, ?
          WHERE NOT EXISTS (
            SELECT 1
            FROM social_user_interactions block
            WHERE block.relation_type = 'block'
              AND (
                (block.actor_user_id = ? AND block.target_user_id = ?)
                OR
                (block.actor_user_id = ? AND block.target_user_id = ?)
              )
          )
         ON CONFLICT(follower_user_id, target_user_id)
         DO UPDATE SET relationship_id = social_follow_relationships.relationship_id
         RETURNING relationship_id, follower_user_id, target_user_id, created_at`,
      ).bind(
        input.relationshipId,
        follower,
        target,
        input.createdAt,
        follower,
        target,
        target,
        follower,
      ).first<FollowRow>()

      return row ?? null
    },

    async unfollow(followerUserId, targetUserId) {
      await db.prepare(
        'DELETE FROM social_follow_relationships WHERE follower_user_id = ? AND target_user_id = ?',
      ).bind(followerUserId, targetUserId).run()
    },
  }
}
