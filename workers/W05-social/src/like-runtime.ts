/// <reference types="@cloudflare/workers-types" />

import { ReplyAudienceRuntimeError } from './reply-audience-runtime.js'
import { fetchPublishedContentSocialContext, type PublishedContentSocialContext, type W03ContentBinding } from './w03-content-context-client.js'

export class LikeRuntimeError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code) }
}

export type LikeTarget = {
  targetType: string
  targetId: string
}

export type LikeResult = {
  relationshipId: string
  actorUserId: string
  targetType: 'content' | 'comment'
  targetId: string
  createdAt: string
}

const RESOURCE_ID_MAX = 128
const LIKE_STATUS_CACHE_TTL_SECONDS = 5
const LIKE_AGGREGATE_CACHE_TTL_SECONDS = 5

const getDefaultCache = (): Cache | null => {
  if (typeof globalThis.caches === 'undefined') return null
  return (globalThis.caches as unknown as { default?: Cache }).default ?? null
}

const likeViewerStateCacheKey = (actorUserId: string, targetType: string, targetId: string): Request =>
  new Request(
    'https://cache.luckread.internal/__social-like-viewer-state?v=1&actor=' +
      encodeURIComponent(actorUserId) +
      '&type=' + encodeURIComponent(targetType) +
      '&id=' + encodeURIComponent(targetId),
    { method: 'GET' },
  )

const likeAggregateCacheKey = (targetType: string, targetId: string): Request =>
  new Request(
    'https://cache.luckread.internal/__social-like-aggregate?v=1&type=' +
      encodeURIComponent(targetType) +
      '&id=' + encodeURIComponent(targetId),
    { method: 'GET' },
  )

const readCachedLikeViewerState = async (
  actorUserId: string,
  targetType: string,
  targetId: string,
): Promise<boolean | null> => {
  const cache = getDefaultCache()
  if (!cache) return null
  const hit = await cache.match(likeViewerStateCacheKey(actorUserId, targetType, targetId))
  if (!hit) return null
  try {
    const value = await hit.json() as { liked?: unknown }
    return typeof value.liked === 'boolean' ? value.liked : null
  } catch {
    return null
  }
}

const readCachedLikeAggregate = async (
  targetType: string,
  targetId: string,
): Promise<number | null> => {
  const cache = getDefaultCache()
  if (!cache) return null
  const hit = await cache.match(likeAggregateCacheKey(targetType, targetId))
  if (!hit) return null
  try {
    const value = await hit.json() as { likeCount?: unknown }
    return typeof value.likeCount === 'number' &&
      Number.isSafeInteger(value.likeCount) &&
      value.likeCount >= 0
      ? value.likeCount
      : null
  } catch {
    return null
  }
}

const writeCachedLikeViewerState = async (
  actorUserId: string,
  targetType: string,
  targetId: string,
  liked: boolean,
): Promise<void> => {
  const cache = getDefaultCache()
  if (!cache) return
  const response = Response.json({ liked }, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, max-age=0, s-maxage=' + LIKE_STATUS_CACHE_TTL_SECONDS,
    },
  })
  await cache.put(likeViewerStateCacheKey(actorUserId, targetType, targetId), response)
}

const writeCachedLikeAggregate = async (
  targetType: string,
  targetId: string,
  likeCount: number,
): Promise<void> => {
  const cache = getDefaultCache()
  if (!cache) return
  const response = Response.json({ likeCount }, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=' + LIKE_AGGREGATE_CACHE_TTL_SECONDS,
    },
  })
  await cache.put(likeAggregateCacheKey(targetType, targetId), response)
}

const invalidateCachedLikeViewerState = async (
  actorUserId: string,
  targetType: string,
  targetId: string,
): Promise<void> => {
  const cache = getDefaultCache()
  if (!cache) return
  await cache.delete(likeViewerStateCacheKey(actorUserId, targetType, targetId))
}

const invalidateCachedLikeAggregate = async (
  targetType: string,
  targetId: string,
): Promise<void> => {
  const cache = getDefaultCache()
  if (!cache) return
  await cache.delete(likeAggregateCacheKey(targetType, targetId))
}

const validateTarget = (target: LikeTarget): { targetType: 'content' | 'comment'; targetId: string } => {
  if (target.targetType !== 'content' && target.targetType !== 'comment') {
    throw new LikeRuntimeError('VALIDATION_FAILED', 400)
  }
  const targetId = target.targetId?.trim() ?? ''
  if (!targetId || targetId.length > RESOURCE_ID_MAX) {
    throw new LikeRuntimeError('VALIDATION_FAILED', 400)
  }
  return { targetType: target.targetType, targetId }
}

const validateActor = (actorUserId: string): string => {
  const value = actorUserId.trim()
  if (!value || value.length > RESOURCE_ID_MAX) {
    throw new LikeRuntimeError('UNAUTHENTICATED', 401)
  }
  return value
}

type LikeTargetContext = {
  relatedUserIds: string[]
}

const resolvePublishedContext = async (
  binding: W03ContentBinding | undefined,
  contentId: string,
  correlationId: string,
): Promise<PublishedContentSocialContext | null> => {
  try {
    return await fetchPublishedContentSocialContext(binding, { contentId, correlationId })
  } catch (error) {
    if (error instanceof ReplyAudienceRuntimeError) {
      if (error.status === 404) return null
      if (error.status === 400) throw new LikeRuntimeError('VALIDATION_FAILED', 400)
      if (error.status === 403) throw new LikeRuntimeError('PERMISSION_DENIED', 403)
      if (error.status === 429) throw new LikeRuntimeError('RATE_LIMITED', 429)
    }
    throw new LikeRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
}

const resolveLikeTargetContext = async (
  db: D1Database,
  w03Content: W03ContentBinding | undefined,
  targetType: 'content' | 'comment',
  targetId: string,
  correlationId: string,
  prevalidatedContentContext?: PublishedContentSocialContext,
): Promise<LikeTargetContext | null> => {
  if (targetType === 'content') {
    const context = prevalidatedContentContext
      ? (
          prevalidatedContentContext.contentId === targetId &&
          prevalidatedContentContext.state === 'PUBLISHED'
            ? prevalidatedContentContext
            : null
        )
      : await resolvePublishedContext(w03Content, targetId, correlationId)
    if (!context) return null
    return { relatedUserIds: context.ownerUserId ? [context.ownerUserId] : [] }
  }

  const comment = await db.prepare(
    'SELECT id, state, author_user_id, content_id FROM social_comments WHERE id = ? LIMIT 1',
  ).bind(targetId).first<{
    id: string
    state: string
    author_user_id: string | null
    content_id: string
  }>()
  if (!comment || comment.state !== 'PUBLISHED') return null

  const parentContext = await resolvePublishedContext(w03Content, comment.content_id, correlationId)
  if (!parentContext) return null
  return {
    relatedUserIds: [comment.author_user_id, parentContext.ownerUserId]
      .filter((userId): userId is string => typeof userId === 'string' && userId.length > 0),
  }
}

const assertTargetNotBlocked = async (
  db: D1Database,
  actorUserId: string,
  relatedUserIds: string[],
): Promise<void> => {
  const targets = [...new Set(relatedUserIds.filter(userId => userId !== actorUserId))]
  if (targets.length === 0) return
  const placeholders = targets.map(() => '?').join(', ')
  const row = await db.prepare(
    `SELECT EXISTS (
       SELECT 1
       FROM social_user_interactions block
       WHERE block.relation_type = 'block'
         AND (
           (block.actor_user_id = ? AND block.target_user_id IN (${placeholders}))
           OR
           (block.target_user_id = ? AND block.actor_user_id IN (${placeholders}))
         )
     ) AS blocked`,
  ).bind(actorUserId, ...targets, actorUserId, ...targets).first<{ blocked: number }>()
  if (Number(row?.blocked ?? 0) === 1) throw new LikeRuntimeError('CONFLICT', 409)
}

export async function like(
  db: D1Database,
  w03Content: W03ContentBinding | undefined,
  actorUserId: string,
  target: LikeTarget,
  correlationId: string,
  prevalidatedContentContext?: PublishedContentSocialContext,
): Promise<LikeResult> {
  const actor = validateActor(actorUserId)
  const { targetType, targetId } = validateTarget(target)

  const targetContext = await resolveLikeTargetContext(
    db,
    w03Content,
    targetType,
    targetId,
    correlationId,
    prevalidatedContentContext,
  )
  if (!targetContext) throw new LikeRuntimeError('NOT_FOUND', 404)
  await assertTargetNotBlocked(db, actor, targetContext.relatedUserIds)

  const createdAt = new Date().toISOString()
  const relationshipId = crypto.randomUUID()
  const insertSql = targetType === 'content'
    ? `INSERT INTO interaction_likes
        (relationship_id, actor_user_id, target_type, target_id, created_at)
       SELECT ?, ?, 'content', c.id, ?
         FROM contents c
        WHERE c.id = ?
          AND c.state = 'PUBLISHED'
          AND NOT EXISTS (
            SELECT 1
              FROM social_user_interactions block
             WHERE block.relation_type = 'block'
               AND (
                 (block.actor_user_id = ? AND block.target_user_id = c.owner_user_id)
                 OR
                 (block.actor_user_id = c.owner_user_id AND block.target_user_id = ?)
               )
          )
       ON CONFLICT(actor_user_id, target_type, target_id)
       DO UPDATE SET relationship_id = interaction_likes.relationship_id
       RETURNING relationship_id, actor_user_id, target_type, target_id, created_at`
    : `INSERT INTO interaction_likes
        (relationship_id, actor_user_id, target_type, target_id, created_at)
       SELECT ?, ?, 'comment', c.id, ?
         FROM social_comments c
         JOIN contents content ON content.id = c.content_id
        WHERE c.id = ?
          AND c.state = 'PUBLISHED'
          AND content.state = 'PUBLISHED'
          AND NOT EXISTS (
            SELECT 1
              FROM social_user_interactions block
             WHERE block.relation_type = 'block'
               AND (
                 (block.actor_user_id = ? AND block.target_user_id = c.author_user_id)
                 OR
                 (block.actor_user_id = c.author_user_id AND block.target_user_id = ?)
                 OR
                 (block.actor_user_id = ? AND block.target_user_id = content.owner_user_id)
                 OR
                 (block.actor_user_id = content.owner_user_id AND block.target_user_id = ?)
               )
          )
       ON CONFLICT(actor_user_id, target_type, target_id)
       DO UPDATE SET relationship_id = interaction_likes.relationship_id
       RETURNING relationship_id, actor_user_id, target_type, target_id, created_at`

  const row = await db.prepare(insertSql)
    .bind(
      relationshipId,
      actor,
      createdAt,
      targetId,
      ...(targetType === 'content'
        ? [actor, actor]
        : [actor, actor, actor, actor]),
    )
    .first<{ relationship_id: string; actor_user_id: string; target_type: 'content' | 'comment'; target_id: string; created_at: string }>()

  if (!row) throw new LikeRuntimeError('NOT_FOUND', 404)

  await Promise.all([
    invalidateCachedLikeViewerState(actor, targetType, targetId),
    invalidateCachedLikeAggregate(targetType, targetId),
  ])

  return {
    relationshipId: row.relationship_id,
    actorUserId: row.actor_user_id,
    targetType: row.target_type,
    targetId: row.target_id,
    createdAt: row.created_at,
  }
}

export async function getLikeStatus(
  db: D1Database,
  w03Content: W03ContentBinding | undefined,
  actorUserId: string,
  target: LikeTarget,
  correlationId: string,
  prevalidatedContentContext?: PublishedContentSocialContext,
): Promise<{ liked: boolean; likeCount: number }> {
  const actor = validateActor(actorUserId)
  const { targetType, targetId } = validateTarget(target)

  // Validate target visibility and block relationships before consulting caches.
  const targetContext = await resolveLikeTargetContext(
    db,
    w03Content,
    targetType,
    targetId,
    correlationId,
    prevalidatedContentContext,
  )
  if (!targetContext) {
    await Promise.all([
      invalidateCachedLikeViewerState(actor, targetType, targetId),
      invalidateCachedLikeAggregate(targetType, targetId),
    ])
    return { liked: false, likeCount: 0 }
  }
  await assertTargetNotBlocked(db, actor, targetContext.relatedUserIds)

  const [cachedLiked, cachedCount] = await Promise.all([
    readCachedLikeViewerState(actor, targetType, targetId),
    readCachedLikeAggregate(targetType, targetId),
  ])
  if (cachedLiked !== null && cachedCount !== null) {
    return { liked: cachedLiked, likeCount: cachedCount }
  }

  const countSelect = cachedCount === null
    ? `, (SELECT COUNT(*)
         FROM interaction_likes il_count
        WHERE il_count.target_type = ?
          AND il_count.target_id = ?) AS like_count`
    : ''
  const row = await db.prepare(
    `SELECT EXISTS (
       SELECT 1
       FROM interaction_likes il
       WHERE il.actor_user_id = ?
         AND il.target_type = ?
         AND il.target_id = ?
     ) AS liked${countSelect}`,
  ).bind(
    actor,
    targetType,
    targetId,
    ...(cachedCount === null ? [targetType, targetId] : []),
  ).first<{ liked: number; like_count?: number }>()

  const likeCount = cachedCount ?? Math.max(0, Number(row?.like_count ?? 0))
  const result = {
    liked: Boolean(row?.liked),
    likeCount,
  }
  await writeCachedLikeViewerState(actor, targetType, targetId, result.liked)
  if (cachedCount === null) {
    await writeCachedLikeAggregate(targetType, targetId, likeCount)
  }
  return result
}

export async function unlike(
  db: D1Database,
  actorUserId: string,
  target: LikeTarget,
): Promise<void> {
  const actor = validateActor(actorUserId)
  const { targetType, targetId } = validateTarget(target)
  await db.prepare(
    'DELETE FROM interaction_likes WHERE actor_user_id = ? AND target_type = ? AND target_id = ?',
  ).bind(actor, targetType, targetId).run()
  await Promise.all([
    invalidateCachedLikeViewerState(actor, targetType, targetId),
    invalidateCachedLikeAggregate(targetType, targetId),
  ])
}
