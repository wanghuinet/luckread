/// <reference types="@cloudflare/workers-types" />

export class ProfileChannelRuntimeError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code) }
}

type Cursor = {
  version: 1
  channel: 'replies' | 'likes'
  profileUserId: string
  viewerUserId: string | null
  createdAt: string
  tieBreaker: string
}

const MAX_ID = 128
const MAX_CURSOR = 2048
const validateId = (value: string): string => {
  const normalized = value.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(normalized) || normalized.length > MAX_ID) {
    throw new ProfileChannelRuntimeError('VALIDATION_FAILED', 400)
  }
  return normalized
}

const encodeCursor = (cursor: Cursor): string => btoa(JSON.stringify(cursor))
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/g, '')

const decodeCursor = (
  value: string | null,
  channel: Cursor['channel'],
  profileUserId: string,
  viewerUserId: string | null,
): Cursor | null => {
  if (!value) return null
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_CURSOR || !/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new ProfileChannelRuntimeError('INVALID_CURSOR', 400)
  }
  try {
    const padded = normalized.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - normalized.length % 4) % 4)
    const parsed = JSON.parse(atob(padded)) as Partial<Cursor>
    if (
      parsed.version !== 1 ||
      parsed.channel !== channel ||
      parsed.profileUserId !== profileUserId ||
      parsed.viewerUserId !== viewerUserId ||
      typeof parsed.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(parsed.createdAt)) ||
      typeof parsed.tieBreaker !== 'string' ||
      !parsed.tieBreaker ||
      parsed.tieBreaker.length > MAX_ID
    ) throw new Error('invalid cursor')
    return {
      version: 1,
      channel,
      profileUserId,
      viewerUserId,
      createdAt: parsed.createdAt,
      tieBreaker: parsed.tieBreaker,
    }
  } catch {
    throw new ProfileChannelRuntimeError('INVALID_CURSOR', 400)
  }
}

export type ProfileReplyItem = {
  id: string
  contentId: string
  authorUserId: string
  parentId: string | null
  body: string
  state: 'PUBLISHED'
  depth: number
  createdAt: string
  updatedAt: string
}

export type ProfileReplyPage = {
  items: ProfileReplyItem[]
  nextCursor: string | null
  hasMore: boolean
}

export async function listProfileReplies(
  db: D1Database,
  profileUserIdValue: string,
  cursorValue: string | null,
  limit: number,
  viewerUserIdValue: string | null = null,
): Promise<ProfileReplyPage> {
  const profileUserId = validateId(profileUserIdValue)
  const viewerUserId = viewerUserIdValue ? validateId(viewerUserIdValue) : null
  const cursor = decodeCursor(cursorValue, 'replies', profileUserId, viewerUserId)
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new ProfileChannelRuntimeError('VALIDATION_FAILED', 400)
  }

  const params: unknown[] = [profileUserId]
  let visibility = `
    AND NOT EXISTS (
      SELECT 1 FROM social_user_interactions block
       WHERE block.relation_type = 'block'
         AND (
           (block.actor_user_id = c.author_user_id AND block.target_user_id = content.owner_user_id)
           OR (block.actor_user_id = content.owner_user_id AND block.target_user_id = c.author_user_id)
         )
    )`
  if (viewerUserId) {
    visibility += `
    AND NOT EXISTS (
      SELECT 1 FROM social_user_interactions block
       WHERE block.relation_type = 'block'
         AND ((block.actor_user_id = ? AND block.target_user_id = c.author_user_id)
           OR (block.actor_user_id = c.author_user_id AND block.target_user_id = ?))
    )
    AND NOT EXISTS (
      SELECT 1 FROM social_user_interactions mute
       WHERE mute.relation_type = 'mute'
         AND mute.actor_user_id = ? AND mute.target_user_id = c.author_user_id
    )`
    params.push(viewerUserId, viewerUserId, viewerUserId)
  }

  const cursorSql = cursor ? ' AND (c.created_at < ? OR (c.created_at = ? AND c.id < ?))' : ''
  if (cursor) params.push(cursor.createdAt, cursor.createdAt, cursor.tieBreaker)
  params.push(limit + 1)

  const result = await db.prepare(`
    SELECT c.id, c.content_id, c.author_user_id, c.parent_id, c.body, c.state, c.depth, c.created_at, c.updated_at
      FROM social_comments c
      JOIN contents content ON content.id = c.content_id
     WHERE c.author_user_id = ?
       AND c.state = 'PUBLISHED'
       AND content.state = 'PUBLISHED'
       ${visibility}
       ${cursorSql}
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT ?
  `).bind(...params).all<{
    id: string
    content_id: string
    author_user_id: string
    parent_id: string | null
    body: string
    state: 'PUBLISHED'
    depth: number
    created_at: string
    updated_at: string
  }>()

  const rows = result.results ?? []
  const hasMore = rows.length > limit
  const visible = hasMore ? rows.slice(0, limit) : rows
  const last = visible.at(-1)
  return {
    items: visible.map((row) => ({
      id: row.id,
      contentId: row.content_id,
      authorUserId: row.author_user_id,
      parentId: row.parent_id,
      body: row.body,
      state: 'PUBLISHED',
      depth: Number(row.depth),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    hasMore,
    nextCursor: hasMore && last ? encodeCursor({
      version: 1,
      channel: 'replies',
      profileUserId,
      viewerUserId,
      createdAt: last.created_at,
      tieBreaker: last.id,
    }) : null,
  }
}

export type ProfileLikedContentItem = {
  contentId: string
  likedAt: string
}

export type ProfileLikedContentPage = {
  items: ProfileLikedContentItem[]
  nextCursor: string | null
  hasMore: boolean
}

export async function listProfileLikedContents(
  db: D1Database,
  profileUserIdValue: string,
  cursorValue: string | null,
  limit: number,
  viewerUserIdValue: string | null = null,
): Promise<ProfileLikedContentPage> {
  const profileUserId = validateId(profileUserIdValue)
  const viewerUserId = viewerUserIdValue ? validateId(viewerUserIdValue) : null
  const cursor = decodeCursor(cursorValue, 'likes', profileUserId, viewerUserId)
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new ProfileChannelRuntimeError('VALIDATION_FAILED', 400)
  }

  const params: unknown[] = [profileUserId]
  let visibility = `
    AND NOT EXISTS (
      SELECT 1 FROM social_user_interactions block
       WHERE block.relation_type = 'block'
         AND (
           (block.actor_user_id = il.actor_user_id AND block.target_user_id = content.owner_user_id)
           OR (block.actor_user_id = content.owner_user_id AND block.target_user_id = il.actor_user_id)
         )
    )`
  if (viewerUserId) {
    visibility += `
    AND NOT EXISTS (
      SELECT 1 FROM social_user_interactions block
       WHERE block.relation_type = 'block'
         AND ((block.actor_user_id = ? AND block.target_user_id = content.owner_user_id)
           OR (block.actor_user_id = content.owner_user_id AND block.target_user_id = ?))
    )
    AND NOT EXISTS (
      SELECT 1 FROM social_user_interactions mute
       WHERE mute.relation_type = 'mute'
         AND mute.actor_user_id = ? AND mute.target_user_id = content.owner_user_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM social_user_interactions block_profile
       WHERE block_profile.relation_type = 'block'
         AND ((block_profile.actor_user_id = ? AND block_profile.target_user_id = il.actor_user_id)
           OR (block_profile.actor_user_id = il.actor_user_id AND block_profile.target_user_id = ?))
    )
    AND NOT EXISTS (
      SELECT 1 FROM social_user_interactions mute_profile
       WHERE mute_profile.relation_type = 'mute'
         AND mute_profile.actor_user_id = ? AND mute_profile.target_user_id = il.actor_user_id
    )`
    params.push(viewerUserId, viewerUserId, viewerUserId, viewerUserId, viewerUserId, viewerUserId)
  }

  const cursorSql = cursor ? ' AND (il.created_at < ? OR (il.created_at = ? AND il.relationship_id < ?))' : ''
  if (cursor) params.push(cursor.createdAt, cursor.createdAt, cursor.tieBreaker)
  params.push(limit + 1)

  const result = await db.prepare(`
    SELECT il.relationship_id, il.target_id, il.created_at
      FROM interaction_likes il
      JOIN contents content ON content.id = il.target_id
     WHERE il.actor_user_id = ?
       AND il.target_type = 'content'
       AND content.state = 'PUBLISHED'
       ${visibility}
       ${cursorSql}
     ORDER BY il.created_at DESC, il.relationship_id DESC
     LIMIT ?
  `).bind(...params).all<{
    relationship_id: string
    target_id: string
    created_at: string
  }>()

  const rows = result.results ?? []
  const hasMore = rows.length > limit
  const visible = hasMore ? rows.slice(0, limit) : rows
  const last = visible.at(-1)
  return {
    items: visible.map((row) => ({ contentId: row.target_id, likedAt: row.created_at })),
    hasMore,
    nextCursor: hasMore && last ? encodeCursor({
      version: 1,
      channel: 'likes',
      profileUserId,
      viewerUserId,
      createdAt: last.created_at,
      tieBreaker: last.relationship_id,
    }) : null,
  }
}
