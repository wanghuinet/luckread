/// <reference types="@cloudflare/workers-types" />

import { LikeRuntimeError } from './like-runtime.js'

const MAX_ID = 128
const MAX_CURSOR = 2048

type LikesCursor = {
  version: 1
  contentId: string
  viewerUserId: string | null
  createdAt: string
  relationshipId: string
}

export type ContentLikerItem = {
  userId: string
  likedAt: string
}

export type ContentLikerPage = {
  items: ContentLikerItem[]
  nextCursor: string | null
  hasMore: boolean
}

const validateId = (value: string): string => {
  const normalized = value.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(normalized) || normalized.length > MAX_ID) {
    throw new LikeRuntimeError('VALIDATION_FAILED', 400)
  }
  return normalized
}

const encodeCursor = (cursor: LikesCursor): string => btoa(JSON.stringify(cursor))
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/g, '')

const decodeCursor = (
  value: string | null,
  contentId: string,
  viewerUserId: string | null,
): LikesCursor | null => {
  if (value === null) return null
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_CURSOR || !/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new LikeRuntimeError('INVALID_CURSOR', 400)
  }
  try {
    const padded = normalized.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - normalized.length % 4) % 4)
    const parsed = JSON.parse(atob(padded)) as Partial<LikesCursor>
    if (
      parsed.version !== 1 ||
      parsed.contentId !== contentId ||
      parsed.viewerUserId !== viewerUserId ||
      typeof parsed.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(parsed.createdAt)) ||
      typeof parsed.relationshipId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(parsed.relationshipId)
    ) throw new Error('invalid cursor')
    return {
      version: 1,
      contentId,
      viewerUserId,
      createdAt: parsed.createdAt,
      relationshipId: parsed.relationshipId,
    }
  } catch {
    throw new LikeRuntimeError('INVALID_CURSOR', 400)
  }
}

/**
 * Returns the bounded, authoritative list of users who liked a published post.
 * W05/D1-02 remains the sole source of the like relationship; no projection table
 * or per-user copied counter is introduced.
 */
export async function listContentLikers(
  db: D1Database,
  contentIdValue: string,
  cursorValue: string | null,
  limit: number,
  viewerUserIdValue: string | null = null,
): Promise<ContentLikerPage> {
  const contentId = validateId(contentIdValue)
  const viewerUserId = viewerUserIdValue ? validateId(viewerUserIdValue) : null
  const cursor = decodeCursor(cursorValue, contentId, viewerUserId)
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new LikeRuntimeError('VALIDATION_FAILED', 400)
  }

  const params: unknown[] = [contentId]
  let visibility = `
    AND NOT EXISTS (
      SELECT 1
        FROM social_user_interactions content_block
       WHERE content_block.relation_type = 'block'
         AND (
           (content_block.actor_user_id = il.actor_user_id AND content_block.target_user_id = content.owner_user_id)
           OR (content_block.actor_user_id = content.owner_user_id AND content_block.target_user_id = il.actor_user_id)
         )
    )`

  if (viewerUserId) {
    visibility += `
    AND NOT EXISTS (
      SELECT 1
        FROM social_user_interactions viewer_block
       WHERE viewer_block.relation_type = 'block'
         AND (
           (viewer_block.actor_user_id = ? AND viewer_block.target_user_id = content.owner_user_id)
           OR (viewer_block.actor_user_id = content.owner_user_id AND viewer_block.target_user_id = ?)
         )
    )
    AND NOT EXISTS (
      SELECT 1
        FROM social_user_interactions liker_block
       WHERE liker_block.relation_type = 'block'
         AND (
           (liker_block.actor_user_id = ? AND liker_block.target_user_id = il.actor_user_id)
           OR (liker_block.actor_user_id = il.actor_user_id AND liker_block.target_user_id = ?)
         )
    )`
    params.push(viewerUserId, viewerUserId, viewerUserId, viewerUserId)
  }

  const cursorSql = cursor
    ? ' AND (il.created_at < ? OR (il.created_at = ? AND il.relationship_id < ?))'
    : ''
  if (cursor) params.push(cursor.createdAt, cursor.createdAt, cursor.relationshipId)
  params.push(limit + 1)

  const result = await db.prepare(`
    SELECT il.relationship_id, il.actor_user_id, il.created_at
      FROM interaction_likes il
      JOIN contents content ON content.id = il.target_id
     WHERE il.target_type = 'content'
       AND il.target_id = ?
       AND content.state = 'PUBLISHED'
       ${visibility}
       ${cursorSql}
     ORDER BY il.created_at DESC, il.relationship_id DESC
     LIMIT ?
  `).bind(...params).all<{
    relationship_id: string
    actor_user_id: string
    created_at: string
  }>()

  const rows = result.results ?? []
  const hasMore = rows.length > limit
  const visible = hasMore ? rows.slice(0, limit) : rows
  const last = visible.at(-1)
  return {
    items: visible.map((row) => ({ userId: row.actor_user_id, likedAt: row.created_at })),
    hasMore,
    nextCursor: hasMore && last ? encodeCursor({
      version: 1,
      contentId,
      viewerUserId,
      createdAt: last.created_at,
      relationshipId: last.relationship_id,
    }) : null,
  }
}
