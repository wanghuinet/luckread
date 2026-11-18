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

