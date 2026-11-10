/// <reference types="@cloudflare/workers-types" />

import { fetchPublishedContentSocialContexts, type W03ContentBinding } from './w03-content-context-client.js'
import {
  createD1ProfileChannelReadStore,
  ProfileChannelReadStoreError,
  type ProfileChannelReadStore,
} from './profile-channel-read-store.js'

export class ProfileChannelRuntimeError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code) }
}

type ProfileChannelDataSource = D1Database | ProfileChannelReadStore

function resolveProfileChannelReadStore(source: ProfileChannelDataSource): ProfileChannelReadStore {
  if (
    typeof (source as ProfileChannelReadStore).profileVisibility === 'function' &&
    typeof (source as ProfileChannelReadStore).listReplies === 'function' &&
    typeof (source as ProfileChannelReadStore).listLikedContents === 'function'
  ) return source as ProfileChannelReadStore
  return createD1ProfileChannelReadStore(source as D1Database)
}

function mapProfileChannelReadError(error: unknown): never {
  if (error instanceof ProfileChannelReadStoreError) {
    throw new ProfileChannelRuntimeError(error.code, error.status)
  }
  throw error
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
  source: ProfileChannelDataSource,
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
  const store = resolveProfileChannelReadStore(source)
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new ProfileChannelRuntimeError('VALIDATION_FAILED', 400)
  }
  if (!correlationId.trim()) throw new ProfileChannelRuntimeError('VALIDATION_FAILED', 400)

  if (viewerUserId) {
    const policy = await store.profileVisibility({ profileUserId, viewerUserId })
      .catch(mapProfileChannelReadError)
    if (policy.blocked || policy.muted) {
      return { items: [], nextCursor: null, hasMore: false }
    }
  }

  const candidates = await store.listReplies({
    profileUserId,
    cursor: cursor ? { createdAt: cursor.createdAt, tieBreaker: cursor.tieBreaker } : null,
    limit: limit + 1,
  }).catch(mapProfileChannelReadError)
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
  const blockedRows = await store.listReplyOwnerBlockRelations({ profileUserId, ownerUserIds: ownerIds })
    .catch(mapProfileChannelReadError)
  for (const row of blockedRows) {
    blockedOwners.add(row.actor_user_id === profileUserId ? row.target_user_id : row.actor_user_id)
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
  source: ProfileChannelDataSource,
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
  const store = resolveProfileChannelReadStore(source)
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new ProfileChannelRuntimeError('VALIDATION_FAILED', 400)
  }
  if (!correlationId.trim()) throw new ProfileChannelRuntimeError('VALIDATION_FAILED', 400)

  // W05 first pages through its own like relationships only. Canonical
  // publication and owner context are validated in one bounded W03 call.
  const candidates = await store.listLikedContents({
    profileUserId,
    viewerUserId,
    cursor: cursor ? { createdAt: cursor.createdAt, tieBreaker: cursor.tieBreaker } : null,
    limit: limit + 1,
  }).catch(mapProfileChannelReadError)
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
    const ownerSet = new Set(ownerIds)
    const blockRows = await store.listLikedContentBlockRelations({
      principalUserIds: [...blockedPrincipals],
      ownerUserIds: ownerIds,
    }).catch(mapProfileChannelReadError)
    for (const row of blockRows) {
      if (blockedPrincipals.has(row.actor_user_id) && ownerSet.has(row.target_user_id)) {
        blockedOwners.add(row.target_user_id)
      }
      if (blockedPrincipals.has(row.target_user_id) && ownerSet.has(row.actor_user_id)) {
        blockedOwners.add(row.actor_user_id)
      }
    }

    if (viewerUserId) {
      const muteRows = await store.listMutedOwners({ viewerUserId, ownerUserIds: ownerIds })
        .catch(mapProfileChannelReadError)
      for (const row of muteRows) mutedOwners.add(row.target_user_id)
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
