/// <reference types="@cloudflare/workers-types" />

import { ReplyAudienceRuntimeError } from './reply-audience-runtime.js'
import { fetchPublishedContentSocialContext, type W03ContentBinding } from './w03-content-context-client.js'

export class RepostRuntimeError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code) }
}

export type RepostRecord = {
  repostId: string
  contentId: string
  actorUserId: string
  createdAt: string
}

const MAX_ID = 128
const validateId = (value: string): string => {
  const normalized = value.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(normalized) || normalized.length > MAX_ID) {
    throw new RepostRuntimeError('VALIDATION_FAILED', 400)
  }
  return normalized
}
const validateActor = (value: string): string => {
  try { return validateId(value) } catch { throw new RepostRuntimeError('UNAUTHENTICATED', 401) }
}

const getPublishedOwner = async (
  binding: W03ContentBinding | undefined,
  contentId: string,
  correlationId: string,
): Promise<string | null> => {
  try {
    const context = await fetchPublishedContentSocialContext(binding, { contentId, correlationId })
    return context.ownerUserId
  } catch (error) {
    if (error instanceof ReplyAudienceRuntimeError) {
      if (error.status === 404) throw new RepostRuntimeError('NOT_FOUND', 404)
      if (error.status === 400) throw new RepostRuntimeError('VALIDATION_FAILED', 400)
      if (error.status === 403) throw new RepostRuntimeError('PERMISSION_DENIED', 403)
      if (error.status === 429) throw new RepostRuntimeError('RATE_LIMITED', 429)
    }
    throw new RepostRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
}

/**
 * W03 is authoritative for publication and ownership. W05 checks its own
 * block relationships and stores only the repost relation, never content.
 * Cross-Worker state cannot be transactionally locked; feed/read paths must
 * still validate canonical content visibility before disclosing a repost.
 */
export async function createRepost(
  db: D1Database,
  w03Content: W03ContentBinding | undefined,
  actorUserIdValue: string,
  contentIdValue: string,
  correlationId: string,
): Promise<RepostRecord> {
  const actorUserId = validateActor(actorUserIdValue)
  const contentId = validateId(contentIdValue)
  const ownerUserId = await getPublishedOwner(w03Content, contentId, correlationId)

  const block = await db.prepare(
    `SELECT EXISTS (
       SELECT 1 FROM social_user_interactions block
        WHERE block.relation_type = 'block'
          AND (
            (block.actor_user_id = ? AND block.target_user_id = ?)
            OR (block.actor_user_id = ? AND block.target_user_id = ?)
          )
     ) AS blocked`,
  ).bind(actorUserId, ownerUserId, ownerUserId, actorUserId).first<{ blocked: number }>()
  if (Number(block?.blocked ?? 0) !== 0) throw new RepostRuntimeError('NOT_FOUND', 404)

  const existing = await db.prepare(
    'SELECT repost_id, content_id, actor_user_id, created_at FROM social_reposts WHERE actor_user_id = ? AND content_id = ? LIMIT 1',
  ).bind(actorUserId, contentId).first<{
    repost_id: string; content_id: string; actor_user_id: string; created_at: string
  }>()
  if (existing) return {
    repostId: existing.repost_id, contentId: existing.content_id,
    actorUserId: existing.actor_user_id, createdAt: existing.created_at,
  }

  const repostId = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  await db.prepare(
    'INSERT OR IGNORE INTO social_reposts (repost_id, content_id, actor_user_id, created_at) VALUES (?, ?, ?, ?)',
  ).bind(repostId, contentId, actorUserId, createdAt).run()

  const row = await db.prepare(
    'SELECT repost_id, content_id, actor_user_id, created_at FROM social_reposts WHERE actor_user_id = ? AND content_id = ? LIMIT 1',
  ).bind(actorUserId, contentId).first<{
    repost_id: string; content_id: string; actor_user_id: string; created_at: string
  }>()
  if (!row) throw new RepostRuntimeError('NOT_FOUND', 404)
  return {
    repostId: row.repost_id, contentId: row.content_id,
    actorUserId: row.actor_user_id, createdAt: row.created_at,
  }
}

/** Delete only the current actor's relation; repeated deletes are harmless. */
export async function removeRepost(
  db: D1Database,
  actorUserIdValue: string,
  contentIdValue: string,
): Promise<void> {
  const actorUserId = validateActor(actorUserIdValue)
  const contentId = validateId(contentIdValue)
  await db.prepare('DELETE FROM social_reposts WHERE actor_user_id = ? AND content_id = ?')
    .bind(actorUserId, contentId).run()
}
