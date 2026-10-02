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

async function assertFollowAllowed(db: D1Database, followerUserId: string, targetUserId: string): Promise<void> {
  const row = await db.prepare(
    `SELECT 1 AS blocked
       FROM social_user_interactions
      WHERE relation_type = 'block'
        AND (
          (actor_user_id = ? AND target_user_id = ?)
          OR
          (actor_user_id = ? AND target_user_id = ?)
        )
      LIMIT 1`,
  ).bind(followerUserId, targetUserId, targetUserId, followerUserId).first<{ blocked: number }>()

  if (row) throw new FollowRuntimeError('RELATIONSHIP_BLOCKED', 409)
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
  const countSql = `(SELECT COUNT(*) FROM social_follow_relationships WHERE ${relationColumn} = ?)`
  const where = cursor
    ? `WHERE ${relationColumn} = ?
       AND (created_at < ? OR (created_at = ? AND relationship_id < ?))`
    : `WHERE ${relationColumn} = ?`
  const statement = `SELECT relationship_id, ${itemColumn} AS user_id, created_at AS followed_at, ${countSql} AS total_count
    FROM social_follow_relationships
    ${where}
    ORDER BY created_at DESC, relationship_id DESC
    LIMIT ?`
  const parameters = cursor
    ? [ownerId, ownerId, cursor.createdAt, cursor.createdAt, cursor.relationshipId, limit + 1]
    : [ownerId, ownerId, limit + 1]
  const result = await db.prepare(statement).bind(...parameters).all<{
    relationship_id: string
    user_id: string
    followed_at: string
    total_count: number
  }>()
  const rows = result.results ?? []
  const hasMore = rows.length > limit
  const visibleRows = hasMore ? rows.slice(0, limit) : rows
  const totalCount = Number(visibleRows[0]?.total_count ?? 0)
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
  const follower=userId(followerUserId), target=userId(targetUserId)
  if (follower===target) throw new FollowRuntimeError('SELF_FOLLOW_NOT_ALLOWED',409)
  await assertFollowAllowed(db, follower, target)
  const existing=await db.prepare('SELECT relationship_id, follower_user_id, target_user_id, created_at FROM social_follow_relationships WHERE follower_user_id = ? AND target_user_id = ? LIMIT 1').bind(follower,target).first<FollowRow>()
  if (existing) return existing
  const relationshipId=crypto.randomUUID(), createdAt=new Date().toISOString()
  try { await db.prepare('INSERT INTO social_follow_relationships (relationship_id, follower_user_id, target_user_id, created_at) VALUES (?, ?, ?, ?)').bind(relationshipId,follower,target,createdAt).run() }
  catch (e) { if (!(e instanceof Error) || !e.message.toLowerCase().includes('unique')) throw e }
  const row=await db.prepare('SELECT relationship_id, follower_user_id, target_user_id, created_at FROM social_follow_relationships WHERE follower_user_id = ? AND target_user_id = ? LIMIT 1').bind(follower,target).first<FollowRow>()
  if (!row) throw new FollowRuntimeError('FOLLOW_WRITE_FAILED',500)
  return row
}

export async function unfollow(db: D1Database, followerUserId: string, targetUserId: string): Promise<void> {
  const follower=userId(followerUserId), target=userId(targetUserId)
  if (follower===target) throw new FollowRuntimeError('SELF_FOLLOW_NOT_ALLOWED',409)
  await db.prepare('DELETE FROM social_follow_relationships WHERE follower_user_id = ? AND target_user_id = ?').bind(follower,target).run()
}

export async function getFollowStatus(db: D1Database, followerUserId: string, targetUserId: string) {
  const follower=userId(followerUserId), target=userId(targetUserId)
  const row=await db.prepare('SELECT relationship_id, created_at FROM social_follow_relationships WHERE follower_user_id = ? AND target_user_id = ? LIMIT 1').bind(follower,target).first<{relationship_id:string;created_at:string}>()
  return { following:Boolean(row), relationshipId:row?.relationship_id ?? null, createdAt:row?.created_at ?? null }
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
