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
    throw new BlockMuteRuntimeError('INVALID_STATE', 409)
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

  if (!row) throw new BlockMuteRuntimeError('INTERNAL_ERROR', 500)

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

export type BlockMuteListItem = {
  relationshipId: string
  targetUserId: string
  createdAt: string
}

export type BlockMuteListPage = {
  items: BlockMuteListItem[]
  nextCursor: string | null
  hasMore: boolean
}

const DEFAULT_RELATION_LIST_LIMIT = 20
const MAX_RELATION_LIST_LIMIT = 50
const MAX_RELATION_CURSOR_LENGTH = 2048

type RelationCursorPayload = {
  version: 1
  actorUserId: string
  relationType: BlockMuteType
  createdAt: string
  relationshipId: string
}

const encodeRelationCursor = (payload: RelationCursorPayload): string =>
  btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')

const decodeRelationCursor = (
  value: string | null,
  actorUserId: string,
  relationType: BlockMuteType,
): RelationCursorPayload | null => {
  if (value === null) return null
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_RELATION_CURSOR_LENGTH) {
    throw new BlockMuteRuntimeError('INVALID_CURSOR', 400)
  }
  try {
    const padded = normalized.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - normalized.length % 4) % 4)
    const parsed = JSON.parse(atob(padded)) as Partial<RelationCursorPayload>
    if (
      parsed.version !== 1 ||
      parsed.actorUserId !== actorUserId ||
      parsed.relationType !== relationType ||
      typeof parsed.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(parsed.createdAt)) ||
      typeof parsed.relationshipId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(parsed.relationshipId)
    ) {
      throw new Error('invalid cursor')
    }
    return {
      version: 1,
      actorUserId,
      relationType,
      createdAt: parsed.createdAt,
      relationshipId: parsed.relationshipId,
    }
  } catch {
    throw new BlockMuteRuntimeError('INVALID_CURSOR', 400)
  }
}

export const parseBlockMuteListLimit = (value: string | null): number => {
  if (value === null || value.trim() === '') return DEFAULT_RELATION_LIST_LIMIT
  const normalized = value.trim()
  if (!/^(?:[1-9]|[1-4][0-9]|50)$/.test(normalized)) {
    throw new BlockMuteRuntimeError('VALIDATION_FAILED', 400)
  }
  return Math.min(Number(normalized), MAX_RELATION_LIST_LIMIT)
}

/**
 * Lists a viewer's own block or mute relationships from W05's authoritative
 * D1 table. Cursors are bound to the viewer and relation type to prevent reuse
 * across principals or between the block and mute lists.
 */
export async function listRelations(
  db: D1Database,
  actorUserId: string,
  relationType: BlockMuteType,
  cursorValue: string | null,
  limit: number,
): Promise<BlockMuteListPage> {
  const actor = validateActor(actorUserId)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RELATION_LIST_LIMIT) {
    throw new BlockMuteRuntimeError('VALIDATION_FAILED', 400)
  }
  const cursor = decodeRelationCursor(cursorValue, actor, relationType)
  const where = cursor
    ? `WHERE actor_user_id = ? AND relation_type = ?
       AND (created_at < ? OR (created_at = ? AND relationship_id < ?))`
    : 'WHERE actor_user_id = ? AND relation_type = ?'
  const statement = `SELECT relationship_id, target_user_id, created_at
    FROM social_user_interactions
    ${where}
    ORDER BY created_at DESC, relationship_id DESC
    LIMIT ?`
  const parameters = cursor
    ? [actor, relationType, cursor.createdAt, cursor.createdAt, cursor.relationshipId, limit + 1]
    : [actor, relationType, limit + 1]
  const result = await db.prepare(statement).bind(...parameters).all<{
    relationship_id: string
    target_user_id: string
    created_at: string
  }>()
  const rows = result.results ?? []
  const hasMore = rows.length > limit
  const visibleRows = hasMore ? rows.slice(0, limit) : rows
  const last = visibleRows.at(-1)

  return {
    items: visibleRows.map((row) => ({
      relationshipId: row.relationship_id,
      targetUserId: row.target_user_id,
      createdAt: row.created_at,
    })),
    hasMore,
    nextCursor: hasMore && last
      ? encodeRelationCursor({
          version: 1,
          actorUserId: actor,
          relationType,
          createdAt: last.created_at,
          relationshipId: last.relationship_id,
        })
      : null,
  }
}
