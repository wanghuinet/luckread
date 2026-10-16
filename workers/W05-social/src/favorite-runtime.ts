/// <reference types="@cloudflare/workers-types" />

export class FavoriteRuntimeError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code) }
}

export type FavoriteTarget = {
  targetType: string
  targetId: string
}

export type FavoriteResult = {
  relationshipId: string
  actorUserId: string
  targetType: 'content'
  targetId: string
  createdAt: string
}

const RESOURCE_ID_MAX = 128
const FAVORITE_STATUS_CACHE_TTL_MS = 5000
const FAVORITE_STATUS_CACHE_MAX_ENTRIES = 2048
const favoriteStatusCache = new Map<string, { value: { favorited: boolean }; expiresAt: number }>()

const favoriteStatusKey = (actorUserId: string, targetId: string): string => actorUserId + '\\0' + targetId

const pruneFavoriteStatusCache = (): void => {
  if (favoriteStatusCache.size < FAVORITE_STATUS_CACHE_MAX_ENTRIES) return
  const oldestKey = favoriteStatusCache.keys().next().value
  if (typeof oldestKey === 'string') favoriteStatusCache.delete(oldestKey)
}

const validateTarget = (target: FavoriteTarget): { targetType: 'content'; targetId: string } => {
  if (target.targetType !== 'content') {
    throw new FavoriteRuntimeError('VALIDATION_FAILED', 400)
  }

  const targetId = target.targetId?.trim() ?? ''
  if (!targetId || targetId.length > RESOURCE_ID_MAX) {
    throw new FavoriteRuntimeError('VALIDATION_FAILED', 400)
  }

  return { targetType: 'content', targetId }
}

const validateActor = (actorUserId: string): string => {
  const value = actorUserId.trim()
  if (!value || value.length > RESOURCE_ID_MAX) {
    throw new FavoriteRuntimeError('UNAUTHENTICATED', 401)
  }
  return value
}

export async function favorite(
  db: D1Database,
  actorUserId: string,
  target: FavoriteTarget,
): Promise<FavoriteResult> {
  const actor = validateActor(actorUserId)
  const { targetType, targetId } = validateTarget(target)

  const targetRow = await db.prepare(
    'SELECT id, state FROM contents WHERE id = ? LIMIT 1',
  ).bind(targetId).first<{ id: string; state: string }>()

  if (!targetRow || targetRow.state !== 'PUBLISHED') {
    throw new FavoriteRuntimeError('NOT_FOUND', 404)
  }

  const relationshipId = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  const row = await db.prepare(
    `INSERT INTO interaction_favorites
      (relationship_id, actor_user_id, target_type, target_id, created_at)
     SELECT ?, ?, 'content', c.id, ?
       FROM contents c
      WHERE c.id = ?
        AND c.state = 'PUBLISHED'
     ON CONFLICT(actor_user_id, target_type, target_id)
     DO UPDATE SET relationship_id = interaction_favorites.relationship_id
     RETURNING relationship_id, actor_user_id, target_type, target_id, created_at`,
  ).bind(
    relationshipId,
    actor,
    targetId,
    targetId,
    createdAt,
  ).first<{
    relationship_id: string
    actor_user_id: string
    target_type: 'content'
    target_id: string
    created_at: string
  }>()

  if (!row) throw new FavoriteRuntimeError('NOT_FOUND', 404)

  favoriteStatusCache.delete(favoriteStatusKey(actor, targetId))

  return {
    relationshipId: row.relationship_id,
    actorUserId: row.actor_user_id,
    targetType: row.target_type,
    targetId: row.target_id,
    createdAt: row.created_at,
  }
}

export async function getFavoriteStatus(
  db: D1Database,
  actorUserId: string,
  target: FavoriteTarget,
): Promise<{ favorited: boolean }> {
  const actor = validateActor(actorUserId)
  const { targetType, targetId } = validateTarget(target)
  const cacheKey = favoriteStatusKey(actor, targetId)
  const cached = favoriteStatusCache.get(cacheKey)
  if (cached) {
    if (cached.expiresAt > Date.now()) return { ...cached.value }
    favoriteStatusCache.delete(cacheKey)
  }

  const row = await db.prepare(
    `SELECT EXISTS (
       SELECT 1
       FROM interaction_favorites
       WHERE actor_user_id = ?
         AND target_type = ?
         AND target_id = c.id
     ) AS favorited
     FROM contents c
     WHERE c.id = ?
       AND c.state = 'PUBLISHED'
     LIMIT 1`,
  ).bind(actor, targetType, targetId).first<{ favorited: number }>()

  const value = { favorited: Boolean(row?.favorited) }
  pruneFavoriteStatusCache()
  favoriteStatusCache.set(cacheKey, { value, expiresAt: Date.now() + FAVORITE_STATUS_CACHE_TTL_MS })
  return { ...value }
}

export async function unfavorite(
  db: D1Database,
  actorUserId: string,
  target: FavoriteTarget,
): Promise<void> {
  const actor = validateActor(actorUserId)
  const { targetType, targetId } = validateTarget(target)

  await db.prepare(
    'DELETE FROM interaction_favorites WHERE actor_user_id = ? AND target_type = ? AND target_id = ?',
  ).bind(actor, targetType, targetId).run()
  favoriteStatusCache.delete(favoriteStatusKey(actor, targetId))
}



export type FavoriteListPage = {
  items: Array<{ targetId: string; createdAt: string }>
  nextCursor: string | null
  hasMore: boolean
}

type FavoriteListCursor = {
  v: 1
  actorUserId: string
  createdAt: string
  relationshipId: string
}

const encodeFavoriteListCursor = (value: FavoriteListCursor): string =>
  btoa(encodeURIComponent(JSON.stringify(value))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')

const decodeFavoriteListCursor = (cursor: string, actorUserId: string): FavoriteListCursor => {
  try {
    if (!cursor || cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error('invalid')
    const normalized = cursor.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
    const value = JSON.parse(decodeURIComponent(atob(padded))) as Partial<FavoriteListCursor>
    if (
      value.v !== 1 ||
      value.actorUserId !== actorUserId ||
      typeof value.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(value.createdAt)) ||
      typeof value.relationshipId !== 'string' ||
      !value.relationshipId.trim() ||
      value.relationshipId.length > RESOURCE_ID_MAX
    ) throw new Error('invalid')
    return value as FavoriteListCursor
  } catch {
    throw new FavoriteRuntimeError('INVALID_CURSOR', 400)
  }
}

export async function listFavorites(
  db: D1Database,
  actorUserId: string,
  cursor: string | null,
  limit: number,
): Promise<FavoriteListPage> {
  const actor = validateActor(actorUserId)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new FavoriteRuntimeError('VALIDATION_FAILED', 400)
  }
  const decoded = cursor ? decodeFavoriteListCursor(cursor, actor) : null
  const rows = decoded
    ? await db.prepare(
        `SELECT relationship_id, target_id, created_at
           FROM interaction_favorites
          WHERE actor_user_id = ?
            AND target_type = 'content'
            AND (created_at < ? OR (created_at = ? AND relationship_id < ?))
          ORDER BY created_at DESC, relationship_id DESC
          LIMIT ?`,
      ).bind(actor, decoded.createdAt, decoded.createdAt, decoded.relationshipId, limit + 1).all<{
        relationship_id: string
        target_id: string
        created_at: string
      }>()
    : await db.prepare(
        `SELECT relationship_id, target_id, created_at
           FROM interaction_favorites
          WHERE actor_user_id = ?
            AND target_type = 'content'
          ORDER BY created_at DESC, relationship_id DESC
          LIMIT ?`,
      ).bind(actor, limit + 1).all<{
        relationship_id: string
        target_id: string
        created_at: string
      }>()

  const hasMore = rows.results.length > limit
  const page = rows.results.slice(0, limit)
  const last = page.at(-1)
  return {
    items: page.map(row => ({ targetId: row.target_id, createdAt: row.created_at })),
    hasMore,
    nextCursor: hasMore && last
      ? encodeFavoriteListCursor({
          v: 1,
          actorUserId: actor,
          createdAt: last.created_at,
          relationshipId: last.relationship_id,
        })
      : null,
  }
}

export const clearFavoriteStatusCacheForTests = (): void => favoriteStatusCache.clear()
