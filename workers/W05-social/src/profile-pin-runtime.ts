/// <reference types="@cloudflare/workers-types" />
import type { OwnedPostContext } from './owned-post-context.js'

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
): Promise<ProfilePinRecord> {
  const actorUserId = validateId(actorUserIdValue, true)
  const contentId = validateId(contentIdValue)

  if (!context || context.contentId !== contentId || context.contentType !== 'post' || context.state !== 'PUBLISHED') {
    throw new ProfilePinRuntimeError('NOT_FOUND', 404)
  }
  if (context.ownerUserId !== actorUserId) throw new ProfilePinRuntimeError('PERMISSION_DENIED', 403)

  const pinnedAt = new Date().toISOString()
  await db.prepare(
    `INSERT INTO social_profile_pins (user_id, content_id, pinned_at)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       content_id = excluded.content_id,
       pinned_at = CASE
         WHEN social_profile_pins.content_id = excluded.content_id THEN social_profile_pins.pinned_at
         ELSE excluded.pinned_at
       END`,
  ).bind(actorUserId, contentId, pinnedAt).run()

  const row = await db.prepare(
    'SELECT user_id, content_id, pinned_at FROM social_profile_pins WHERE user_id = ? LIMIT 1',
  ).bind(actorUserId).first<{ user_id: string; content_id: string; pinned_at: string }>()

  if (!row || row.content_id !== contentId) throw new ProfilePinRuntimeError('CONFLICT', 409)
  return { userId: row.user_id, contentId: row.content_id, pinnedAt: row.pinned_at }
}

/** Only the authenticated owner can clear their own matching profile pin. */
export async function unpinProfileContent(
  db: D1Database,
  actorUserIdValue: string,
  contentIdValue: string,
): Promise<void> {
  const actorUserId = validateId(actorUserIdValue, true)
  const contentId = validateId(contentIdValue)
  await db.prepare(
    'DELETE FROM social_profile_pins WHERE user_id = ? AND content_id = ?',
  ).bind(actorUserId, contentId).run()
}

export async function getProfilePin(
  db: D1Database,
  userIdValue: string,
): Promise<ProfilePinRecord | null> {
  const userId = validateId(userIdValue)
  const row = await db.prepare(
    `SELECT p.user_id, p.content_id, p.pinned_at
       FROM social_profile_pins p
       JOIN contents c ON c.id = p.content_id
      WHERE p.user_id = ? AND c.owner_user_id = p.user_id AND c.content_type = 'post' AND c.state = 'PUBLISHED'
      LIMIT 1`,
  ).bind(userId).first<{ user_id: string; content_id: string; pinned_at: string }>()
  return row ? { userId: row.user_id, contentId: row.content_id, pinnedAt: row.pinned_at } : null
}

export async function isContentProfilePinned(db: D1Database, contentIdValue: string): Promise<boolean> {
  const contentId = validateId(contentIdValue)
  const row = await db.prepare(
    `SELECT EXISTS (
       SELECT 1 FROM social_profile_pins p
       JOIN contents c ON c.id = p.content_id AND c.owner_user_id = p.user_id
       WHERE p.content_id = ? AND c.content_type = 'post' AND c.state = 'PUBLISHED'
     ) AS pinned`,
  ).bind(contentId).first<{ pinned: number }>()
  return Number(row?.pinned ?? 0) === 1
}
