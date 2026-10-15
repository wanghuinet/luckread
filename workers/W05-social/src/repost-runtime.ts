/// <reference types="@cloudflare/workers-types" />

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
  // Content/user identifiers use the repository's canonical path-safe ID
  // alphabet. Reject encoded path separators before any database access.
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(normalized) || normalized.length > MAX_ID) {
    throw new RepostRuntimeError('VALIDATION_FAILED', 400)
  }
  return normalized
}
const validateActor = (value: string): string => {
  try { return validateId(value) } catch { throw new RepostRuntimeError('UNAUTHENTICATED', 401) }
}

/** Store a relation to canonical content; do not copy original body or media. */
export async function createRepost(
  db: D1Database,
  actorUserIdValue: string,
  contentIdValue: string,
): Promise<RepostRecord> {
  const actorUserId = validateActor(actorUserIdValue)
  const contentId = validateId(contentIdValue)
  const target = await db.prepare(
    `SELECT c.id, c.state, c.owner_user_id,
       EXISTS (
         SELECT 1 FROM social_user_interactions block
          WHERE block.relation_type = 'block'
            AND (
              (block.actor_user_id = ? AND block.target_user_id = c.owner_user_id)
              OR (block.actor_user_id = c.owner_user_id AND block.target_user_id = ?)
            )
       ) AS blocked
     FROM contents c WHERE c.id = ? LIMIT 1`,
  ).bind(actorUserId, actorUserId, contentId).first<{
    id: string; state: string; owner_user_id: string | null; blocked: number
  }>()
  if (!target || target.state !== 'PUBLISHED' || Number(target.blocked) !== 0) {
    throw new RepostRuntimeError('NOT_FOUND', 404)
  }
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
    `INSERT OR IGNORE INTO social_reposts (repost_id, content_id, actor_user_id, created_at)
     SELECT ?, c.id, ?, ? FROM contents c
      WHERE c.id = ? AND c.state = 'PUBLISHED'
        AND NOT EXISTS (
          SELECT 1 FROM social_user_interactions block
           WHERE block.relation_type = 'block'
             AND (
               (block.actor_user_id = ? AND block.target_user_id = c.owner_user_id)
               OR (block.actor_user_id = c.owner_user_id AND block.target_user_id = ?)
             )
        )`,
  ).bind(repostId, actorUserId, createdAt, contentId, actorUserId, actorUserId).run()
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
