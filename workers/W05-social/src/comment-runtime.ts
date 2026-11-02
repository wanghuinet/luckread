/// <reference types="@cloudflare/workers-types" />
import { fetchPublishedContentSocialContext, type PublishedContentSocialContext, type W03ContentBinding } from './w03-content-context-client.js'

import { replyAudienceAllowedParams, replyAudienceAllowedSql } from './reply-audience-runtime.js'

export class CommentRuntimeError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code) }
}

export type CommentCreateInput = {
  body: string
  parentId?: string | null
  idempotencyKey: string
}

export type CommentMention = { userId: string; handle: string }

export type CommentItem = {
  id: string
  contentId: string
  authorUserId: string
  parentId: string | null
  body: string
  state: 'PENDING' | 'PUBLISHED' | 'REJECTED'
  depth: number
  createdAt: string
  updatedAt: string
  mentions: CommentMention[]
  likedByViewer?: boolean
}

export type CommentPage = {
  items: CommentItem[]
  nextCursor: string | null
  hasMore: boolean
}

const MAX_ID = 128
const MAX_BODY = 10000
const MAX_CURSOR = 2048
const MAX_DEPTH = 3
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

const validateId = (
  value: string,
  code: 'VALIDATION_FAILED' | 'UNAUTHENTICATED' = 'VALIDATION_FAILED',
) => {
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_ID) {
    throw new CommentRuntimeError(code, code === 'UNAUTHENTICATED' ? 401 : 400)
  }
  return normalized
}

export const parseCommentLimit = (value: string | null): number => {
  if (value === null || value.trim() === '') return DEFAULT_LIMIT
  const normalized = value.trim()
  if (!/^(?:[1-9]|[1-4][0-9]|50)$/.test(normalized)) {
    throw new CommentRuntimeError('VALIDATION_FAILED', 400)
  }
  return Math.min(Number(normalized), MAX_LIMIT)
}

export type CommentSort = 'relevant' | 'recent' | 'liked'

export const parseCommentSort = (value: string | null): CommentSort => {
  const normalized = value?.trim() || 'relevant'
  if (normalized === 'relevant' || normalized === 'recent' || normalized === 'liked') {
    return normalized
  }
  throw new CommentRuntimeError('VALIDATION_FAILED', 400)
}

type Cursor = {
  contentId: string
  viewerUserId: string | null
  sort: CommentSort
  createdAt: string
  id: string
  threadCreatedAt?: string
  threadId?: string
  threadLikeCount?: number
}

const encodeCursor = (cursor: Cursor): string => {
  const value = cursor.sort === 'relevant'
    ? {
        version: 1,
        contentId: cursor.contentId,
        viewerUserId: cursor.viewerUserId,
        createdAt: cursor.createdAt,
        id: cursor.id,
      }
    : {
        version: 2,
        contentId: cursor.contentId,
        viewerUserId: cursor.viewerUserId,
        sort: cursor.sort,
        threadCreatedAt: cursor.threadCreatedAt,
        threadId: cursor.threadId,
        createdAt: cursor.createdAt,
        id: cursor.id,
        ...(cursor.sort === 'liked' ? { threadLikeCount: cursor.threadLikeCount } : {}),
      }
  return btoa(JSON.stringify(value))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

const decodeCursor = (
  value: string | null,
  contentId: string,
  viewerUserId: string | null,
  sort: CommentSort,
): Cursor | null => {
  if (!value) return null
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_CURSOR) {
    throw new CommentRuntimeError('INVALID_CURSOR', 400)
  }
  try {
    const padded =
      normalized.replace(/-/g, '+').replace(/_/g, '/') +
      '='.repeat((4 - normalized.length % 4) % 4)
    const parsed = JSON.parse(atob(padded)) as {
      version?: unknown
      contentId?: unknown
      viewerUserId?: unknown
      sort?: unknown
      createdAt?: unknown
      id?: unknown
      threadCreatedAt?: unknown
      threadId?: unknown
      threadLikeCount?: unknown
    }
    const legacyRelevantCursor = parsed.version === 1 && sort === 'relevant' && parsed.sort === undefined
    const currentSortCursor = parsed.version === 2 && parsed.sort === sort && sort !== 'relevant'
    if (
      (!legacyRelevantCursor && !currentSortCursor) ||
      parsed.contentId !== contentId ||
      parsed.viewerUserId !== viewerUserId ||
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.id !== 'string' ||
      !parsed.createdAt ||
      !parsed.id
    ) {
      throw new Error('invalid cursor')
    }
    if (!Number.isFinite(Date.parse(parsed.createdAt)) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(parsed.id)) {
      throw new Error('invalid cursor')
    }
    if (currentSortCursor && (
      typeof parsed.threadCreatedAt !== 'string' ||
      !Number.isFinite(Date.parse(parsed.threadCreatedAt)) ||
      typeof parsed.threadId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(parsed.threadId)
    )) {
      throw new Error('invalid cursor')
    }
    if (sort === 'liked' && (
      typeof parsed.threadLikeCount !== 'number' ||
      !Number.isSafeInteger(parsed.threadLikeCount) ||
      parsed.threadLikeCount < 0
    )) {
      throw new Error('invalid cursor')
    }
    return {
      contentId,
      viewerUserId,
      sort,
      createdAt: parsed.createdAt,
      id: parsed.id,
      ...(currentSortCursor ? {
        threadCreatedAt: parsed.threadCreatedAt as string,
        threadId: parsed.threadId as string,
      } : {}),
      ...(sort === 'liked' ? { threadLikeCount: parsed.threadLikeCount as number } : {}),
    }
  } catch {
    throw new CommentRuntimeError('INVALID_CURSOR', 400)
  }
}

const validateCreateInput = (input: CommentCreateInput) => {
  const body = input.body.trim()
  const idempotencyKey = input.idempotencyKey.trim()
  if (
    !body ||
    body.length > MAX_BODY ||
    !idempotencyKey ||
    idempotencyKey.length > 256
  ) {
    throw new CommentRuntimeError('VALIDATION_FAILED', 400)
  }

  const parentId = input.parentId ? validateId(input.parentId) : null
  return { body, idempotencyKey, parentId }
}

const toCommentItem = (row: {
  id: string
  content_id: string
  author_user_id: string
  parent_id: string | null
  body: string
  state: 'PENDING' | 'PUBLISHED' | 'REJECTED'
  depth: number
  created_at: string
  updated_at: string
  mentions_json?: string | null
}): CommentItem => ({
  id: row.id,
  contentId: row.content_id,
  authorUserId: row.author_user_id,
  parentId: row.parent_id,
  body: row.body,
  state: row.state,
  depth: Number(row.depth),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  mentions: (() => {
    try {
      const value: unknown = JSON.parse(row.mentions_json || '[]')
      if (!Array.isArray(value)) return []
      return value.filter((item): item is CommentMention =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as { userId?: unknown }).userId === 'string' &&
        typeof (item as { handle?: unknown }).handle === 'string' &&
        (item as { userId: string }).userId.length > 0 &&
        (item as { handle: string }).handle.length > 0
      )
    } catch {
      return []
    }
  })(),
})

export async function createComment(
  db: D1Database,
  actorUserId: string,
  contentIdValue: string,
  input: CommentCreateInput,
  actorVerified = false,
): Promise<CommentItem> {
  const actor = validateId(actorUserId, 'UNAUTHENTICATED')
  const contentId = validateId(contentIdValue)
  const { body, idempotencyKey, parentId } = validateCreateInput(input)

  const validation = await db.prepare(
    `WITH existing_comment AS (
       SELECT id, content_id, parent_id, body, author_user_id, state, depth, created_at, updated_at
       FROM social_comments
       WHERE author_user_id = ? AND idempotency_key = ?
       LIMIT 1
     )
     SELECT
       ec.id AS existing_id,
       ec.content_id AS existing_content_id,
       ec.parent_id AS existing_parent_id,
       ec.body AS existing_body,
       ec.author_user_id AS existing_author_user_id,
       ec.state AS existing_state,
       ec.depth AS existing_depth,
       ec.created_at AS existing_created_at,
       ec.updated_at AS existing_updated_at,
       (SELECT state FROM contents WHERE id = ? LIMIT 1) AS content_state,
       (SELECT owner_user_id FROM contents WHERE id = ? LIMIT 1) AS content_owner_user_id,
       (SELECT content_id FROM social_comments WHERE id = ? LIMIT 1) AS parent_content_id,
       (SELECT author_user_id FROM social_comments WHERE id = ? LIMIT 1) AS parent_author_user_id,
       (SELECT state FROM social_comments WHERE id = ? LIMIT 1) AS parent_state,
       (SELECT depth FROM social_comments WHERE id = ? LIMIT 1) AS parent_depth,
       (SELECT COUNT(*) FROM social_comments WHERE author_user_id = ? AND created_at > datetime('now', '-60 seconds')) AS recent_count,
       EXISTS (
         SELECT 1
         FROM social_user_interactions block
         WHERE block.relation_type = 'block'
           AND (
             (block.actor_user_id = ? AND block.target_user_id = (SELECT owner_user_id FROM contents WHERE id = ? LIMIT 1))
             OR
             (block.actor_user_id = (SELECT owner_user_id FROM contents WHERE id = ? LIMIT 1) AND block.target_user_id = ?)
             OR
             (block.actor_user_id = ? AND block.target_user_id = (SELECT author_user_id FROM social_comments WHERE id = ? LIMIT 1))
             OR
             (block.actor_user_id = (SELECT author_user_id FROM social_comments WHERE id = ? LIMIT 1) AND block.target_user_id = ?)
           )
       ) AS blocked,
       (
         SELECT CASE WHEN ${replyAudienceAllowedSql} THEN 1 ELSE 0 END
           FROM contents content
          WHERE content.id = ?
       ) AS reply_audience_allowed
     FROM (SELECT 1) seed
     LEFT JOIN existing_comment ec ON 1 = 1`,
  ).bind(
    actor,
    idempotencyKey,
    contentId,
    contentId,
    parentId,
    parentId,
    parentId,
    parentId,
    actor,
    actor,
    contentId,
    contentId,
    actor,
    actor,
    parentId,
    parentId,
    actor,
    ...replyAudienceAllowedParams(actor, actorVerified),
    contentId,
  ).first<{
    existing_id: string | null
    existing_content_id: string | null
    existing_parent_id: string | null
    existing_body: string | null
    existing_author_user_id: string | null
    existing_state: 'PENDING' | 'PUBLISHED' | 'REJECTED' | 'AUTHOR_DELETED' | null
    existing_depth: number | null
    existing_created_at: string | null
    existing_updated_at: string | null
    content_state: string | null
    content_owner_user_id: string | null
    parent_content_id: string | null
    parent_author_user_id: string | null
    parent_state: string | null
    parent_depth: number | null
    recent_count: number
    blocked: number
    reply_audience_allowed: number
  }>();

  if (validation?.existing_id) {
    if (
      validation.existing_content_id !== contentId ||
      validation.existing_parent_id !== parentId ||
      validation.existing_body !== body
    ) {
      throw new CommentRuntimeError('CONFLICT', 409)
    }
    return {
      id: validation.existing_id,
      contentId: validation.existing_content_id ?? contentId,
      authorUserId: validation.existing_author_user_id ?? actor,
      parentId: validation.existing_parent_id,
      body: validation.existing_body ?? body,
      state: validation.existing_state === 'AUTHOR_DELETED' ? 'PUBLISHED' : validation.existing_state ?? 'PUBLISHED',
      depth: Number(validation.existing_depth ?? 0),
      createdAt: validation.existing_created_at ?? '',
      updatedAt: validation.existing_updated_at ?? validation.existing_created_at ?? '',
    }
  }

  if (!validation || validation.content_state !== 'PUBLISHED') {
    throw new CommentRuntimeError('NOT_FOUND', 404)
  }

  if (Number(validation.blocked) === 1) {
    throw new CommentRuntimeError('CONFLICT', 409)
  }

  if (Number(validation.reply_audience_allowed ?? 1) !== 1) {
    throw new CommentRuntimeError('PERMISSION_DENIED', 403)
  }

  if (Number(validation.recent_count) >= 10) {
    throw new CommentRuntimeError('RATE_LIMITED', 429)
  }

  if (parentId) {
    if (
      validation.parent_content_id !== contentId ||
      validation.parent_state !== 'PUBLISHED' ||
      validation.parent_depth === null ||
      Number(validation.parent_depth) >= MAX_DEPTH
    ) {
      throw new CommentRuntimeError('VALIDATION_FAILED', 400)
    }
  }

  const depth = parentId ? Number(validation.parent_depth) + 1 : 0
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  const inserted = await db.prepare(
    `INSERT INTO social_comments
      (id, content_id, author_user_id, parent_id, body, state, depth, idempotency_key, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, 'PUBLISHED', ?, ?, ?, ?
       FROM contents content
      WHERE content.id = ?
        AND content.state = 'PUBLISHED'
        AND (
          ? IS NULL
          OR EXISTS (
            SELECT 1
              FROM social_comments parent
             WHERE parent.id = ?
               AND parent.content_id = content.id
               AND parent.state = 'PUBLISHED'
               AND parent.depth < 3
          )
        )
        AND NOT EXISTS (
          SELECT 1
            FROM social_user_interactions block
           WHERE block.relation_type = 'block'
             AND (
               (block.actor_user_id = ? AND block.target_user_id = content.owner_user_id)
               OR
               (block.actor_user_id = content.owner_user_id AND block.target_user_id = ?)
               OR
               (block.actor_user_id = ? AND block.target_user_id = (
                 SELECT author_user_id FROM social_comments WHERE id = ? LIMIT 1
               ))
               OR
               (block.actor_user_id = (
                 SELECT author_user_id FROM social_comments WHERE id = ? LIMIT 1
               ) AND block.target_user_id = ?)
             )
        )
        AND ${replyAudienceAllowedSql}
     ON CONFLICT(author_user_id, idempotency_key)
     DO UPDATE SET id = social_comments.id
     RETURNING id, content_id, author_user_id, parent_id, body, state, depth, created_at, updated_at`,
  ).bind(
    id,
    contentId,
    actor,
    parentId,
    body,
    depth,
    idempotencyKey,
    now,
    now,
    contentId,
    parentId,
    parentId,
    actor,
    actor,
    actor,
    parentId,
    parentId,
    actor,
    ...replyAudienceAllowedParams(actor, actorVerified),
  ).first<{
    id: string
    content_id: string
    author_user_id: string
    parent_id: string | null
    body: string
    state: 'PENDING' | 'PUBLISHED' | 'REJECTED'
    depth: number
    created_at: string
    updated_at: string
  }>()

  if (!inserted) {
    // The final INSERT re-checks policy, follow graph, block relations, and
    // parent visibility. Distinguish a concurrent audience denial from other
    // stale preconditions without ever allowing the comment to bypass policy.
    const finalState = await db.prepare(
      `SELECT content.state AS content_state,
              CASE WHEN ${replyAudienceAllowedSql} THEN 1 ELSE 0 END AS reply_audience_allowed
         FROM contents content
        WHERE content.id = ? LIMIT 1`,
    ).bind(...replyAudienceAllowedParams(actor, actorVerified), contentId)
      .first<{ content_state: string; reply_audience_allowed: number }>()
    if (!finalState || finalState.content_state !== 'PUBLISHED') {
      throw new CommentRuntimeError('NOT_FOUND', 404)
    }
    if (Number(finalState.reply_audience_allowed) !== 1) {
      throw new CommentRuntimeError('PERMISSION_DENIED', 403)
    }
    throw new CommentRuntimeError('CONFLICT', 409)
  }
  return toCommentItem(inserted)

}

const MAX_IF_MATCH = 256

const parseIfMatch = (value: string): string => {
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_IF_MATCH) {
    throw new CommentRuntimeError('PRECONDITION_REQUIRED', 428)
  }
  if (!/^"[^"]{1,240}"$/.test(normalized)) {
    throw new CommentRuntimeError('PRECONDITION_REQUIRED', 428)
  }
  return normalized.slice(1, -1)
}

const commentEtag = (updatedAt: string): string => '"' + updatedAt + '"'

export type CommentUpdateInput = {
  body: string
  ifMatch: string
}

export async function deleteComment(
  db: D1Database,
  w03Content: W03ContentBinding | undefined,
  actorUserIdValue: string,
  commentIdValue: string,
  correlationId: string,
): Promise<string> {
  const actorUserId = validateId(actorUserIdValue, 'UNAUTHENTICATED')
  const commentId = validateId(commentIdValue)

  const row = await db.prepare(
    `SELECT
       c.id,
       c.content_id,
       c.author_user_id,
       c.state,
       EXISTS (
         SELECT 1
         FROM social_comments child
         WHERE child.parent_id = c.id
       ) AS has_replies
     FROM social_comments c
     WHERE c.id = ?
     LIMIT 1`,
  ).bind(commentId).first<{
    id: string
    content_id: string
    author_user_id: string
    state: 'PENDING' | 'PUBLISHED' | 'REJECTED' | 'AUTHOR_DELETED'
    has_replies: number
  }>()

  if (!row) throw new CommentRuntimeError('NOT_FOUND', 404)
  if (row.author_user_id !== actorUserId) {
    throw new CommentRuntimeError('PERMISSION_DENIED', 403)
  }
  if (row.state === 'AUTHOR_DELETED') return row.content_id
  await fetchPublishedContentSocialContext(w03Content, {
    contentId: row.content_id,
    correlationId,
  })
  if (row.state !== 'PUBLISHED') {
    throw new CommentRuntimeError('INVALID_STATE', 409)
  }
  if (Number(row.has_replies) === 1) {
    throw new CommentRuntimeError('CONFLICT', 409)
  }

  const now = new Date().toISOString()
  const result = await db.prepare(
    `UPDATE social_comments
        SET state = 'AUTHOR_DELETED', updated_at = ?
      WHERE id = ?
        AND author_user_id = ?
        AND state = 'PUBLISHED'
        AND NOT EXISTS (
          SELECT 1
            FROM social_comments child
           WHERE child.parent_id = social_comments.id
        )`,
  ).bind(now, commentId, actorUserId).run()

  if (Number(result.meta?.changes ?? 0) !== 1) {
    const afterConflict = await db.prepare(
      `SELECT state
         FROM social_comments
        WHERE id = ?
          AND author_user_id = ?
        LIMIT 1`,
    ).bind(commentId, actorUserId).first<{ state: 'PUBLISHED' | 'AUTHOR_DELETED' | 'PENDING' | 'REJECTED' }>()
    if (afterConflict?.state === 'AUTHOR_DELETED') return row.content_id
    throw new CommentRuntimeError('CONFLICT', 409)
  }
  return row.content_id
}

export async function updateComment(
  db: D1Database,
  w03Content: W03ContentBinding | undefined,
  actorUserIdValue: string,
  commentIdValue: string,
  input: CommentUpdateInput,
  correlationId: string,
): Promise<{ item: CommentItem; etag: string }> {
  const actorUserId = validateId(actorUserIdValue, 'UNAUTHENTICATED')
  const commentId = validateId(commentIdValue)
  const body = input.body.trim()
  const expectedUpdatedAt = parseIfMatch(input.ifMatch)

  if (!body || body.length > MAX_BODY) {
    throw new CommentRuntimeError('VALIDATION_FAILED', 400)
  }

  const current = await db.prepare(
    `SELECT
       c.id,
       c.content_id,
       c.author_user_id,
       c.parent_id,
       c.body,
       c.state,
       c.depth,
       c.created_at,
       c.updated_at
     FROM social_comments c
     WHERE c.id = ?
     LIMIT 1`,
  ).bind(commentId).first<{
    id: string
    content_id: string
    author_user_id: string
    parent_id: string | null
    body: string
    state: 'PENDING' | 'PUBLISHED' | 'REJECTED'
    depth: number
    created_at: string
    updated_at: string
  }>()

  if (!current) throw new CommentRuntimeError('NOT_FOUND', 404)
  await fetchPublishedContentSocialContext(w03Content, {
    contentId: current.content_id,
    correlationId,
  })
  if (current.author_user_id !== actorUserId) {
    throw new CommentRuntimeError('PERMISSION_DENIED', 403)
  }
  if (current.state !== 'PUBLISHED') {
    throw new CommentRuntimeError('INVALID_STATE', 409)
  }

  if (current.updated_at !== expectedUpdatedAt) {
    // If the previous PATCH committed but its response was lost, the same
    // body with the old If-Match is a safe replay. Return the canonical current
    // result instead of making the client treat its successful edit as a conflict.
    if (current.body === body) {
      return { item: toCommentItem(current), etag: commentEtag(current.updated_at) }
    }
    throw new CommentRuntimeError('PRECONDITION_FAILED', 412)
  }

  const now = new Date().toISOString()
  const updated = await db.prepare(
    `UPDATE social_comments
     SET body = ?, updated_at = ?
     WHERE id = ?
       AND author_user_id = ?
       AND state = 'PUBLISHED'
       AND updated_at = ?
     RETURNING id, content_id, author_user_id, parent_id, body, state, depth, created_at, updated_at`,
  ).bind(body, now, commentId, actorUserId, expectedUpdatedAt).first<{
    id: string
    content_id: string
    author_user_id: string
    parent_id: string | null
    body: string
    state: 'PENDING' | 'PUBLISHED' | 'REJECTED'
    depth: number
    created_at: string
    updated_at: string
  }>()

  if (!updated) throw new CommentRuntimeError('PRECONDITION_FAILED', 412)

  return { item: toCommentItem(updated), etag: commentEtag(updated.updated_at) }
}

export async function listComments(
  db: D1Database,
  contentIdValue: string,
  cursorValue: string | null,
  limit: number,
  contentContext: PublishedContentSocialContext,
  viewerUserIdValue: string | null = null,
  sortValue: CommentSort = 'relevant',
): Promise<CommentPage> {
  const contentId = validateId(contentIdValue)
  if (!contentContext || contentContext.contentId !== contentId || contentContext.state !== 'PUBLISHED') {
    throw new CommentRuntimeError('NOT_FOUND', 404)
  }
  const viewerUserId = viewerUserIdValue ? validateId(viewerUserIdValue, 'UNAUTHENTICATED') : null
  const sort = parseCommentSort(sortValue)
  const cursor = decodeCursor(cursorValue, contentId, viewerUserId, sort)

  // Keep every reply beneath its root comment. Recent/liked modes rank threads,
  // then preserve chronological order within each thread to avoid orphan-looking replies.
  const whereCursor = cursor
    ? sort === 'liked'
      ? 'AND (c.thread_like_count < ? OR (c.thread_like_count = ? AND (c.thread_created_at < ? OR (c.thread_created_at = ? AND c.thread_id < ?))) OR (c.thread_like_count = ? AND c.thread_created_at = ? AND c.thread_id = ? AND (c.created_at > ? OR (c.created_at = ? AND c.id > ?))))'
      : sort === 'recent'
        ? 'AND ((c.thread_created_at < ? OR (c.thread_created_at = ? AND c.thread_id < ?)) OR (c.thread_created_at = ? AND c.thread_id = ? AND (c.created_at > ? OR (c.created_at = ? AND c.id > ?))))'
        : 'AND (c.created_at > ? OR (c.created_at = ? AND c.id > ?))'
    : ''

  const orderBy = sort === 'liked'
    ? 'c.thread_like_count DESC, c.thread_created_at DESC, c.thread_id DESC, c.created_at ASC, c.id ASC'
    : sort === 'recent'
      ? 'c.thread_created_at DESC, c.thread_id DESC, c.created_at ASC, c.id ASC'
      : 'c.created_at ASC, c.id ASC'

  const visibilitySql = viewerUserId
    ? `AND NOT EXISTS (
         SELECT 1
           FROM social_user_interactions block
          WHERE block.relation_type = 'block'
            AND (
              (block.actor_user_id = ? AND block.target_user_id = c.author_user_id)
              OR
              (block.actor_user_id = c.author_user_id AND block.target_user_id = ?)
            )
       )
       AND NOT EXISTS (
         SELECT 1
           FROM social_user_interactions mute
          WHERE mute.relation_type = 'mute'
            AND mute.actor_user_id = ?
            AND mute.target_user_id = c.author_user_id
       )`
    : ''
  const childVisibilitySql = viewerUserId
    ? `AND NOT EXISTS (
         SELECT 1
           FROM social_user_interactions block
          WHERE block.relation_type = 'block'
            AND (
              (block.actor_user_id = ? AND block.target_user_id = child.author_user_id)
              OR
              (block.actor_user_id = child.author_user_id AND block.target_user_id = ?)
            )
       )
       AND NOT EXISTS (
         SELECT 1
           FROM social_user_interactions mute
          WHERE mute.relation_type = 'mute'
            AND mute.actor_user_id = ?
            AND mute.target_user_id = child.author_user_id
       )`
    : ''

  const visibilityParams = viewerUserId
    ? [viewerUserId, viewerUserId, viewerUserId, viewerUserId, viewerUserId, viewerUserId]
    : []
  const cursorParams = !cursor
    ? []
    : sort === 'liked'
      ? [
          cursor.threadLikeCount ?? 0, cursor.threadLikeCount ?? 0,
          cursor.threadCreatedAt ?? cursor.createdAt, cursor.threadCreatedAt ?? cursor.createdAt,
          cursor.threadId ?? cursor.id, cursor.threadLikeCount ?? 0,
          cursor.threadCreatedAt ?? cursor.createdAt, cursor.threadId ?? cursor.id,
          cursor.createdAt, cursor.createdAt, cursor.id,
        ]
      : sort === 'recent'
        ? [
            cursor.threadCreatedAt ?? cursor.createdAt, cursor.threadCreatedAt ?? cursor.createdAt,
            cursor.threadId ?? cursor.id, cursor.threadCreatedAt ?? cursor.createdAt,
            cursor.threadId ?? cursor.id, cursor.createdAt, cursor.createdAt, cursor.id,
          ]
        : [cursor.createdAt, cursor.createdAt, cursor.id]
  const params = [viewerUserId, contentId, ...visibilityParams, contentId, ...cursorParams, limit + 1]
  const threadLikeCountSql = sort === 'liked'
    ? `(SELECT COUNT(*) FROM interaction_likes thread_likes WHERE thread_likes.target_type = 'comment' AND thread_likes.target_id = c.thread_id) AS thread_like_count`
    : '0 AS thread_like_count'

  const result = await db.prepare(
    `WITH RECURSIVE viewer AS (SELECT ? AS user_id), public_comments AS (
       SELECT
         c.id,
         c.content_id,
         c.author_user_id,
         c.parent_id,
         c.body,
         c.state,
         c.depth,
         c.created_at,
         c.updated_at,
         c.created_at AS thread_created_at,
         c.id AS thread_id
       FROM social_comments c
       WHERE c.content_id = ?
         AND c.state = 'PUBLISHED'
         AND c.parent_id IS NULL
         ${visibilitySql}

       UNION ALL

       SELECT
         child.id,
         child.content_id,
         child.author_user_id,
         child.parent_id,
         child.body,
         child.state,
         child.depth,
         child.created_at,
         child.updated_at,
         parent.thread_created_at,
         parent.thread_id
       FROM social_comments child
       JOIN public_comments parent ON parent.id = child.parent_id
       WHERE child.state = 'PUBLISHED'
         AND parent.depth < 3
         ${childVisibilitySql}
     ), ranked_comments AS (
       SELECT
         c.*,
         ${threadLikeCountSql},
         EXISTS (
           SELECT 1
             FROM interaction_likes liked
             JOIN viewer v ON v.user_id = liked.actor_user_id
            WHERE liked.target_type = 'comment'
              AND liked.target_id = c.id
         ) AS liked_by_viewer
       FROM public_comments c
       WHERE c.content_id = ?
     )
     SELECT
       c.id,
       c.content_id,
       c.author_user_id,
       c.parent_id,
       c.body,
       c.state,
       c.depth,
       c.created_at,
       c.updated_at,
       COALESCE((
         SELECT json_group_array(json_object(
           'userId', mention.mentioned_user_id,
           'handle', mention.handle
         ))
         FROM social_mentions mention
         WHERE mention.target_type = 'comment'
           AND mention.target_id = c.id
       ), '[]') AS mentions_json,
       c.liked_by_viewer,
       c.thread_created_at,
       c.thread_id,
       c.thread_like_count
     FROM ranked_comments c
     WHERE 1 = 1
       ${whereCursor}
     ORDER BY ${orderBy}
     LIMIT ?`,
  ).bind(...params).all<{
    id: string
    content_id: string
    author_user_id: string
    parent_id: string | null
    body: string
    state: 'PENDING' | 'PUBLISHED' | 'REJECTED'
    depth: number
    created_at: string
    updated_at: string
    mentions_json: string
    liked_by_viewer: number
    thread_created_at: string
    thread_id: string
    thread_like_count: number
  }>()

  const rows = result.results ?? []
  const hasMore = rows.length > limit
  const visible = hasMore ? rows.slice(0, limit) : rows
  const last = visible.at(-1)

  return {
    items: visible.map((row) => ({
      ...toCommentItem(row),
      likedByViewer: Number(row.liked_by_viewer) === 1,
    })),
    hasMore,
    nextCursor:
      hasMore && last
        ? encodeCursor({
            contentId,
            viewerUserId,
            sort,
            createdAt: last.created_at,
            id: last.id,
            ...(sort !== 'relevant' ? {
              threadCreatedAt: last.thread_created_at,
              threadId: last.thread_id,
            } : {}),
            ...(sort === 'liked' ? { threadLikeCount: Number(last.thread_like_count) || 0 } : {}),
          })
        : null,
  }
}
