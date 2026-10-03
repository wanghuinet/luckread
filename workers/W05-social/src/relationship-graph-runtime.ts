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
const RELATIONSHIP_GRAPH_CACHE_TTL_MS = 5000
const RELATIONSHIP_GRAPH_CACHE_MAX_ENTRIES = 2048
const relationshipGraphCache = new Map<string, { value: RelationshipGraph; expiresAt: number }>()

const relationshipGraphKey = (viewerUserId: string, targetUserId: string): string => viewerUserId + '\\0' + targetUserId

const pruneRelationshipGraphCache = (): void => {
  if (relationshipGraphCache.size < RELATIONSHIP_GRAPH_CACHE_MAX_ENTRIES) return
  const oldestKey = relationshipGraphCache.keys().next().value
  if (typeof oldestKey === 'string') relationshipGraphCache.delete(oldestKey)
}

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

  const cacheKey = relationshipGraphKey(viewer, target)
  const cached = relationshipGraphCache.get(cacheKey)
  if (cached) {
    if (cached.expiresAt > Date.now()) return { ...cached.value }
    relationshipGraphCache.delete(cacheKey)
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

  const blocked = Boolean(row?.blocked)
  const blockedBy = Boolean(row?.blocked_by)
  const relationshipVisible = !blocked && !blockedBy

  const value = {
    viewerUserId: viewer,
    targetUserId: target,
    following: relationshipVisible && Boolean(row?.following),
    followedBy: relationshipVisible && Boolean(row?.followed_by),
    mutualFollow: relationshipVisible && Boolean(row?.following) && Boolean(row?.followed_by),
    blocked,
    blockedBy,
    muted: Boolean(row?.muted),
    relationshipId: relationshipVisible ? row?.relationship_id ?? null : null,
    createdAt: relationshipVisible ? row?.created_at ?? null : null,
  }
  pruneRelationshipGraphCache()
  relationshipGraphCache.set(cacheKey, { value, expiresAt: Date.now() + RELATIONSHIP_GRAPH_CACHE_TTL_MS })
  return { ...value }
}

export const invalidateRelationshipGraph = async (viewerUserId: string, targetUserId: string): Promise<void> => {
  const viewer = viewerUserId.trim()
  const target = targetUserId.trim()
  if (!viewer || !target) return
  relationshipGraphCache.delete(relationshipGraphKey(viewer, target))
  relationshipGraphCache.delete(relationshipGraphKey(target, viewer))
}
