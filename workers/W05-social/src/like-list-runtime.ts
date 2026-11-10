/// <reference types="@cloudflare/workers-types" />

import { LikeRuntimeError } from './like-runtime.js'
import type { PublishedContentSocialContext } from './w03-content-context-client.js'
import {
  createD1ContentLikerReadStore,
  ContentLikerReadStoreError,
  type ContentLikerReadStore,
} from './like-list-read-store.js'

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
type ContentLikerDataSource = D1Database | ContentLikerReadStore

function resolveContentLikerReadStore(source: ContentLikerDataSource): ContentLikerReadStore {
  if (typeof (source as ContentLikerReadStore).list === 'function') {
    return source as ContentLikerReadStore
  }
  return createD1ContentLikerReadStore(source as D1Database)
}

export async function listContentLikers(
  source: ContentLikerDataSource,
  contentIdValue: string,
  cursorValue: string | null,
  limit: number,
  viewerUserIdValue: string | null,
  contentContext: PublishedContentSocialContext,
): Promise<ContentLikerPage> {
  const contentId = validateId(contentIdValue)
  const viewerUserId = viewerUserIdValue ? validateId(viewerUserIdValue) : null
  const cursor = decodeCursor(cursorValue, contentId, viewerUserId)
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new LikeRuntimeError('VALIDATION_FAILED', 400)
  }
  if (
    contentContext.contentId !== contentId ||
    contentContext.state !== 'PUBLISHED' ||
    !['article', 'post', 'video'].includes(contentContext.contentType)
  ) {
    throw new LikeRuntimeError('NOT_FOUND', 404)
  }

  let rows
  try {
    rows = await resolveContentLikerReadStore(source).list({
      contentId,
      contentOwnerUserId: contentContext.ownerUserId,
      viewerUserId,
      cursor: cursor
        ? { createdAt: cursor.createdAt, relationshipId: cursor.relationshipId }
        : null,
      limit: limit + 1,
    })
  } catch (error) {
    if (error instanceof ContentLikerReadStoreError) {
      throw new LikeRuntimeError(error.code, error.status)
    }
    throw error
  }
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
