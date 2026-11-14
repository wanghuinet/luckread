/// <reference types="@cloudflare/workers-types" />

import {
  createD1BlockMuteListReadStore,
  BlockMuteListReadStoreError,
  type BlockMuteListReadStore,
} from './block-mute-list-read-store.js'
import {
  createD1BlockMuteRelationStore,
  BlockMuteRelationStoreError,
  type BlockMuteRelationRow,
  type BlockMuteRelationStore,
} from './block-mute-relation-store.js'

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
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(normalized) || normalized.length > MAX_ID) {
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

type BlockMuteRelationDataSource = D1Database | BlockMuteRelationStore

function resolveBlockMuteRelationStore(source: BlockMuteRelationDataSource): BlockMuteRelationStore {
  if (
    typeof (source as BlockMuteRelationStore).get === 'function' &&
    typeof (source as BlockMuteRelationStore).set === 'function' &&
    typeof (source as BlockMuteRelationStore).remove === 'function'
  ) {
    return source as BlockMuteRelationStore
  }
  return createD1BlockMuteRelationStore(source as D1Database)
}

function mapBlockMuteRelationStoreError(error: unknown): never {
  if (error instanceof BlockMuteRelationStoreError) {
    throw new BlockMuteRuntimeError(error.code, error.status)
  }
  throw error
}

const toBlockMuteRecord = (row: {
  relationship_id: string
  actor_user_id: string
  target_user_id: string
  relation_type: BlockMuteType
  created_at: string
  updated_at: string
}): BlockMuteRecord => ({
  relationshipId: row.relationship_id,
  actorUserId: row.actor_user_id,
  targetUserId: row.target_user_id,
  relationType: row.relation_type,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export async function getRelation(
  source: BlockMuteRelationDataSource,
  actorUserId: string,
  targetUserId: string,
  relationType: BlockMuteType,
): Promise<BlockMuteRecord | null> {
  const [actor, target] = validateTarget(actorUserId, targetUserId)
  try {
    const row = await resolveBlockMuteRelationStore(source).get({
      actorUserId: actor,
      targetUserId: target,
      relationType,
    })
    return row ? toBlockMuteRecord(row) : null
  } catch (error) {
    mapBlockMuteRelationStoreError(error)
  }
}

export async function setRelation(
  source: BlockMuteRelationDataSource,
  actorUserId: string,
  targetUserId: string,
  relationType: BlockMuteType,
): Promise<BlockMuteRecord> {
  const [actor, target] = validateTarget(actorUserId, targetUserId)
  const now = new Date().toISOString()
  let row: BlockMuteRelationRow | null
  try {
    row = await resolveBlockMuteRelationStore(source).set({
      relationshipId: crypto.randomUUID(),
      actorUserId: actor,
      targetUserId: target,
      relationType,
      createdAt: now,
      updatedAt: now,
    })
  } catch (error) {
    mapBlockMuteRelationStoreError(error)
  }
  if (!row) throw new BlockMuteRuntimeError('INTERNAL_ERROR', 500)
  return toBlockMuteRecord(row)
}

export async function removeRelation(
  source: BlockMuteRelationDataSource,
  actorUserId: string,
  targetUserId: string,
  relationType: BlockMuteType,
): Promise<void> {
  const [actor, target] = validateTarget(actorUserId, targetUserId)
  try {
    await resolveBlockMuteRelationStore(source).remove({
      actorUserId: actor,
      targetUserId: target,
      relationType,
    })
  } catch (error) {
    mapBlockMuteRelationStoreError(error)
  }
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

type BlockMuteListDataSource = D1Database | BlockMuteListReadStore

function resolveBlockMuteListReadStore(source: BlockMuteListDataSource): BlockMuteListReadStore {
  if (typeof (source as BlockMuteListReadStore).list === 'function') {
    return source as BlockMuteListReadStore
  }
  return createD1BlockMuteListReadStore(source as D1Database)
}

/**
 * Lists a viewer's own Block or Mute relationships. The cursor is bound to the
 * actor and relation type; D1 remains the default authority while PostgreSQL
 * can be injected for isolated rehearsal.
 */
export async function listRelations(
  source: BlockMuteListDataSource,
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

  let rows
  try {
    rows = await resolveBlockMuteListReadStore(source).list({
      actorUserId: actor,
      relationType,
      cursor: cursor ? {
        createdAt: cursor.createdAt,
        relationshipId: cursor.relationshipId,
      } : null,
      limit,
    })
  } catch (error) {
    if (error instanceof BlockMuteListReadStoreError) {
      throw new BlockMuteRuntimeError(error.code, error.status)
    }
    throw error
  }

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
          createdAt: last.cursor_created_at ?? last.created_at,
          relationshipId: last.relationship_id,
        })
      : null,
  }
}
