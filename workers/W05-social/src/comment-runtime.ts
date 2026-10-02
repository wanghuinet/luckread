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
  createdAt: string
  id: string
}

const encodeCursor = (cursor: Cursor): string =>
  btoa(JSON.stringify(cursor))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')

const decodeCursor = (value: string | null): Cursor | null => {
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
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.id !== 'string' ||
      !parsed.createdAt ||
      !parsed.id
    ) {
      throw new Error('invalid cursor')
    }
    return { version: 1, createdAt: parsed.createdAt, id: parsed.id }
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
    `SELECT
       (SELECT state FROM contents WHERE id = ? LIMIT 1) AS content_state,
       (SELECT content_id FROM social_comments WHERE id = ? LIMIT 1) AS parent_content_id,
       (SELECT state FROM social_comments WHERE id = ? LIMIT 1) AS parent_state,
       (SELECT depth FROM social_comments WHERE id = ? LIMIT 1) AS parent_depth`,
  ).bind(contentId, parentId, parentId, parentId).first<{
    content_state: string | null
    parent_content_id: string | null
    parent_state: string | null
    parent_depth: number | null
  }>()

  if (!validation || validation.content_state !== 'PUBLISHED') {
    throw new CommentRuntimeError('NOT_FOUND', 404)
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
     VALUES (?, ?, ?, ?, ?, 'PUBLISHED', ?, ?, ?, ?)
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

  if (!inserted) throw new CommentRuntimeError('COMMENT_WRITE_FAILED', 500)
  return toCommentItem(inserted)

  const depth = parentId ? Number(validation.parent_depth) + 1 : 0
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  const inserted = await db.prepare(
    `INSERT INTO social_comments
      (id, content_id, author_user_id, parent_id, body, state, depth, idempotency_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'PUBLISHED', ?, ?, ?, ?)
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

  if (!inserted) throw new CommentRuntimeError('COMMENT_WRITE_FAILED', 500)
  return toCommentItem(inserted)
}

export async function listComments(
  db: D1Database,
  contentIdValue: string,
  cursorValue: string | null,
  limit: number,
): Promise<CommentPage> {
  const contentId = validateId(contentIdValue)
  const cursor = decodeCursor(cursorValue)

  const whereCursor = cursor
    ? 'AND (c.created_at > ? OR (c.created_at = ? AND c.id > ?))'
    : ''

  const params = cursor
    ? [contentId, contentId, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1]
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
        ? encodeCursor({ version: 1, createdAt: last.created_at, id: last.id })
        : null,
  }
}
