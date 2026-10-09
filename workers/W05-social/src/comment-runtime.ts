/// <reference types="@cloudflare/workers-types" />

export class CommentRuntimeError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code) }
}

export type CommentCreateInput = {
  body: string
  parentId?: string | null
  idempotencyKey: string
}

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

type Cursor = {
  version: 1
  contentId: string
  viewerUserId: string | null
  createdAt: string
  id: string
}

const encodeCursor = (cursor: Cursor): string =>
  btoa(JSON.stringify(cursor))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')

const decodeCursor = (value: string | null, contentId: string, viewerUserId: string | null): Cursor | null => {
  if (!value) return null
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_CURSOR) {
    throw new CommentRuntimeError('INVALID_CURSOR', 400)
  }
  try {
    const padded =
      normalized.replace(/-/g, '+').replace(/_/g, '/') +
      '='.repeat((4 - normalized.length % 4) % 4)
    const parsed = JSON.parse(atob(padded)) as Partial<Cursor>
    if (
      parsed.version !== 1 ||
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
    return { version: 1, contentId, viewerUserId, createdAt: parsed.createdAt, id: parsed.id }
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
})

export async function createComment(
  db: D1Database,
  actorUserId: string,
  contentIdValue: string,
  input: CommentCreateInput,
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
       ) AS blocked
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

  if (!inserted) throw new CommentRuntimeError('INTERNAL_ERROR', 500)
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
  actorUserIdValue: string,
  commentIdValue: string,
): Promise<string> {
  const actorUserId = validateId(actorUserIdValue, 'UNAUTHENTICATED')
  const commentId = validateId(commentIdValue)

  const row = await db.prepare(
    `SELECT
       c.id,
       c.content_id,
       c.author_user_id,
       c.state,
       content.state AS content_state,
       EXISTS (
         SELECT 1
         FROM social_comments child
         WHERE child.parent_id = c.id
       ) AS has_replies
     FROM social_comments c
     LEFT JOIN contents content ON content.id = c.content_id
     WHERE c.id = ?
     LIMIT 1`,
  ).bind(commentId).first<{
    id: string
    content_id: string
    author_user_id: string
    state: 'PENDING' | 'PUBLISHED' | 'REJECTED' | 'AUTHOR_DELETED'
    content_state: string | null
    has_replies: number
  }>()

  if (!row) throw new CommentRuntimeError('NOT_FOUND', 404)
  if (row.author_user_id !== actorUserId) {
    throw new CommentRuntimeError('PERMISSION_DENIED', 403)
  }
  if (row.state === 'AUTHOR_DELETED') return row.content_id
  if (row.content_state !== 'PUBLISHED') {
    throw new CommentRuntimeError('NOT_FOUND', 404)
  }
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
  actorUserIdValue: string,
  commentIdValue: string,
  input: CommentUpdateInput,
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
       c.updated_at,
       content.state AS content_state
     FROM social_comments c
     JOIN contents content ON content.id = c.content_id
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
    content_state: string
  }>()

  if (!current || current.content_state !== 'PUBLISHED') {
    throw new CommentRuntimeError('NOT_FOUND', 404)
  }
  if (current.author_user_id !== actorUserId) {
    throw new CommentRuntimeError('PERMISSION_DENIED', 403)
  }
  if (current.state !== 'PUBLISHED') {
    throw new CommentRuntimeError('INVALID_STATE', 409)
  }

  if (current.updated_at !== expectedUpdatedAt) {
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
  viewerUserIdValue: string | null = null,
): Promise<CommentPage> {
  const contentId = validateId(contentIdValue)
  const viewerUserId = viewerUserIdValue ? validateId(viewerUserIdValue, 'UNAUTHENTICATED') : null
  const cursor = decodeCursor(cursorValue, contentId, viewerUserId)

  const whereCursor = cursor
    ? 'AND (c.created_at > ? OR (c.created_at = ? AND c.id > ?))'
    : ''

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
  const params = cursor
    ? viewerUserId
      ? [contentId, viewerUserId, viewerUserId, viewerUserId, viewerUserId, viewerUserId, viewerUserId, contentId, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1]
      : [contentId, contentId, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1]
    : viewerUserId
      ? [contentId, viewerUserId, viewerUserId, viewerUserId, viewerUserId, viewerUserId, viewerUserId, contentId, limit + 1]
      : [contentId, contentId, limit + 1]

  const result = await db.prepare(
    `WITH RECURSIVE public_comments AS (
       SELECT
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
       JOIN contents content ON content.id = c.content_id
       WHERE c.content_id = ?
         AND content.state = 'PUBLISHED'
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
         child.updated_at
       FROM social_comments child
       JOIN public_comments parent ON parent.id = child.parent_id
       WHERE child.state = 'PUBLISHED'
         AND parent.depth < 3
         ${childVisibilitySql}
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
       c.updated_at
     FROM public_comments c
     WHERE c.content_id = ?
       ${whereCursor}
     ORDER BY c.created_at ASC, c.id ASC
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
  }>()

  const rows = result.results ?? []
  const hasMore = rows.length > limit
  const visible = hasMore ? rows.slice(0, limit) : rows
  const last = visible.at(-1)

  return {
    items: visible.map(toCommentItem),
    hasMore,
    nextCursor:
      hasMore && last
        ? encodeCursor({ version: 1, contentId, viewerUserId, createdAt: last.created_at, id: last.id })
        : null,
  }
}
