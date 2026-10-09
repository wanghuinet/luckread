/// <reference types="@cloudflare/workers-types" />

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

export async function createShare(
  db: D1Database,
  actorUserId: string,
  contentIdValue: string,
  idempotencyKeyValue: string,
): Promise<ShareRecord> {
  const actor = validateActor(actorUserId)
  const contentId = validateId(contentIdValue)
  const idempotencyKey = validateIdempotencyKey(idempotencyKeyValue)

  const content = await db.prepare(
    'SELECT id, state FROM contents WHERE id = ? LIMIT 1',
  ).bind(contentId).first<{ id: string; state: string }>()

  if (!content || content.state !== 'PUBLISHED') {
    throw new ShareRuntimeError('NOT_FOUND', 404)
  }

  const existing = await db.prepare(
    'SELECT share_id, content_id, actor_user_id, created_at FROM social_share_links WHERE actor_user_id = ? AND idempotency_key = ? LIMIT 1',
  ).bind(actor, idempotencyKey).first<{
    share_id: string
    content_id: string
    actor_user_id: string
    created_at: string
  }>()

  if (existing) {
    if (existing.content_id !== contentId) {
      throw new ShareRuntimeError('CONFLICT', 409)
    }
    return {
      shareId: existing.share_id,
      contentId: existing.content_id,
      actorUserId: existing.actor_user_id,
      createdAt: existing.created_at,
    }
  }

  const shareId = crypto.randomUUID()
  const createdAt = new Date().toISOString()

  try {
    const inserted = await db.prepare(
      `INSERT INTO social_share_links (share_id, content_id, actor_user_id, idempotency_key, created_at)
         SELECT ?, content.id, ?, ?, ?
           FROM contents content
          WHERE content.id = ?
            AND content.state = 'PUBLISHED'`,
    ).bind(shareId, actor, idempotencyKey, createdAt, contentId).run()

    if (Number(inserted.meta?.changes ?? 0) !== 1) {
      throw new ShareRuntimeError('NOT_FOUND', 404)
    }
  } catch (error) {
    if (!(error instanceof Error) || !error.message.toLowerCase().includes('unique')) {
      throw error
    }
  }

  const row = await db.prepare(
    'SELECT share_id, content_id, actor_user_id, created_at FROM social_share_links WHERE actor_user_id = ? AND idempotency_key = ? LIMIT 1',
  ).bind(actor, idempotencyKey).first<{
    share_id: string
    content_id: string
    actor_user_id: string
    created_at: string
  }>()

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
  shareIdValue: string,
): Promise<{ shareId: string; contentId: string; createdAt: string }> {
  const shareId = validateId(shareIdValue)
  const row = await db.prepare(
    `SELECT
       s.share_id,
       s.content_id,
       s.created_at,
       c.state
     FROM social_share_links s
     JOIN contents c ON c.id = s.content_id
     WHERE s.share_id = ?
     LIMIT 1`,
  ).bind(shareId).first<{
    share_id: string
    content_id: string
    created_at: string
    state: string
  }>()

  if (!row || row.state !== 'PUBLISHED') {
    throw new ShareRuntimeError('NOT_FOUND', 404)
  }

  return {
    shareId: row.share_id,
    contentId: row.content_id,
    createdAt: row.created_at,
  }
}
