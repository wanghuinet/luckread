/// <reference types="@cloudflare/workers-types" />

export type RelationshipGraph = {
  viewerUserId: string
  targetUserId: string
  following: boolean
  followedBy: boolean
  mutualFollow: boolean
  blocked: boolean
  blockedBy: boolean
  muted: boolean
  relationshipId: string | null
  createdAt: string | null
}

export class RelationshipGraphRuntimeError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code) }
}

const MAX_ID = 128

const validateUserId = (value: string): string => {
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_ID) {
    throw new RelationshipGraphRuntimeError('VALIDATION_FAILED', 400)
  }
  return normalized
}

export async function getRelationshipGraph(
  db: D1Database,
  viewerUserId: string,
  targetUserId: string,
): Promise<RelationshipGraph> {
  const viewer = validateUserId(viewerUserId)
  const target = validateUserId(targetUserId)

  if (viewer === target) {
    return {
      viewerUserId: viewer,
      targetUserId: target,
      following: false,
      followedBy: false,
      mutualFollow: false,
      blocked: false,
      blockedBy: false,
      muted: false,
      relationshipId: null,
      createdAt: null,
    }
  }

  const row = await db.prepare(
    `SELECT
       EXISTS (
         SELECT 1 FROM social_follow_relationships
         WHERE follower_user_id = ? AND target_user_id = ?
       ) AS following,
       EXISTS (
         SELECT 1 FROM social_follow_relationships
         WHERE follower_user_id = ? AND target_user_id = ?
       ) AS followed_by,
       (
         SELECT relationship_id
         FROM social_follow_relationships
         WHERE follower_user_id = ? AND target_user_id = ?
         LIMIT 1
       ) AS relationship_id,
       (
         SELECT created_at
         FROM social_follow_relationships
         WHERE follower_user_id = ? AND target_user_id = ?
         LIMIT 1
       ) AS created_at,
       EXISTS (
         SELECT 1 FROM social_user_interactions
         WHERE relation_type = 'block'
           AND actor_user_id = ? AND target_user_id = ?
       ) AS blocked,
       EXISTS (
         SELECT 1 FROM social_user_interactions
         WHERE relation_type = 'block'
           AND actor_user_id = ? AND target_user_id = ?
       ) AS blocked_by,
       EXISTS (
         SELECT 1 FROM social_user_interactions
         WHERE relation_type = 'mute'
           AND actor_user_id = ? AND target_user_id = ?
       ) AS muted`,
  ).bind(
    viewer, target,
    target, viewer,
    viewer, target,
    viewer, target,
    viewer, target,
    target, viewer,
    viewer, target,
  ).first<{
    following: number
    followed_by: number
    relationship_id: string | null
    created_at: string | null
    blocked: number
    blocked_by: number
    muted: number
  }>()

  return {
    viewerUserId: viewer,
    targetUserId: target,
    following: Boolean(row?.following),
    followedBy: Boolean(row?.followed_by),
    mutualFollow: Boolean(row?.following) && Boolean(row?.followed_by),
    blocked: Boolean(row?.blocked),
    blockedBy: Boolean(row?.blocked_by),
    muted: Boolean(row?.muted),
    relationshipId: row?.relationship_id ?? null,
    createdAt: row?.created_at ?? null,
  }
}
