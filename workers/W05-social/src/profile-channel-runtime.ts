/// <reference types="@cloudflare/workers-types" />

import { fetchPublishedContentSocialContexts, type W03ContentBinding } from './w03-content-context-client.js'

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
  w03Content: W03ContentBinding | undefined,
  profileUserIdValue: string,
  cursorValue: string | null,
  limit: number,
  viewerUserIdValue: string | null,
  correlationId: string,
): Promise<ProfileReplyPage> {
  const profileUserId = validateId(profileUserIdValue)
  const viewerUserId = viewerUserIdValue ? validateId(viewerUserIdValue) : null
  const cursor = decodeCursor(cursorValue, 'replies', profileUserId, viewerUserId)
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new ProfileChannelRuntimeError('VALIDATION_FAILED', 400)
  }
  if (!correlationId.trim()) throw new ProfileChannelRuntimeError('VALIDATION_FAILED', 400)

  if (viewerUserId) {
    const policy = await db.prepare(
      `SELECT
         EXISTS (
           SELECT 1 FROM social_user_interactions block
            WHERE block.relation_type = 'block'
              AND ((block.actor_user_id = ? AND block.target_user_id = ?)
                OR (block.actor_user_id = ? AND block.target_user_id = ?))
         ) AS blocked,
         EXISTS (
           SELECT 1 FROM social_user_interactions mute
            WHERE mute.relation_type = 'mute'
              AND mute.actor_user_id = ? AND mute.target_user_id = ?
         ) AS muted`,
    ).bind(viewerUserId, profileUserId, profileUserId, viewerUserId, viewerUserId, profileUserId)
      .first<{ blocked: number; muted: number }>()
    if (Number(policy?.blocked ?? 0) === 1 || Number(policy?.muted ?? 0) === 1) {
      return { items: [], nextCursor: null, hasMore: false }
    }
  }

  const params: unknown[] = [profileUserId]
  const cursorSql = cursor ? ' AND (c.created_at < ? OR (c.created_at = ? AND c.id < ?))' : ''
  if (cursor) params.push(cursor.createdAt, cursor.createdAt, cursor.tieBreaker)
  params.push(limit + 1)

  const result = await db.prepare(
    `SELECT c.id, c.content_id, c.author_user_id, c.parent_id, c.body, c.state, c.depth, c.created_at, c.updated_at
       FROM social_comments c
      WHERE c.author_user_id = ?
        AND c.state = 'PUBLISHED'
        ${cursorSql}
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT ?`,
  ).bind(...params).all<{
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

  const candidates = result.results ?? []
  const hasMore = candidates.length > limit
  const scanned = hasMore ? candidates.slice(0, limit) : candidates
  const contentIds = [...new Set(scanned.map(row => row.content_id))]
  const contexts = await fetchPublishedContentSocialContexts(w03Content, { contentIds, correlationId })
  const ownerIds = [...new Set(
    scanned
      .map(row => contexts.get(row.content_id)?.ownerUserId)
      .filter((ownerId): ownerId is string => typeof ownerId === 'string' && ownerId.length > 0),
  )]

  const blockedOwners = new Set<string>()
  if (ownerIds.length > 0) {
    const placeholders = ownerIds.map(() => '?').join(', ')
    const blockedRows = await db.prepare(
      `SELECT actor_user_id, target_user_id
         FROM social_user_interactions
        WHERE relation_type = 'block'
          AND (
            (actor_user_id = ? AND target_user_id IN (${placeholders}))
            OR (target_user_id = ? AND actor_user_id IN (${placeholders}))
          )`,
    ).bind(profileUserId, ...ownerIds, profileUserId, ...ownerIds)
      .all<{ actor_user_id: string; target_user_id: string }>()
    for (const row of blockedRows.results ?? []) {
      blockedOwners.add(row.actor_user_id === profileUserId ? row.target_user_id : row.actor_user_id)
    }
  }

  const visible = scanned.filter(row => {
    const context = contexts.get(row.content_id)
    if (!context || context.contentId !== row.content_id || context.state !== 'PUBLISHED') return false
    return context.ownerUserId === null || !blockedOwners.has(context.ownerUserId)
  })
  const lastScanned = scanned.at(-1)
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
    nextCursor: hasMore && lastScanned ? encodeCursor({
      version: 1,
      channel: 'replies',
      profileUserId,
      viewerUserId,
      createdAt: lastScanned.created_at,
      tieBreaker: lastScanned.id,
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
  w03Content: W03ContentBinding | undefined,
  profileUserIdValue: string,
  cursorValue: string | null,
  limit: number,
  viewerUserIdValue: string | null,
  correlationId: string,
): Promise<ProfileLikedContentPage> {
  const profileUserId = validateId(profileUserIdValue)
  const viewerUserId = viewerUserIdValue ? validateId(viewerUserIdValue) : null
  const cursor = decodeCursor(cursorValue, 'likes', profileUserId, viewerUserId)
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new ProfileChannelRuntimeError('VALIDATION_FAILED', 400)
  }
  if (!correlationId.trim()) throw new ProfileChannelRuntimeError('VALIDATION_FAILED', 400)

  const params: unknown[] = [profileUserId]
  let viewerVisibility = ''
  if (viewerUserId) {
    viewerVisibility = `
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
    params.push(viewerUserId, viewerUserId, viewerUserId)
  }

  const cursorSql = cursor ? ' AND (il.created_at < ? OR (il.created_at = ? AND il.relationship_id < ?))' : ''
  if (cursor) params.push(cursor.createdAt, cursor.createdAt, cursor.tieBreaker)
  params.push(limit + 1)

  // W05 first pages through its own like relationships only. Canonical
  // publication and owner context are validated in one bounded W03 call.
  const result = await db.prepare(`
    SELECT il.relationship_id, il.target_id, il.created_at
      FROM interaction_likes il
     WHERE il.actor_user_id = ?
       AND il.target_type = 'content'
       ${viewerVisibility}
       ${cursorSql}
     ORDER BY il.created_at DESC, il.relationship_id DESC
     LIMIT ?
  `).bind(...params).all<{
    relationship_id: string
    target_id: string
    created_at: string
  }>()

  const candidates = result.results ?? []
  const hasMore = candidates.length > limit
  const scanned = hasMore ? candidates.slice(0, limit) : candidates
  const contentIds = [...new Set(scanned.map(row => row.target_id))]
  const contexts = await fetchPublishedContentSocialContexts(w03Content, { contentIds, correlationId })
  const ownerIds = [...new Set(
    scanned
      .map(row => contexts.get(row.target_id)?.ownerUserId)
      .filter((ownerId): ownerId is string => typeof ownerId === 'string' && ownerId.length > 0),
  )]

  const blockedPrincipals = new Set([profileUserId, ...(viewerUserId ? [viewerUserId] : [])])
  const blockedOwners = new Set<string>()
  const mutedOwners = new Set<string>()
  if (ownerIds.length > 0) {
    const ownerPlaceholders = ownerIds.map(() => '?').join(', ')
    const principalPlaceholders = [...blockedPrincipals].map(() => '?').join(', ')
    const blockRows = await db.prepare(`
      SELECT actor_user_id, target_user_id
        FROM social_user_interactions
       WHERE relation_type = 'block'
         AND (
           (actor_user_id IN (${principalPlaceholders}) AND target_user_id IN (${ownerPlaceholders}))
           OR
           (target_user_id IN (${principalPlaceholders}) AND actor_user_id IN (${ownerPlaceholders}))
         )
    `).bind(
      ...blockedPrincipals, ...ownerIds,
      ...blockedPrincipals, ...ownerIds,
    ).all<{ actor_user_id: string; target_user_id: string }>()

    const ownerSet = new Set(ownerIds)
    for (const row of blockRows.results ?? []) {
      if (blockedPrincipals.has(row.actor_user_id) && ownerSet.has(row.target_user_id)) {
        blockedOwners.add(row.target_user_id)
      }
      if (blockedPrincipals.has(row.target_user_id) && ownerSet.has(row.actor_user_id)) {
        blockedOwners.add(row.actor_user_id)
      }
    }

    if (viewerUserId) {
      const muteRows = await db.prepare(`
        SELECT target_user_id
          FROM social_user_interactions
         WHERE relation_type = 'mute'
           AND actor_user_id = ?
           AND target_user_id IN (${ownerPlaceholders})
      `).bind(viewerUserId, ...ownerIds).all<{ target_user_id: string }>()
      for (const row of muteRows.results ?? []) mutedOwners.add(row.target_user_id)
    }
  }

  const visible = scanned.filter(row => {
    const context = contexts.get(row.target_id)
    if (!context || context.contentId !== row.target_id || context.state !== 'PUBLISHED') return false
    if (context.ownerUserId === null) return true
    return !blockedOwners.has(context.ownerUserId) && !mutedOwners.has(context.ownerUserId)
  })
  const lastScanned = scanned.at(-1)
  return {
    items: visible.map((row) => ({ contentId: row.target_id, likedAt: row.created_at })),
    hasMore,
    nextCursor: hasMore && lastScanned ? encodeCursor({
      version: 1,
      channel: 'likes',
      profileUserId,
      viewerUserId,
      createdAt: lastScanned.created_at,
      tieBreaker: lastScanned.relationship_id,
    }) : null,
  }
}
