/// <reference types="@cloudflare/workers-types" />

export type BlockMuteType = 'block' | 'mute'

export type BlockMuteRecord = {
  relationshipId: string
  actorUserId: string
  targetUserId: string
  relationType: BlockMuteType
  createdAt: string
  updatedAt: string
}

export class BlockMuteRuntimeError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code) }
}

const MAX_ID = 128

const validateId = (value: string): string => {
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_ID) {
    throw new BlockMuteRuntimeError('VALIDATION_FAILED', 400)
  }
  return normalized
}

const validateActor = (value: string): string => {
  try {
    return validateId(value)
  } catch {
    throw new BlockMuteRuntimeError('UNAUTHENTICATED', 401)
  }
}

const validateTarget = (actorUserId: string, targetUserId: string): [string, string] => {
  const actor = validateActor(actorUserId)
  const target = validateId(targetUserId)
  if (actor === target) {
    throw new BlockMuteRuntimeError('INVALID_RELATIONSHIP', 409)
  }
  return [actor, target]
}

export async function getRelation(
  db: D1Database,
  actorUserId: string,
  targetUserId: string,
  relationType: BlockMuteType,
): Promise<BlockMuteRecord | null> {
  const [actor, target] = validateTarget(actorUserId, targetUserId)
  const row = await db.prepare(
    'SELECT relationship_id, actor_user_id, target_user_id, relation_type, created_at, updated_at FROM social_user_interactions WHERE actor_user_id = ? AND target_user_id = ? AND relation_type = ? LIMIT 1',
  ).bind(actor, target, relationType).first<{
    relationship_id: string
    actor_user_id: string
    target_user_id: string
    relation_type: BlockMuteType
    created_at: string
    updated_at: string
  }>()

  return row
    ? {
        relationshipId: row.relationship_id,
        actorUserId: row.actor_user_id,
        targetUserId: row.target_user_id,
        relationType: row.relation_type,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    : null
}

export async function setRelation(
  db: D1Database,
  actorUserId: string,
  targetUserId: string,
  relationType: BlockMuteType,
): Promise<BlockMuteRecord> {
  const [actor, target] = validateTarget(actorUserId, targetUserId)
  const relationshipId = crypto.randomUUID()
  const now = new Date().toISOString()

  const row = await db.prepare(
    `INSERT INTO social_user_interactions
      (relationship_id, actor_user_id, target_user_id, relation_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(actor_user_id, target_user_id, relation_type)
     DO UPDATE SET updated_at = social_user_interactions.updated_at
     RETURNING relationship_id, actor_user_id, target_user_id, relation_type, created_at, updated_at`,
  ).bind(
    relationshipId,
    actor,
    target,
    relationType,
    now,
    now,
  ).first<{
    relationship_id: string
    actor_user_id: string
    target_user_id: string
    relation_type: BlockMuteType
    created_at: string
    updated_at: string
  }>()

  if (!row) throw new BlockMuteRuntimeError('RELATION_WRITE_FAILED', 500)

  return {
    relationshipId: row.relationship_id,
    actorUserId: row.actor_user_id,
    targetUserId: row.target_user_id,
    relationType: row.relation_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function removeRelation(
  db: D1Database,
  actorUserId: string,
  targetUserId: string,
  relationType: BlockMuteType,
): Promise<void> {
  const [actor, target] = validateTarget(actorUserId, targetUserId)
  await db.prepare(
    'DELETE FROM social_user_interactions WHERE actor_user_id = ? AND target_user_id = ? AND relation_type = ?',
  ).bind(actor, target, relationType).run()
}
