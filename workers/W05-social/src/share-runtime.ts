/// <reference types="@cloudflare/workers-types" />

import { ReplyAudienceRuntimeError } from './reply-audience-runtime.js'
import { fetchPublishedContentSocialContext, type W03ContentBinding } from './w03-content-context-client.js'
import { createD1ShareStore, ShareStoreError, type ShareStorageRow, type ShareStore } from './share-store.js'

export class ShareRuntimeError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code) }
}

export type ShareRecord = {
  shareId: string
  contentId: string
  actorUserId: string
  createdAt: string
}

const MAX_ID = 128
const MAX_IDEMPOTENCY_KEY = 256

const validateId = (value: string): string => {
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_ID) {
    throw new ShareRuntimeError('VALIDATION_FAILED', 400)
  }
  return normalized
}

const validateActor = (value: string): string => {
  try {
    return validateId(value)
  } catch {
    throw new ShareRuntimeError('UNAUTHENTICATED', 401)
  }
}

const validateIdempotencyKey = (value: string): string => {
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_IDEMPOTENCY_KEY) {
    throw new ShareRuntimeError('PRECONDITION_REQUIRED', 428)
  }
  return normalized
}

const assertPublishedContent = async (
  binding: W03ContentBinding | undefined,
  contentId: string,
  correlationId: string,
): Promise<void> => {
  try {
    await fetchPublishedContentSocialContext(binding, { contentId, correlationId })
  } catch (error) {
    if (error instanceof ReplyAudienceRuntimeError) {
      if (error.status === 404) throw new ShareRuntimeError('NOT_FOUND', 404)
      if (error.status === 400) throw new ShareRuntimeError('VALIDATION_FAILED', 400)
      if (error.status === 403) throw new ShareRuntimeError('PERMISSION_DENIED', 403)
      if (error.status === 429) throw new ShareRuntimeError('RATE_LIMITED', 429)
    }
    throw new ShareRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
}

/**
 * W05 stores share-link records; W03 is the sole authority for whether the
 * referenced content is currently published. Since cross-Worker state cannot
 * be transactionally locked, every resolve repeats this check before disclosure.
 */
export async function createShare(
  db: D1Database,
  w03Content: W03ContentBinding | undefined,
  actorUserId: string,
  contentIdValue: string,
  idempotencyKeyValue: string,
  correlationId: string,
  store: ShareStore = createD1ShareStore(db),
): Promise<ShareRecord> {
  const actor = validateActor(actorUserId)
  const contentId = validateId(contentIdValue)
  const idempotencyKey = validateIdempotencyKey(idempotencyKeyValue)

  await assertPublishedContent(w03Content, contentId, correlationId)

  let existing: ShareStorageRow | null
  try {
    existing = await store.findByActorAndKey(actor, idempotencyKey)
  } catch (error) {
    if (error instanceof ShareStoreError) throw new ShareRuntimeError(error.code, error.status)
    throw new ShareRuntimeError('SERVICE_UNAVAILABLE', 503)
  }

  if (existing) {
    if (existing.content_id !== contentId) throw new ShareRuntimeError('CONFLICT', 409)
    return {
      shareId: existing.share_id,
      contentId: existing.content_id,
      actorUserId: existing.actor_user_id,
      createdAt: existing.created_at,
    }
  }

  const shareId = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  let row: ShareStorageRow | null
  try {
    await store.insertIfAbsent(shareId, contentId, actor, idempotencyKey, createdAt)
    row = await store.findByActorAndKey(actor, idempotencyKey)
  } catch (error) {
    if (error instanceof ShareStoreError) throw new ShareRuntimeError(error.code, error.status)
    throw new ShareRuntimeError('SERVICE_UNAVAILABLE', 503)
  }

  if (!row) throw new ShareRuntimeError('INTERNAL_ERROR', 500)
  if (row.content_id !== contentId) throw new ShareRuntimeError('CONFLICT', 409)

  return {
    shareId: row.share_id,
    contentId: row.content_id,
    actorUserId: row.actor_user_id,
    createdAt: row.created_at,
  }
}

export async function resolveShare(
  db: D1Database,
  w03Content: W03ContentBinding | undefined,
  shareIdValue: string,
  correlationId: string,
  store: ShareStore = createD1ShareStore(db),
): Promise<{ shareId: string; contentId: string; createdAt: string }> {
  const shareId = validateId(shareIdValue)
  let row: Pick<ShareStorageRow, 'share_id' | 'content_id' | 'created_at'> | null
  try {
    row = await store.findById(shareId)
  } catch (error) {
    if (error instanceof ShareStoreError) throw new ShareRuntimeError(error.code, error.status)
    throw new ShareRuntimeError('SERVICE_UNAVAILABLE', 503)
  }

  if (!row) throw new ShareRuntimeError('NOT_FOUND', 404)
  await assertPublishedContent(w03Content, row.content_id, correlationId)

  return {
    shareId: row.share_id,
    contentId: row.content_id,
    createdAt: row.created_at,
  }
}
