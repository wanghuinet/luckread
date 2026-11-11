/// <reference types="@cloudflare/workers-types" />
import { fetchPublishedContentSocialContext, type PublishedContentSocialContext, type W03ContentBinding } from './w03-content-context-client.js'

import { createD1CommentCreateStore, type CommentCreateStore } from './comment-create-store.js'
import { createD1CommentMutationStore, type CommentMutationStore } from './comment-mutation-store.js'
import {
  createD1CommentListReadStore,
  CommentListReadStoreError,
  type CommentListReadStore,
  type CommentListReadRow,
} from './comment-list-read-store.js'

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
  store: CommentCreateStore = createD1CommentCreateStore(db),
): Promise<CommentItem> {
  const actor = validateId(actorUserId, 'UNAUTHENTICATED')
  const contentId = validateId(contentIdValue)
  const { body, idempotencyKey, parentId } = validateCreateInput(input)

  let validation: Awaited<ReturnType<CommentCreateStore['validate']>>
  try {
    validation = await store.validate({
      actorUserId: actor,
      contentId,
      parentId,
      idempotencyKey,
      actorVerified,
    })
  } catch {
    throw new CommentRuntimeError('INTERNAL_ERROR', 500)
  }

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
      mentions: [],
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

  let inserted: Awaited<ReturnType<CommentCreateStore['insert']>>
  try {
    inserted = await store.insert({
      actorUserId: actor,
      contentId,
      parentId,
      idempotencyKey,
      actorVerified,
      id,
      body,
      depth,
      now,
    })
  } catch {
    throw new CommentRuntimeError('INTERNAL_ERROR', 500)
  }

  if (!inserted) {
    // The final INSERT re-checks policy, follow graph, block relations, and
    // parent visibility. Distinguish a concurrent audience denial from other
    // stale preconditions without ever allowing the comment to bypass policy.
    let finalState: Awaited<ReturnType<CommentCreateStore['getFinalState']>>
    try {
      finalState = await store.getFinalState({ actorUserId: actor, contentId, actorVerified })
    } catch {
      throw new CommentRuntimeError('INTERNAL_ERROR', 500)
    }
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
  store: CommentMutationStore = createD1CommentMutationStore(db),
): Promise<string> {
  const actorUserId = validateId(actorUserIdValue, 'UNAUTHENTICATED')
  const commentId = validateId(commentIdValue)

  let row: Awaited<ReturnType<CommentMutationStore['getForDelete']>>
  try {
    row = await store.getForDelete(commentId)
  } catch {
    throw new CommentRuntimeError('INTERNAL_ERROR', 500)
  }

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

  let deleted: boolean
  try {
    deleted = await store.markDeleted({
      commentId,
      actorUserId,
      now: new Date().toISOString(),
    })
  } catch {
    throw new CommentRuntimeError('INTERNAL_ERROR', 500)
  }

  if (!deleted) {
    let afterConflict: Awaited<ReturnType<CommentMutationStore['getDeleteState']>>
    try {
      afterConflict = await store.getDeleteState(commentId, actorUserId)
    } catch {
      throw new CommentRuntimeError('INTERNAL_ERROR', 500)
    }
    if (afterConflict === 'AUTHOR_DELETED') return row.content_id
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
  store: CommentMutationStore = createD1CommentMutationStore(db),
): Promise<{ item: CommentItem; etag: string }> {
  const actorUserId = validateId(actorUserIdValue, 'UNAUTHENTICATED')
  const commentId = validateId(commentIdValue)
  const body = input.body.trim()
  const expectedUpdatedAt = parseIfMatch(input.ifMatch)

  if (!body || body.length > MAX_BODY) {
    throw new CommentRuntimeError('VALIDATION_FAILED', 400)
  }

  let current: Awaited<ReturnType<CommentMutationStore['getForUpdate']>>
  try {
    current = await store.getForUpdate(commentId)
  } catch {
    throw new CommentRuntimeError('INTERNAL_ERROR', 500)
  }

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

  let updated: Awaited<ReturnType<CommentMutationStore['update']>>
  try {
    updated = await store.update({
      commentId,
      actorUserId,
      body,
      now: new Date().toISOString(),
      expectedUpdatedAt,
    })
  } catch {
    throw new CommentRuntimeError('INTERNAL_ERROR', 500)
  }

  if (!updated) throw new CommentRuntimeError('PRECONDITION_FAILED', 412)

  return { item: toCommentItem(updated), etag: commentEtag(updated.updated_at) }
}

export async function listComments(
  db: D1Database | CommentListReadStore,
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

  const store: CommentListReadStore = typeof (db as CommentListReadStore).list === 'function'
    ? db as CommentListReadStore
    : createD1CommentListReadStore(db as D1Database)
  let rows: CommentListReadRow[]
  try {
    rows = await store.list({
      contentId,
      viewerUserId,
      limit,
      sort,
      cursor: cursor ? {
        createdAt: cursor.createdAt,
        id: cursor.id,
        ...(cursor.threadCreatedAt !== undefined ? { threadCreatedAt: cursor.threadCreatedAt } : {}),
        ...(cursor.threadId !== undefined ? { threadId: cursor.threadId } : {}),
        ...(cursor.threadLikeCount !== undefined ? { threadLikeCount: cursor.threadLikeCount } : {}),
      } : null,
    })
  } catch (error) {
    if (error instanceof CommentListReadStoreError) {
      throw new CommentRuntimeError('INTERNAL_ERROR', 500)
    }
    throw error
  }

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
