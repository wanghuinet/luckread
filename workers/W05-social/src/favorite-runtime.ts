/// <reference types="@cloudflare/workers-types" />

export class FavoriteRuntimeError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code) }
}

export type FavoriteTarget = {
  targetType: string
  targetId: string
}

export type FavoriteResult = {
  relationshipId: string
  actorUserId: string
  targetType: 'content'
  targetId: string
  createdAt: string
}

const RESOURCE_ID_MAX = 128

const validateTarget = (target: FavoriteTarget): { targetType: 'content'; targetId: string } => {
  if (target.targetType !== 'content') {
    throw new FavoriteRuntimeError('VALIDATION_FAILED', 400)
  }

  const targetId = target.targetId?.trim() ?? ''
  if (!targetId || targetId.length > RESOURCE_ID_MAX) {
    throw new FavoriteRuntimeError('VALIDATION_FAILED', 400)
  }

  return { targetType: 'content', targetId }
}

const validateActor = (actorUserId: string): string => {
  const value = actorUserId.trim()
  if (!value || value.length > RESOURCE_ID_MAX) {
    throw new FavoriteRuntimeError('UNAUTHENTICATED', 401)
  }
  return value
}

export async function favorite(
  db: D1Database,
  actorUserId: string,
  target: FavoriteTarget,
): Promise<FavoriteResult> {
  const actor = validateActor(actorUserId)
  const { targetType, targetId } = validateTarget(target)

  const targetRow = await db.prepare(
    'SELECT id, state FROM contents WHERE id = ? LIMIT 1',
  ).bind(targetId).first<{ id: string; state: string }>()

  if (!targetRow || targetRow.state !== 'PUBLISHED') {
    throw new FavoriteRuntimeError('NOT_FOUND', 404)
  }

  const relationshipId = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  const row = await db.prepare(
    `INSERT INTO interaction_favorites
      (relationship_id, actor_user_id, target_type, target_id, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(actor_user_id, target_type, target_id)
     DO UPDATE SET relationship_id = interaction_favorites.relationship_id
     RETURNING relationship_id, actor_user_id, target_type, target_id, created_at`,
  ).bind(
    relationshipId,
    actor,
    targetType,
    targetId,
    createdAt,
  ).first<{
    relationship_id: string
    actor_user_id: string
    target_type: 'content'
    target_id: string
    created_at: string
  }>()

  if (!row) throw new FavoriteRuntimeError('FAVORITE_WRITE_FAILED', 500)

  return {
    relationshipId: row.relationship_id,
    actorUserId: row.actor_user_id,
    targetType: row.target_type,
    targetId: row.target_id,
    createdAt: row.created_at,
  }
}

export async function getFavoriteStatus(
  db: D1Database,
  actorUserId: string,
  target: FavoriteTarget,
): Promise<{ favorited: boolean }> {
  const actor = validateActor(actorUserId)
  const { targetType, targetId } = validateTarget(target)

  const row = await db.prepare(
    `SELECT EXISTS (
       SELECT 1
       FROM interaction_favorites
       WHERE actor_user_id = ?
         AND target_type = ?
         AND target_id = c.id
     ) AS favorited
     FROM contents c
     WHERE c.id = ?
       AND c.state = 'PUBLISHED'
     LIMIT 1`,
  ).bind(actor, targetType, targetId).first<{ favorited: number }>()

  return { favorited: Boolean(row?.favorited) }
}

export async function unfavorite(
  db: D1Database,
  actorUserId: string,
  target: FavoriteTarget,
): Promise<void> {
  const actor = validateActor(actorUserId)
  const { targetType, targetId } = validateTarget(target)

  await db.prepare(
    'DELETE FROM interaction_favorites WHERE actor_user_id = ? AND target_type = ? AND target_id = ?',
  ).bind(actor, targetType, targetId).run()
}
