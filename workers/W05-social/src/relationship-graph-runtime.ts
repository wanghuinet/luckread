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
    }
  }

  const rows = await db.prepare(
    `SELECT relation_kind, relation_type
       FROM (
         SELECT 'follow_out' AS relation_kind, 'follow' AS relation_type
         FROM social_follow_relationships
         WHERE follower_user_id = ? AND target_user_id = ?
         UNION ALL
         SELECT 'follow_in' AS relation_kind, 'follow' AS relation_type
         FROM social_follow_relationships
         WHERE follower_user_id = ? AND target_user_id = ?
         UNION ALL
         SELECT 'block_out' AS relation_kind, relation_type
         FROM social_user_interactions
         WHERE actor_user_id = ? AND target_user_id = ? AND relation_type = 'block'
         UNION ALL
         SELECT 'block_in' AS relation_kind, relation_type
         FROM social_user_interactions
         WHERE actor_user_id = ? AND target_user_id = ? AND relation_type = 'block'
         UNION ALL
         SELECT 'mute_out' AS relation_kind, relation_type
         FROM social_user_interactions
         WHERE actor_user_id = ? AND target_user_id = ? AND relation_type = 'mute'
       )
     ORDER BY relation_kind`,
  ).bind(
    viewer, target,
    target, viewer,
    viewer, target,
    target, viewer,
    viewer, target,
  ).all<{ relation_kind: string; relation_type: string }>()

  const present = new Set((rows.results ?? []).map((row) => row.relation_kind))

  return {
    viewerUserId: viewer,
    targetUserId: target,
    following: present.has('follow_out'),
    followedBy: present.has('follow_in'),
    mutualFollow: present.has('follow_out') && present.has('follow_in'),
    blocked: present.has('block_out'),
    blockedBy: present.has('block_in'),
    muted: present.has('mute_out'),
  }
}
