/// <reference types="@cloudflare/workers-types" />

export class FollowRuntimeError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code) }
}

type FollowRow = {
  relationship_id: string
  follower_user_id: string
  target_user_id: string
  created_at: string
}

export type FollowListDirection = 'followers' | 'following'

export type FollowListItem = {
  relationshipId: string
  userId: string
  followedAt: string
}

export type FollowListPage = {
  items: FollowListItem[]
  totalCount: number
  nextCursor: string | null
  hasMore: boolean
}

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const MAX_CURSOR_LENGTH = 2048

const FOLLOW_COUNT_CACHE_TTL_SECONDS = 5

const getDefaultCache = (): Cache | null => {
  if (typeof globalThis.caches === 'undefined') return null
  return (globalThis.caches as unknown as { default?: Cache }).default ?? null
}

const followCountCacheKey = (direction: FollowListDirection, userIdValue: string): Request =>
  new Request(
    'https://cache.luckread.internal/__social-follow-count?v=1&direction=' +
      encodeURIComponent(direction) +
      '&user=' + encodeURIComponent(userIdValue),
    { method: 'GET' },
  )

const readCachedFollowCount = async (
  direction: FollowListDirection,
  userIdValue: string,
): Promise<number | null> => {
  const cache = getDefaultCache()
  if (!cache) return null
  try {
    const hit = await cache.match(followCountCacheKey(direction, userIdValue))
    if (!hit) return null
    const value = await hit.json() as { totalCount?: unknown }
    return typeof value.totalCount === 'number' &&
      Number.isSafeInteger(value.totalCount) &&
      value.totalCount >= 0
      ? value.totalCount
      : null
  } catch {
    return null
  }
}

const writeCachedFollowCount = async (
  direction: FollowListDirection,
  userIdValue: string,
  totalCount: number,
): Promise<void> => {
  const cache = getDefaultCache()
  if (!cache) return
  try {
    await cache.put(
      followCountCacheKey(direction, userIdValue),
      Response.json(
        { totalCount },
        {
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'public, max-age=0, s-maxage=' + FOLLOW_COUNT_CACHE_TTL_SECONDS,
          },
        },
      ),
    )
  } catch {
    // Cache failure must never make the authoritative social read fail.
  }
}

export const invalidateFollowListCountCache = async (...userIds: string[]): Promise<void> => {
  const cache = getDefaultCache()
  if (!cache) return
  const normalizedIds = [...new Set(userIds.map((value) => value.trim()).filter(Boolean))]
  await Promise.all(normalizedIds.flatMap((id) => (
    (['followers', 'following'] as FollowListDirection[]).map(async (direction) => {
      try {
        await cache.delete(followCountCacheKey(direction, id))
      } catch {
        // Best-effort invalidation; D1 remains authoritative.
      }
    })
  )))
}

const userId = (v: string) => {
  const id = v.trim()
  if (!id || id.length > 256) throw new FollowRuntimeError('VALIDATION_FAILED', 400)
  return id
}

export const parseFollowListLimit = (value: string | null): number => {
  if (value === null || value.trim() === '') return DEFAULT_LIMIT
  const normalized = value.trim()
  if (!/^(?:[1-9]|[1-4][0-9]|50)$/.test(normalized)) {
    throw new FollowRuntimeError('VALIDATION_FAILED', 400)
  }
  return Math.min(Number(normalized), MAX_LIMIT)
}

type CursorPayload = {
  version: 1
  direction: FollowListDirection
  createdAt: string
  relationshipId: string
}

const encodeCursor = (payload: CursorPayload): string => {
  const raw = JSON.stringify(payload)
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

const decodeCursor = (value: string | null, direction: FollowListDirection): CursorPayload | null => {
  if (!value) return null
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_CURSOR_LENGTH) {
    throw new FollowRuntimeError('INVALID_CURSOR', 400)
  }
  try {
    const padded = normalized.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - normalized.length % 4) % 4)
    const parsed = JSON.parse(atob(padded)) as Partial<CursorPayload>
    if (
      parsed.version !== 1 ||
      parsed.direction !== direction ||
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.relationshipId !== 'string' ||
      !parsed.createdAt ||
      !parsed.relationshipId
    ) {
      throw new Error('invalid cursor')
    }
    return {
      version: 1,
      direction,
      createdAt: parsed.createdAt,
      relationshipId: parsed.relationshipId,
    }
  } catch {
    throw new FollowRuntimeError('INVALID_CURSOR', 400)
  }
}

async function listFollowRelations(
  db: D1Database,
  userIdValue: string,
  direction: FollowListDirection,
  cursorValue: string | null,
  limit: number,
): Promise<FollowListPage> {
  const ownerId = userId(userIdValue)
  const cursor = decodeCursor(cursorValue, direction)
  const isFollowers = direction === 'followers'
  const relationColumn = isFollowers ? 'target_user_id' : 'follower_user_id'
  const itemColumn = isFollowers ? 'follower_user_id' : 'target_user_id'
  const blockPredicate = `NOT EXISTS (
      SELECT 1
      FROM social_user_interactions block
      WHERE block.relation_type = 'block'
        AND (
          (block.actor_user_id = ? AND block.target_user_id = ${itemColumn})
          OR
          (block.actor_user_id = ${itemColumn} AND block.target_user_id = ?)
        )
    )`
  const where = cursor
    ? `WHERE ${relationColumn} = ?
       AND (created_at < ? OR (created_at = ? AND relationship_id < ?))
       AND ${blockPredicate}`
    : `WHERE ${relationColumn} = ?
       AND ${blockPredicate}`
  const statement = `SELECT relationship_id, ${itemColumn} AS user_id, created_at AS followed_at
    FROM social_follow_relationships
    ${where}
    ORDER BY created_at DESC, relationship_id DESC
    LIMIT ?`
  const parameters = cursor
    ? [
        ownerId,
        cursor.createdAt,
        cursor.createdAt,
        cursor.relationshipId,
        ownerId,
        ownerId,
        limit + 1,
      ]
    : [ownerId, ownerId, ownerId, limit + 1]

  const [result, cachedTotalCount] = await Promise.all([
    db.prepare(statement).bind(...parameters).all<{
      relationship_id: string
      user_id: string
      followed_at: string
    }>(),
    readCachedFollowCount(direction, ownerId),
  ])
  const rows = result.results ?? []
  const hasMore = rows.length > limit
  const visibleRows = hasMore ? rows.slice(0, limit) : rows

  let totalCount = cachedTotalCount
  if (totalCount === null) {
    // COUNT is deliberately a separate aggregate query. Embedding COUNT(*) as a
    // correlated subquery in the page SELECT can re-scan the same relationship
    // index for every returned row, multiplying D1 rows-read on hot accounts.
    const countStatement = `SELECT COUNT(*) AS total_count
      FROM social_follow_relationships rel_count
      WHERE rel_count.${relationColumn} = ?
        AND ${blockPredicate.replaceAll(`${itemColumn}`, `rel_count.${itemColumn}`)}`
    const countResult = await db.prepare(countStatement)
      .bind(ownerId, ownerId, ownerId)
      .first<{ total_count: number }>()
    totalCount = Number(countResult?.total_count ?? 0)
    await writeCachedFollowCount(direction, ownerId, totalCount)
  }

  const last = visibleRows.at(-1)
  return {
    items: visibleRows.map(row => ({
      relationshipId: row.relationship_id,
      userId: row.user_id,
      followedAt: row.followed_at,
    })),
    totalCount,
    hasMore,
    nextCursor: hasMore && last
      ? encodeCursor({
          version: 1,
          direction,
          createdAt: last.followed_at,
          relationshipId: last.relationship_id,
        })
      : null,
  }
}

export async function follow(db: D1Database, followerUserId: string, targetUserId: string): Promise<FollowRow> {
  const follower = userId(followerUserId)
  const target = userId(targetUserId)
  if (follower === target) throw new FollowRuntimeError('SELF_FOLLOW_NOT_ALLOWED', 409)

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

  if (Number(state?.blocked ?? 0) === 1) {
    throw new FollowRuntimeError('RELATIONSHIP_BLOCKED', 409)
  }

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

  const relationshipId = crypto.randomUUID()
  const createdAt = new Date().toISOString()
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
    relationshipId,
    follower,
    target,
    createdAt,
    follower,
    target,
    target,
    follower,
  ).first<FollowRow>()

  if (!row) throw new FollowRuntimeError('RELATIONSHIP_BLOCKED', 409)
  await invalidateFollowListCountCache(follower, target)
  return row
}

export async function unfollow(db: D1Database, followerUserId: string, targetUserId: string): Promise<void> {
  const follower=userId(followerUserId), target=userId(targetUserId)
  if (follower===target) throw new FollowRuntimeError('SELF_FOLLOW_NOT_ALLOWED',409)
  await db.prepare('DELETE FROM social_follow_relationships WHERE follower_user_id = ? AND target_user_id = ?').bind(follower,target).run()
  await invalidateFollowListCountCache(follower, target)
}

export async function getFollowStatus(db: D1Database, followerUserId: string, targetUserId: string) {
  const follower = userId(followerUserId)
  const target = userId(targetUserId)
  const row = await db.prepare(
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
  ).bind(follower, target, target, follower, follower, target).first<{
    relationship_id: string
    created_at: string
    blocked: number
  }>()
  if (Number(row?.blocked ?? 0) === 1) {
    return { following: false, relationshipId: null, createdAt: null }
  }
  return {
    following: Boolean(row),
    relationshipId: row?.relationship_id ?? null,
    createdAt: row?.created_at ?? null,
  }
}

export async function listFollowers(
  db: D1Database,
  userIdValue: string,
  cursor: string | null,
  limit: number,
): Promise<FollowListPage> {
  return listFollowRelations(db, userIdValue, 'followers', cursor, limit)
}

export async function listFollowing(
  db: D1Database,
  userIdValue: string,
  cursor: string | null,
  limit: number,
): Promise<FollowListPage> {
  return listFollowRelations(db, userIdValue, 'following', cursor, limit)
}
