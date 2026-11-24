import {
  ContentRuntimeError,
  decodeScopedCursor,
  encodeScopedCursor,
} from './content-runtime.js'

export const MAX_POST_THREAD_ITEMS = 50

export type ContentRelationshipStatus = 'ACTIVE' | 'REVOKED' | 'SUPERSEDED'
export type ContentRelationshipDirection = 'out' | 'in' | 'both'
export type ContentRelationshipType = 'reference' | 'quote-post' | 'thread-next'

export interface ContentRelationship {
  relationshipId: string
  sourceType: 'content'
  sourceId: string
  targetType: 'content'
  targetId: string
  relationType: ContentRelationshipType
  schemaVersion: number
  status: ContentRelationshipStatus
  actorId: string
  provenanceRef: string | null
  authorizationRef: string | null
  createdAt: string
  updatedAt: string
}

export interface PublicContentRelationship {
  relationshipId: string
  relationType: ContentRelationshipType
  direction: 'out' | 'in'
  relatedContent: {
    id: string
    slug: string
    contentType: 'article' | 'post' | 'video'
    title: string
  }
  createdAt: string
}

export interface RelationshipRow {
  relationship_id: string
  source_type: 'content'
  source_id: string
  target_type: 'content'
  target_id: string
  relation_type: ContentRelationshipType
  schema_version: number
  status: ContentRelationshipStatus
  actor_id: string
  provenance_ref: string | null
  authorization_ref: string | null
  created_at: string
  updated_at: string
}

export interface CreateRelationshipQueryRow {
  source_id: string
  owner_user_id: string
  source_version: number
  source_content_type: 'article' | 'post' | 'video'
  target_id: string | null
  target_content_type: 'article' | 'post' | 'video' | null
  target_state: string | null
  target_access_mode: string | null
  idem_id: string | null
  idem_owner_user_id: string | null
  idem_request_hash: string | null
  idem_status: 'IN_PROGRESS' | 'COMPLETED' | null
  idem_response_json: string | null
  idem_expires_at: string | null
  active_relationship_id: string | null
}

export interface RevokeRelationshipQueryRow extends RelationshipRow {
  owner_user_id: string
  idem_id: string | null
  idem_owner_user_id: string | null
  idem_request_hash: string | null
  idem_status: 'IN_PROGRESS' | 'COMPLETED' | null
  idem_response_json: string | null
  idem_expires_at: string | null
}

export interface ContentRelationshipMutationStore {
  loadCreate(input: Readonly<{
    targetContentId: string
    ownerUserId: string
    operationId: string
    idempotencyKey: string
    sourceContentId: string
  }>): Promise<CreateRelationshipQueryRow | null>
  create(input: Readonly<{
    ownerUserId: string
    operationId: string
    idempotencyKey: string
    requestHash: string
    responseJson: string
    createdAt: string
    expiresAt: string
    relationship: ContentRelationship
  }>): Promise<void>
  loadRevoke(input: Readonly<{
    ownerUserId: string
    operationId: string
    idempotencyKey: string
    relationshipId: string
    sourceContentId: string
  }>): Promise<RevokeRelationshipQueryRow | null>
  revoke(input: Readonly<{
    ownerUserId: string
    operationId: string
    idempotencyKey: string
    requestHash: string
    responseJson: string
    updatedAt: string
    expiresAt: string
    relationshipId: string
    sourceContentId: string
  }>): Promise<void>
  loadAppend(input: Readonly<{
    targetContentId: string
    ownerUserId: string
    operationId: string
    idempotencyKey: string
    sourceContentId: string
  }>): Promise<AppendPostThreadQueryRow | null>
  loadAppendStats(input: Readonly<{
    sourceContentId: string
    targetContentId: string
    maxItems: number
  }>): Promise<PostThreadChainStats | null>
  appendThread(input: Readonly<{
    ownerUserId: string
    operationId: string
    idempotencyKey: string
    requestHash: string
    responseJson: string
    createdAt: string
    expiresAt: string
    maxItems: number
    relationship: ContentRelationship
  }>): Promise<void>
  list(input: Readonly<{
    contentId: string
    direction: ContentRelationshipDirection
    cursor: string | null
    limit: number
  }>): Promise<{ items: PublicContentRelationship[]; nextCursor: string | null; hasMore: boolean }>
}

const MAX_REF_LENGTH = 2048
const PAGE_SIZE_MAX = 50
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

const assertContentId = (value: string): void => {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
}

const normalizeOptionalRef = (value: unknown): string | null => {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_REF_LENGTH) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
  return normalized
}

const relationshipHash = async (operationId: string, value: unknown): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify({ operationId, value })),
  )
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const mapRow = (row: RelationshipRow): ContentRelationship => ({
  relationshipId: row.relationship_id,
  sourceType: row.source_type,
  sourceId: row.source_id,
  targetType: row.target_type,
  targetId: row.target_id,
  relationType: row.relation_type,
  schemaVersion: row.schema_version,
  status: row.status,
  actorId: row.actor_id,
  provenanceRef: row.provenance_ref,
  authorizationRef: row.authorization_ref,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const parseStoredRelationship = (value: string | null): ContentRelationship | null => {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as ContentRelationship
    if (
      parsed &&
      typeof parsed.relationshipId === 'string' &&
      parsed.sourceType === 'content' &&
      parsed.targetType === 'content' &&
      typeof parsed.sourceId === 'string' &&
      typeof parsed.targetId === 'string' &&
      (parsed.relationType === 'reference' || parsed.relationType === 'quote-post' || parsed.relationType === 'thread-next') &&
      (parsed.status === 'ACTIVE' || parsed.status === 'REVOKED') &&
      typeof parsed.schemaVersion === 'number' &&
      typeof parsed.actorId === 'string'
    ) {
      return parsed
    }
  } catch {
    // Corrupt idempotency data must not be returned as an authoritative relation.
  }
  return null
}

const relationLimit = (value: number): number =>
  Math.min(Math.max(Number.isSafeInteger(value) ? value : 20, 1), PAGE_SIZE_MAX)

const idempotencyActive = (row: { idem_id: string | null; idem_expires_at: string | null }, now: Date): boolean =>
  !!row.idem_id &&
  !!row.idem_expires_at &&
  Date.parse(row.idem_expires_at) > now.getTime()

const assertIdempotencyReplay = (
  row: { idem_id: string | null; idem_expires_at: string | null; idem_owner_user_id: string | null; idem_request_hash: string | null; idem_status: 'IN_PROGRESS' | 'COMPLETED' | null; idem_response_json: string | null },
  ownerUserId: string,
  hash: string,
  now: Date,
): ContentRelationship | null => {
  if (!idempotencyActive(row, now)) return null
  if (row.idem_owner_user_id !== ownerUserId || row.idem_request_hash !== hash) {
    throw new ContentRuntimeError('IDEMPOTENCY_KEY_REUSE_CONFLICT', 422)
  }
  if (row.idem_status === 'IN_PROGRESS') {
    throw new ContentRuntimeError('IDEMPOTENCY_IN_PROGRESS', 409)
  }
  const replay = parseStoredRelationship(row.idem_response_json)
  if (!replay) throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
  return replay
}

export async function createContentRelationship(
  mutationStore: ContentRelationshipMutationStore,
  ownerUserId: string,
  sourceContentId: string,
  input: unknown,
  idempotencyKey: string,
  now = new Date(),
): Promise<ContentRelationship> {
  assertContentId(ownerUserId)
  assertContentId(sourceContentId)
  if (!idempotencyKey || idempotencyKey.length > 256) throw new ContentRuntimeError('PRECONDITION_REQUIRED', 428)
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  const body = input as Record<string, unknown>
  const targetContentId = typeof body.targetContentId === 'string' ? body.targetContentId.trim() : ''
  const relationType = body.relationType === undefined ? 'reference' : body.relationType
  if (relationType !== 'reference' && relationType !== 'quote-post') throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  assertContentId(targetContentId)
  if (targetContentId === sourceContentId) throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  const provenanceRef = normalizeOptionalRef(body.provenanceRef)
  const authorizationRef = normalizeOptionalRef(body.authorizationRef)
  const operationId = 'createContentRelationship'
  const hash = await relationshipHash(operationId, { ownerUserId, sourceContentId, targetContentId, relationType, provenanceRef, authorizationRef })
  const row = await mutationStore.loadCreate({ targetContentId, ownerUserId, operationId, idempotencyKey, sourceContentId })
  if (!row) throw new ContentRuntimeError('NOT_FOUND', 404)
  const replay = assertIdempotencyReplay(row, ownerUserId, hash, now)
  if (replay) return replay
  if (row.owner_user_id !== ownerUserId) throw new ContentRuntimeError('PERMISSION_DENIED', 403)
  if (!row.target_id) throw new ContentRuntimeError('NOT_FOUND', 404)
  if (relationType === 'quote-post') {
    if (row.source_content_type !== 'post') throw new ContentRuntimeError('VALIDATION_FAILED', 400)
    if (row.target_content_type !== 'post' || row.target_state !== 'PUBLISHED' || row.target_access_mode !== 'PUBLIC') {
      throw new ContentRuntimeError('NOT_FOUND', 404)
    }
  }
  if (row.active_relationship_id) throw new ContentRuntimeError('CONFLICT', 409)
  const createdAt = now.toISOString()
  const relationship: ContentRelationship = {
    relationshipId: crypto.randomUUID(), sourceType: 'content', sourceId: row.source_id, targetType: 'content',
    targetId: row.target_id, relationType, schemaVersion: 1, status: 'ACTIVE', actorId: ownerUserId,
    provenanceRef, authorizationRef, createdAt, updatedAt: createdAt,
  }
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()
  await mutationStore.create({ ownerUserId, operationId, idempotencyKey, requestHash: hash,
    responseJson: JSON.stringify(relationship), createdAt, expiresAt, relationship })
  return relationship
}


export async function listContentRelationships(
  mutationStore: ContentRelationshipMutationStore,
  contentId: string,
  direction: ContentRelationshipDirection = 'out',
  cursor: string | null = null,
  limit = 20,
): Promise<{ items: PublicContentRelationship[]; nextCursor: string | null; hasMore: boolean }> {
  assertContentId(contentId)
  if (!['out', 'in', 'both'].includes(direction)) throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  return mutationStore.list({ contentId, direction, cursor, limit: relationLimit(limit) })
}


export async function revokeContentRelationship(
  mutationStore: ContentRelationshipMutationStore,
  ownerUserId: string,
  sourceContentId: string,
  relationshipId: string,
  idempotencyKey: string,
  now = new Date(),
): Promise<ContentRelationship> {
  assertContentId(ownerUserId)
  assertContentId(sourceContentId)
  assertContentId(relationshipId)
  if (!idempotencyKey || idempotencyKey.length > 256) throw new ContentRuntimeError('PRECONDITION_REQUIRED', 428)
  const operationId = 'revokeContentRelationship'
  const row = await mutationStore.loadRevoke({ ownerUserId, operationId, idempotencyKey, relationshipId, sourceContentId })
  if (!row) throw new ContentRuntimeError('NOT_FOUND', 404)
  const source = mapRow(row)
  const hash = await relationshipHash(operationId, { ownerUserId, relationshipId })
  const replay = assertIdempotencyReplay(row, ownerUserId, hash, now)
  if (replay) return replay
  if (row.owner_user_id !== ownerUserId) throw new ContentRuntimeError('PERMISSION_DENIED', 403)
  if (row.status !== 'ACTIVE') throw new ContentRuntimeError('INVALID_STATE', 409)
  const updatedAt = now.toISOString()
  const response: ContentRelationship = { ...source, status: 'REVOKED', updatedAt }
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()
  await mutationStore.revoke({ ownerUserId, operationId, idempotencyKey, requestHash: hash,
    responseJson: JSON.stringify(response), updatedAt, expiresAt, relationshipId, sourceContentId })
  return response
}


export interface PostThreadItem {
  id: string;
  slug: string;
  position: number;
  contentType: 'post';
  state: 'DRAFT' | 'PUBLISHED';
  accessMode: 'PUBLIC';
  title: string;
  bodyRef: string;
  mediaRefs: string[];
  coverRef: string | null;
  createdAt: string;
}

export type PostThreadReadRow = Readonly<{
  id: string;
  slug: string;
  position: number;
  state: 'DRAFT' | 'PUBLISHED';
  access_mode: 'PUBLIC';
  title: string;
  body_ref: string;
  media_refs_json: string;
  cover_ref: string | null;
  created_at: string;
}>;

export interface PostThreadReadStore {
  list(
    contentId: string,
    viewerUserId: string | null,
    maxItems: number,
  ): Promise<readonly PostThreadReadRow[]>;
}

export interface AppendPostThreadQueryRow {
  source_id: string;
  source_owner_user_id: string;
  source_content_type: string;
  source_state: string;
  source_access_mode: string;
  target_id: string | null;
  target_owner_user_id: string | null;
  target_content_type: string | null;
  target_state: string | null;
  target_access_mode: string | null;
  idem_id: string | null;
  idem_owner_user_id: string | null;
  idem_request_hash: string | null;
  idem_status: 'IN_PROGRESS' | 'COMPLETED' | null;
  idem_response_json: string | null;
  idem_expires_at: string | null;
}

export interface PostThreadChainStats {
  previous_count: number;
  next_count: number;
  would_cycle: number;
  source_has_next: number;
  target_has_previous: number;
}

/**
 * Append one independently-addressable social post to a thread.
 * The content rows remain canonical W03 posts; only the ordered relationship
 * lives here. Each post can have at most one predecessor and one successor.
 */
export async function appendPostThreadNext(
  mutationStore: ContentRelationshipMutationStore,
  ownerUserIdValue: string,
  sourceContentIdValue: string,
  targetContentIdValue: string,
  idempotencyKey: string,
  now = new Date(),
): Promise<ContentRelationship> {
  const ownerUserId = ownerUserIdValue.trim()
  const sourceContentId = sourceContentIdValue.trim()
  const targetContentId = targetContentIdValue.trim()
  assertContentId(ownerUserId)
  assertContentId(sourceContentId)
  assertContentId(targetContentId)
  if (sourceContentId === targetContentId) throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  if (!idempotencyKey || idempotencyKey.length > 256) throw new ContentRuntimeError('PRECONDITION_REQUIRED', 428)
  const operationId = 'appendPostThreadNext'
  const hash = await relationshipHash(operationId, { ownerUserId, sourceContentId, targetContentId })
  const row = await mutationStore.loadAppend({ targetContentId, ownerUserId, operationId, idempotencyKey, sourceContentId })
  if (!row) throw new ContentRuntimeError('NOT_FOUND', 404)
  const replay = assertIdempotencyReplay(row, ownerUserId, hash, now)
  if (replay) return replay
  if (row.source_owner_user_id !== ownerUserId) throw new ContentRuntimeError('PERMISSION_DENIED', 403)
  if (!row.target_id) throw new ContentRuntimeError('NOT_FOUND', 404)
  if (row.target_owner_user_id !== ownerUserId) throw new ContentRuntimeError('PERMISSION_DENIED', 403)
  if (row.source_content_type !== 'post' || row.target_content_type !== 'post') {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
  if (!['DRAFT', 'PUBLISHED'].includes(row.source_state) || row.target_state === null ||
      !['DRAFT', 'PUBLISHED'].includes(row.target_state) || row.source_access_mode !== 'PUBLIC' ||
      row.target_access_mode !== 'PUBLIC') throw new ContentRuntimeError('INVALID_STATE', 409)
  const stats = await mutationStore.loadAppendStats({ sourceContentId, targetContentId, maxItems: MAX_POST_THREAD_ITEMS })
  if (!stats) throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
  if (stats.source_has_next || stats.target_has_previous) throw new ContentRuntimeError('CONFLICT', 409)
  if (stats.would_cycle) throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  if (stats.previous_count + stats.next_count > MAX_POST_THREAD_ITEMS) throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  const createdAt = now.toISOString()
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()
  const relationship: ContentRelationship = {
    relationshipId: crypto.randomUUID(), sourceType: 'content', sourceId: sourceContentId,
    targetType: 'content', targetId: targetContentId, relationType: 'thread-next', schemaVersion: 1,
    status: 'ACTIVE', actorId: ownerUserId, provenanceRef: null, authorizationRef: null,
    createdAt, updatedAt: createdAt,
  }
  await mutationStore.appendThread({ ownerUserId, operationId, idempotencyKey, requestHash: hash,
    responseJson: JSON.stringify(relationship), createdAt, expiresAt, maxItems: MAX_POST_THREAD_ITEMS, relationship })
  return relationship
}


export async function listPostThread(
  readStore: PostThreadReadStore,
  contentIdValue: string,
  viewerUserIdValue: string | null = null,
): Promise<{ rootContentId: string; items: PostThreadItem[] }> {
  const contentId = contentIdValue.trim()
  assertContentId(contentId)
  const viewerUserId = viewerUserIdValue?.trim() || null
  if (viewerUserId) assertContentId(viewerUserId)
  const rows = await readStore.list(contentId, viewerUserId, MAX_POST_THREAD_ITEMS)
  if (!rows.length) throw new ContentRuntimeError('NOT_FOUND', 404)
  const items = rows.map((row): PostThreadItem => {
    let mediaRefs: unknown
    try { mediaRefs = JSON.parse(row.media_refs_json || '[]') } catch {
      throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
    }
    if (!Array.isArray(mediaRefs) || mediaRefs.some((item) => typeof item !== 'string')) {
      throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
    }
    return {
      id: row.id, slug: row.slug, position: row.position, contentType: 'post', state: row.state,
      accessMode: row.access_mode, title: row.title, bodyRef: row.body_ref, mediaRefs: mediaRefs as string[],
      coverRef: row.cover_ref, createdAt: row.created_at,
    }
  })
  return { rootContentId: items[0].id, items }
}
