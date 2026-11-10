/// <reference types="@cloudflare/workers-types" />

import { ReplyAudienceRuntimeError } from './reply-audience-runtime.js'
import {
  createD1FavoriteListReadStore,
  FavoriteListReadStoreError,
  type FavoriteListReadStore,
} from './favorite-list-read-store.js'
import {
  createD1FavoriteStatusReadStore,
  FavoriteStatusReadStoreError,
  type FavoriteStatusReadStore,
} from './favorite-status-read-store.js'
import { fetchPublishedContentSocialContext, type W03ContentBinding } from './w03-content-context-client.js'

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
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(targetId) || targetId.length > RESOURCE_ID_MAX) {
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

const fetchPublishedTarget = async (
  binding: W03ContentBinding | undefined,
  targetId: string,
  correlationId: string,
): Promise<void> => {
  try {
    await fetchPublishedContentSocialContext(binding, { contentId: targetId, correlationId })
  } catch (error) {
    if (error instanceof ReplyAudienceRuntimeError) {
      if (error.status === 404) throw new FavoriteRuntimeError('NOT_FOUND', 404)
      if (error.status === 400) throw new FavoriteRuntimeError('VALIDATION_FAILED', 400)
      if (error.status === 403) throw new FavoriteRuntimeError('PERMISSION_DENIED', 403)
      if (error.status === 429) throw new FavoriteRuntimeError('RATE_LIMITED', 429)
    }
    throw new FavoriteRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
}

/**
 * W03 owns canonical content lifecycle; W05 owns only the favorite relation.
 * Cross-Worker publication changes cannot be locked in the same transaction,
 * so reads revalidate published visibility through W03 before using the cache.
 */
export async function favorite(
  db: D1Database,
  w03Content: W03ContentBinding | undefined,
  actorUserId: string,
  target: FavoriteTarget,
  correlationId: string,
): Promise<FavoriteResult> {
  const actor = validateActor(actorUserId)
  const { targetType, targetId } = validateTarget(target)

  await fetchPublishedTarget(w03Content, targetId, correlationId)

  const relationshipId = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  const row = await db.prepare(
    `INSERT INTO interaction_favorites
      (relationship_id, actor_user_id, target_type, target_id, created_at)
     VALUES (?, ?, 'content', ?, ?)
     ON CONFLICT(actor_user_id, target_type, target_id)
     DO UPDATE SET relationship_id = interaction_favorites.relationship_id
     RETURNING relationship_id, actor_user_id, target_type, target_id, created_at`,
  ).bind(
    relationshipId,
    actor,
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

type FavoriteStatusDataSource = D1Database | FavoriteStatusReadStore

function resolveFavoriteStatusReadStore(source: FavoriteStatusDataSource): FavoriteStatusReadStore {
  if (typeof (source as FavoriteStatusReadStore).isFavorited === 'function') {
    return source as FavoriteStatusReadStore
  }
  return createD1FavoriteStatusReadStore(source as D1Database)
}

export async function getFavoriteStatus(
  source: FavoriteStatusDataSource,
  w03Content: W03ContentBinding | undefined,
  actorUserId: string,
  target: FavoriteTarget,
  correlationId: string,
): Promise<{ favorited: boolean }> {
  const actor = validateActor(actorUserId)
  const { targetId } = validateTarget(target)
  const cacheKey = favoriteStatusKey(actor, targetId)

  try {
    // Canonical W03 visibility must be revalidated before cache or storage reads.
    await fetchPublishedTarget(w03Content, targetId, correlationId)
  } catch (error) {
    if (error instanceof FavoriteRuntimeError && error.status === 404) {
      favoriteStatusCache.delete(cacheKey)
      return { favorited: false }
    }
    throw error
  }

  const cached = favoriteStatusCache.get(cacheKey)
  if (cached) {
    if (cached.expiresAt > Date.now()) return { ...cached.value }
    favoriteStatusCache.delete(cacheKey)
  }

  let favorited: boolean
  try {
    favorited = await resolveFavoriteStatusReadStore(source).isFavorited({
      actorUserId: actor,
      targetId,
    })
  } catch (error) {
    if (error instanceof FavoriteStatusReadStoreError) {
      throw new FavoriteRuntimeError(error.code, error.status)
    }
    throw error
  }

  const value = { favorited }
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

type FavoriteListDataSource = D1Database | FavoriteListReadStore

function resolveFavoriteListReadStore(source: FavoriteListDataSource): FavoriteListReadStore {
  if (typeof (source as FavoriteListReadStore).list === 'function') {
    return source as FavoriteListReadStore
  }
  return createD1FavoriteListReadStore(source as D1Database)
}

export async function listFavorites(
  source: FavoriteListDataSource,
  actorUserId: string,
  cursor: string | null,
  limit: number,
): Promise<FavoriteListPage> {
  const actor = validateActor(actorUserId)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new FavoriteRuntimeError('VALIDATION_FAILED', 400)
  }
  const decoded = cursor ? decodeFavoriteListCursor(cursor, actor) : null
  let rows
  try {
    rows = await resolveFavoriteListReadStore(source).list({
      actorUserId: actor,
      cursor: decoded
        ? { createdAt: decoded.createdAt, relationshipId: decoded.relationshipId }
        : null,
      limit: limit + 1,
    })
  } catch (error) {
    if (error instanceof FavoriteListReadStoreError) {
      throw new FavoriteRuntimeError(error.code, error.status)
    }
    throw error
  }

  const hasMore = rows.length > limit
  const page = rows.slice(0, limit)
  const last = page.at(-1)
  return {
    items: page.map(row => ({ targetId: row.target_id, createdAt: row.created_at })),
    hasMore,
    nextCursor: hasMore && last
      ? encodeFavoriteListCursor({
          v: 1,
          actorUserId: actor,
          createdAt: last.cursor_created_at ?? last.created_at,
          relationshipId: last.relationship_id,
        })
      : null,
  }
}

export const clearFavoriteStatusCacheForTests = (): void => favoriteStatusCache.clear()
