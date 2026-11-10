/// <reference types="@cloudflare/workers-types" />
import type { OwnedPostContext } from './owned-post-context.js'
import { createD1ProfilePinStore, ProfilePinStoreError, type ProfilePinStorageRow, type ProfilePinStore } from './profile-pin-store.js'

export class ProfilePinRuntimeError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code) }
}

export type ProfilePinRecord = {
  userId: string
  contentId: string
  pinnedAt: string
}

const validateId = (value: string, actor = false): string => {
  const normalized = value.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(normalized)) {
    throw new ProfilePinRuntimeError(actor ? 'UNAUTHENTICATED' : 'VALIDATION_FAILED', actor ? 401 : 400)
  }
  return normalized
}

/** A profile has at most one pinned, published item; content remains canonical in W03. */
export async function pinProfileContent(
  db: D1Database,
  actorUserIdValue: string,
  contentIdValue: string,
  context: OwnedPostContext,
  store: ProfilePinStore = createD1ProfilePinStore(db),
): Promise<ProfilePinRecord> {
  const actorUserId = validateId(actorUserIdValue, true)
  const contentId = validateId(contentIdValue)

  if (!context || context.contentId !== contentId || context.contentType !== 'post' || context.state !== 'PUBLISHED') {
    throw new ProfilePinRuntimeError('NOT_FOUND', 404)
  }
  if (context.ownerUserId !== actorUserId) throw new ProfilePinRuntimeError('PERMISSION_DENIED', 403)

  const pinnedAt = new Date().toISOString()
  let row: ProfilePinStorageRow | null
  try {
    row = await store.pin(actorUserId, contentId, pinnedAt)
  } catch (error) {
    if (error instanceof ProfilePinStoreError) {
      throw new ProfilePinRuntimeError(error.code, error.status)
    }
    throw new ProfilePinRuntimeError('SERVICE_UNAVAILABLE', 503)
  }

  if (!row || row.content_id !== contentId) throw new ProfilePinRuntimeError('CONFLICT', 409)
  return { userId: row.user_id, contentId: row.content_id, pinnedAt: row.pinned_at }
}

/** Only the authenticated owner can clear their own matching profile pin. */
export async function unpinProfileContent(
  db: D1Database,
  actorUserIdValue: string,
  contentIdValue: string,
  store: ProfilePinStore = createD1ProfilePinStore(db),
): Promise<void> {
  const actorUserId = validateId(actorUserIdValue, true)
  const contentId = validateId(contentIdValue)
  try {
    await store.unpin(actorUserId, contentId)
  } catch (error) {
    if (error instanceof ProfilePinStoreError) {
      throw new ProfilePinRuntimeError(error.code, error.status)
    }
    throw new ProfilePinRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
}

/**
 * Read only W05-owned pin state. The caller must validate the referenced
 * content through W03 before presenting this reference as a public profile pin.
 */
export async function getProfilePinReference(
  db: D1Database,
  userIdValue: string,
  store: ProfilePinStore = createD1ProfilePinStore(db),
): Promise<ProfilePinRecord | null> {
  const userId = validateId(userIdValue)
  try {
    const row = await store.get(userId)
    return row ? { userId: row.user_id, contentId: row.content_id, pinnedAt: row.pinned_at } : null
  } catch (error) {
    if (error instanceof ProfilePinStoreError) {
      throw new ProfilePinRuntimeError(error.code, error.status)
    }
    throw new ProfilePinRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
}
