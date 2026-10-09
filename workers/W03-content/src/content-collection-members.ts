import { ContentRuntimeError, type ContentD1 } from './content-runtime.js'

type CollectionState =
  | 'DRAFT'
  | 'PENDING_REVIEW'
  | 'REJECTED'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'PUBLISHED'
  | 'UNPUBLISHED'
  | 'ARCHIVED'
  | 'DELETED'
  | 'RESTORED'

export interface CollectionMemberRecord {
  relationshipId: string
  collectionId: string
  contentId: string
  contentSlug: string
  contentType: 'article' | 'post' | 'video'
  contentState: string
  title: string
  position: number
  createdAt: string
  updatedAt: string
}

interface IdempotencyRow {
  idem_id: string | null
  idem_owner_user_id: string | null
  idem_request_hash: string | null
  idem_status: 'IN_PROGRESS' | 'COMPLETED' | null
  idem_response_status: number | null
  idem_response_json: string | null
  idem_expires_at: string | null
}

interface MutationRow {
  collection_id: string
  collection_owner_user_id: string
  collection_state: CollectionState
  collection_version: number
  collection_etag: string
  content_id: string
  content_owner_user_id: string
  content_slug: string
  content_type: 'article' | 'post' | 'video'
  content_state: string
  content_title: string
  idem_id: string | null
  idem_owner_user_id: string | null
  idem_request_hash: string | null
  idem_status: 'IN_PROGRESS' | 'COMPLETED' | null
  idem_response_status: number | null
  idem_response_json: string | null
  idem_expires_at: string | null
  membership_relationship_id: string | null
  membership_position: number | null
  membership_created_at: string | null
  membership_updated_at: string | null
  next_position: number
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000
const EDITABLE_COLLECTION_STATES = new Set<CollectionState>([
  'DRAFT',
  'REJECTED',
  'UNPUBLISHED',
  'RESTORED',
])

const normalizeEtag = (value: string): string => {
  let result = value.trim()
  if (result.startsWith('W/')) result = result.slice(2)
  if (result.startsWith('"') && result.endsWith('"')) result = result.slice(1, -1)
  return result
}

const etagForVersion = (version: number): string => 'W/"' + version + '"'

const assertResourceId = (value: string): void => {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
}

const assertEtag = (actual: string, expected: string): void => {
  if (normalizeEtag(actual) !== normalizeEtag(expected)) {
    throw new ContentRuntimeError('PRECONDITION_FAILED', 412)
  }
}

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    )
  }
  return value
}

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

const requestHash = async (operationId: string, input: unknown): Promise<string> =>
  sha256Hex(JSON.stringify(canonicalize({ operationId, input })))

const parseStored = (value: string | null): unknown => {
  if (!value) return null
  try { return JSON.parse(value) } catch { return null }
}

const inspectIdempotency = (
  row: IdempotencyRow | null,
  ownerUserId: string,
  hash: string,
  now: Date,
): { replayed: boolean; body: unknown | null } => {
  if (!row?.idem_id || !row.idem_expires_at || Date.parse(row.idem_expires_at) <= now.getTime()) {
    return { replayed: false, body: null }
  }
  if (row.idem_owner_user_id !== ownerUserId || row.idem_request_hash !== hash) {
    throw new ContentRuntimeError('IDEMPOTENCY_KEY_REUSE_CONFLICT', 422)
  }
  if (row.idem_status === 'IN_PROGRESS') {
    throw new ContentRuntimeError('IDEMPOTENCY_IN_PROGRESS', 409)
  }
  return { replayed: true, body: parseStored(row.idem_response_json) }
}

const batchMutation = async (db: ContentD1, statements: D1PreparedStatement[]): Promise<void> => {
  try {
    await db.batch(statements)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/unique constraint failed: content_mutation_idempotency\./i.test(message)) {
      throw new ContentRuntimeError('IDEMPOTENCY_IN_PROGRESS', 409)
    }
    if (/unique constraint failed: content_relationships\./i.test(message)) {
      throw new ContentRuntimeError('CONFLICT', 409)
    }
    if (/CHECK constraint failed: successful|content_txn_guard/i.test(message)) {
      throw new ContentRuntimeError('PRECONDITION_FAILED', 412)
    }
    throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
}

const atomicGuard = (db: ContentD1): D1PreparedStatement =>
  db.prepare('INSERT OR REPLACE INTO content_txn_guard(id, successful) VALUES (1, changes())')

const insertIdempotency = (
  db: ContentD1,
  ownerUserId: string,
  operationId: string,
  idempotencyKey: string,
  hash: string,
  responseStatus: number,
  responseJson: string,
  nowIso: string,
  expiresAt: string,
): D1PreparedStatement =>
  db.prepare(
    'INSERT INTO content_mutation_idempotency ' +
    '(id, owner_user_id, operation_id, idempotency_key, request_hash, status, response_status, response_json, created_at, expires_at) ' +
    "VALUES (?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?)",
  ).bind(
    crypto.randomUUID(),
    ownerUserId,
    operationId,
    idempotencyKey,
    hash,
    responseStatus,
    responseJson,
    nowIso,
    expiresAt,
  )

const expireIdempotency = (
  db: ContentD1,
  ownerUserId: string,
  operationId: string,
  idempotencyKey: string,
  nowIso: string,
): D1PreparedStatement =>
  db.prepare(
    'DELETE FROM content_mutation_idempotency ' +
    'WHERE owner_user_id = ? AND operation_id = ? AND idempotency_key = ? AND expires_at <= ?',
  ).bind(ownerUserId, operationId, idempotencyKey, nowIso)

const loadMutation = async (
  db: ContentD1,
  ownerUserId: string,
  collectionId: string,
  contentId: string,
  operationId: string,
  idempotencyKey: string,
): Promise<MutationRow | null> =>
  db.prepare(
    'SELECT ' +
    'coll.id AS collection_id, coll.owner_user_id AS collection_owner_user_id, coll.state AS collection_state, coll.version AS collection_version, coll.etag AS collection_etag, ' +
    'c.id AS content_id, c.owner_user_id AS content_owner_user_id, c.slug AS content_slug, c.content_type AS content_type, c.state AS content_state, c.title AS content_title, ' +
    'i.id AS idem_id, i.owner_user_id AS idem_owner_user_id, i.request_hash AS idem_request_hash, ' +
    'i.status AS idem_status, i.response_status AS idem_response_status, i.response_json AS idem_response_json, i.expires_at AS idem_expires_at, ' +
    'r.relationship_id AS membership_relationship_id, r.position AS membership_position, ' +
    'r.created_at AS membership_created_at, r.updated_at AS membership_updated_at, ' +
    'COALESCE((SELECT MAX(r2.position) + 1 FROM content_relationships r2 ' +
    "WHERE r2.target_id = coll.id AND r2.target_type = 'collection' AND r2.relation_type = 'collection-member' AND r2.status = 'ACTIVE'), 0) AS next_position " +
    'FROM content_collections coll ' +
    'JOIN contents c ON c.id = ? ' +
    'LEFT JOIN (' +
      'SELECT id, owner_user_id, request_hash, status, response_status, response_json, expires_at ' +
      'FROM content_mutation_idempotency ' +
      'WHERE owner_user_id = ? AND operation_id = ? AND idempotency_key = ? ' +
      'ORDER BY created_at DESC LIMIT 1' +
    ') i ON 1 = 1 ' +
    'LEFT JOIN content_relationships r ON ' +
      "r.source_type = 'content' AND r.source_id = c.id AND r.target_type = 'collection' AND r.target_id = coll.id " +
      "AND r.relation_type = 'collection-member' AND r.status = 'ACTIVE' " +
    'WHERE coll.id = ? AND coll.owner_user_id = ?',
  ).bind(
    contentId,
    ownerUserId,
    operationId,
    idempotencyKey,
    collectionId,
    ownerUserId,
  ).first<MutationRow>()

const assertCollectionEditable = (state: CollectionState): void => {
  if (!EDITABLE_COLLECTION_STATES.has(state)) {
    throw new ContentRuntimeError('INVALID_STATE', 409)
  }
}

const toMember = (row: {
  relationship_id: string
  collection_id: string
  content_id: string
  content_slug: string
  content_type: 'article' | 'post' | 'video'
  content_state: string
  content_title: string
  position: number
  created_at: string
  updated_at: string
}): CollectionMemberRecord => ({
  relationshipId: row.relationship_id,
  collectionId: row.collection_id,
  contentId: row.content_id,
  contentSlug: row.content_slug,
  contentType: row.content_type,
  contentState: row.content_state,
  title: row.content_title,
  position: row.position,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export async function attachCollectionMember(
  db: ContentD1,
  ownerUserId: string,
  collectionId: string,
  input: unknown,
  ifMatch: string,
  idempotencyKey: string,
  now = new Date(),
): Promise<{ member: CollectionMemberRecord; collectionVersion: number; collectionEtag: string }> {
  assertResourceId(ownerUserId)
  assertResourceId(collectionId)
  if (!ifMatch || !idempotencyKey) throw new ContentRuntimeError('PRECONDITION_REQUIRED', 428)
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
  const contentId = typeof (input as Record<string, unknown>).contentId === 'string'
    ? String((input as Record<string, unknown>).contentId).trim()
    : ''
  assertResourceId(contentId)

  const operationId = 'attachCollectionMember'
  const hash = await requestHash(operationId, {
    collectionId,
    contentId,
    ifMatch: normalizeEtag(ifMatch),
  })
  const row = await loadMutation(db, ownerUserId, collectionId, contentId, operationId, idempotencyKey)
  if (!row) throw new ContentRuntimeError('NOT_FOUND', 404)

  const replay = inspectIdempotency(row, ownerUserId, hash, now)
  if (replay.replayed) {
    if (!replay.body || typeof replay.body !== 'object') throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
    return replay.body as { member: CollectionMemberRecord; collectionVersion: number; collectionEtag: string }
  }

  if (row.collection_owner_user_id !== ownerUserId) throw new ContentRuntimeError('PERMISSION_DENIED', 403)
  if (row.content_owner_user_id !== row.collection_owner_user_id) throw new ContentRuntimeError('PERMISSION_DENIED', 403)
    if (row.idem_owner_user_id && row.idem_owner_user_id !== ownerUserId) {
    throw new ContentRuntimeError('IDEMPOTENCY_KEY_REUSE_CONFLICT', 422)
  }
  assertCollectionEditable(row.collection_state)
  if (row.idem_request_hash && row.idem_request_hash !== hash) {
    throw new ContentRuntimeError('IDEMPOTENCY_KEY_REUSE_CONFLICT', 422)
  }
  assertEtag(row.collection_etag, ifMatch)
  if (row.membership_relationship_id) throw new ContentRuntimeError('CONFLICT', 409)
  if (row.collection_state === 'DELETED') throw new ContentRuntimeError('INVALID_STATE', 409)

  const nowIso = now.toISOString()
  const nextVersion = row.collection_version + 1
  const collectionEtag = etagForVersion(nextVersion)
  const member: CollectionMemberRecord = {
    relationshipId: crypto.randomUUID(),
    collectionId,
    contentId,
    contentSlug: row.content_slug,
    contentType: row.content_type,
    contentState: row.content_state,
    title: row.content_title,
    position: row.next_position,
    createdAt: nowIso,
    updatedAt: nowIso,
  }
  const response = { member, collectionVersion: nextVersion, collectionEtag }
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()

  await batchMutation(db, [
    expireIdempotency(db, ownerUserId, operationId, idempotencyKey, nowIso),
    insertIdempotency(
      db,
      ownerUserId,
      operationId,
      idempotencyKey,
      hash,
      200,
      JSON.stringify(response),
      nowIso,
      expiresAt,
    ),
    db.prepare(
      'UPDATE content_collections SET version = ?, etag = ?, updated_at = ? ' +
      'WHERE id = ? AND owner_user_id = ? AND version = ? AND etag = ?',
    ).bind(
      nextVersion,
      collectionEtag,
      nowIso,
      collectionId,
      ownerUserId,
      row.collection_version,
      row.collection_etag,
    ),
    atomicGuard(db),
    db.prepare(
      'INSERT INTO content_relationships ' +
      '(relationship_id, source_type, source_id, target_type, target_id, relation_type, position, schema_version, status, actor_id, provenance_ref, authorization_ref, created_at, updated_at) ' +
      "VALUES (?, 'content', ?, 'collection', ?, 'collection-member', ?, 1, 'ACTIVE', ?, NULL, NULL, ?, ?)",
    ).bind(
      member.relationshipId,
      contentId,
      collectionId,
      member.position,
      ownerUserId,
      nowIso,
      nowIso,
    ),
  ])

  return response
}

export async function listCollectionMembers(
  db: ContentD1,
  ownerUserId: string,
  collectionId: string,
  cursor: string | null,
  limit: number,
): Promise<{
  items: CollectionMemberRecord[]
  nextCursor: string | null
  hasMore: boolean
  collectionVersion: number
  collectionEtag: string
}> {
  assertResourceId(ownerUserId)
  assertResourceId(collectionId)
  const pageSize = Math.min(Math.max(Number.isSafeInteger(limit) ? limit : 20, 1), 100)

  let decoded: { position: number; id: string } | null = null
  if (cursor) {
    try {
      const value = JSON.parse(atob(cursor)) as { position?: unknown; id?: unknown }
      if (!Number.isSafeInteger(value.position) || typeof value.id !== 'string') throw new Error('invalid cursor')
      decoded = { position: Number(value.position), id: value.id }
    } catch {
      throw new ContentRuntimeError('VALIDATION_FAILED', 400)
    }
  }

  const collection = await db.prepare(
    'SELECT id, version, etag FROM content_collections WHERE id = ? AND owner_user_id = ?',
  ).bind(collectionId, ownerUserId).first<{ id: string; version: number; etag: string }>()
  if (!collection) throw new ContentRuntimeError('NOT_FOUND', 404)

  const cursorClause = decoded
    ? 'AND (r.position > ? OR (r.position = ? AND r.relationship_id > ?))'
    : ''
  const bindings: unknown[] = [collectionId]
  if (decoded) bindings.push(decoded.position, decoded.position, decoded.id)
  bindings.push(pageSize + 1)

  const rows = await db.prepare(
    'SELECT r.relationship_id, r.position, r.created_at, r.updated_at, ' +
    'r.target_id AS collection_id, c.id AS content_id, c.slug AS content_slug, ' +
    'c.content_type, c.state AS content_state, c.title AS content_title ' +
    'FROM content_relationships r ' +
    'JOIN contents c ON c.id = r.source_id ' +
    "WHERE r.source_type = 'content' AND r.target_type = 'collection' AND r.relation_type = 'collection-member' " +
    "AND r.target_id = ? AND r.status = 'ACTIVE' " +
    cursorClause +
    'ORDER BY r.position ASC, r.relationship_id ASC LIMIT ?',
  ).bind(...bindings).all<{
    relationship_id: string
    position: number
    created_at: string
    updated_at: string
    collection_id: string
    content_id: string
    content_slug: string
    content_type: 'article' | 'post' | 'video'
    content_state: string
    content_title: string
  }>()

  const hasMore = rows.results.length > pageSize
  const page = rows.results.slice(0, pageSize).map(toMember)
  const last = page.at(-1)
  return {
    items: page,
    hasMore,
    nextCursor: hasMore && last
      ? btoa(JSON.stringify({ position: last.position, id: last.relationshipId }))
      : null,
    collectionVersion: collection.version,
    collectionEtag: collection.etag,
  }
}

export async function removeCollectionMember(
  db: ContentD1,
  ownerUserId: string,
  collectionId: string,
  contentId: string,
  ifMatch: string,
  idempotencyKey: string,
  now = new Date(),
): Promise<{ member: CollectionMemberRecord; collectionVersion: number; collectionEtag: string }> {
  assertResourceId(ownerUserId)
  assertResourceId(collectionId)
  assertResourceId(contentId)
  if (!ifMatch || !idempotencyKey) throw new ContentRuntimeError('PRECONDITION_REQUIRED', 428)

  const operationId = 'removeCollectionMember'
  const hash = await requestHash(operationId, {
    collectionId,
    contentId,
    ifMatch: normalizeEtag(ifMatch),
  })
  const row = await loadMutation(db, ownerUserId, collectionId, contentId, operationId, idempotencyKey)
  if (!row) throw new ContentRuntimeError('NOT_FOUND', 404)

  const replay = inspectIdempotency(row, ownerUserId, hash, now)
  if (replay.replayed) {
    if (!replay.body || typeof replay.body !== 'object') throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
    return replay.body as { member: CollectionMemberRecord; collectionVersion: number; collectionEtag: string }
  }

  if (!row.membership_relationship_id || row.membership_position === null) {
    throw new ContentRuntimeError('NOT_FOUND', 404)
  }
  assertCollectionEditable(row.collection_state)
  assertEtag(row.collection_etag, ifMatch)

  const nowIso = now.toISOString()
  const nextVersion = row.collection_version + 1
  const collectionEtag = etagForVersion(nextVersion)
  const member = {
    relationshipId: row.membership_relationship_id,
    collectionId,
    contentId,
    contentSlug: row.content_slug,
    contentType: row.content_type,
    contentState: row.content_state,
    title: row.content_title,
    position: row.membership_position,
    createdAt: row.membership_created_at ?? nowIso,
    updatedAt: nowIso,
  }
  const response = { member, collectionVersion: nextVersion, collectionEtag }
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()

  await batchMutation(db, [
    expireIdempotency(db, ownerUserId, operationId, idempotencyKey, nowIso),
    insertIdempotency(db, ownerUserId, operationId, idempotencyKey, hash, 200, JSON.stringify(response), nowIso, expiresAt),
    db.prepare(
      'UPDATE content_collections SET version = ?, etag = ?, updated_at = ? ' +
      'WHERE id = ? AND owner_user_id = ? AND version = ? AND etag = ?',
    ).bind(nextVersion, collectionEtag, nowIso, collectionId, ownerUserId, row.collection_version, row.collection_etag),
    atomicGuard(db),
    db.prepare(
      "UPDATE content_relationships SET status = 'REVOKED', updated_at = ? WHERE relationship_id = ? AND status = 'ACTIVE'",
    ).bind(nowIso, row.membership_relationship_id),
    atomicGuard(db),
  ])

  return response
}

export async function reorderCollectionMember(
  db: ContentD1,
  ownerUserId: string,
  collectionId: string,
  contentId: string,
  position: number,
  ifMatch: string,
  idempotencyKey: string,
  now = new Date(),
): Promise<{ member: CollectionMemberRecord; collectionVersion: number; collectionEtag: string }> {
  assertResourceId(ownerUserId)
  assertResourceId(collectionId)
  assertResourceId(contentId)
  if (!Number.isSafeInteger(position) || position < 0 || position > 1000000) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
  if (!ifMatch || !idempotencyKey) throw new ContentRuntimeError('PRECONDITION_REQUIRED', 428)

  const operationId = 'reorderCollectionMember'
  const hash = await requestHash(operationId, {
    collectionId,
    contentId,
    position,
    ifMatch: normalizeEtag(ifMatch),
  })
  const row = await loadMutation(db, ownerUserId, collectionId, contentId, operationId, idempotencyKey)
  if (!row) throw new ContentRuntimeError('NOT_FOUND', 404)

  const replay = inspectIdempotency(row, ownerUserId, hash, now)
  if (replay.replayed) {
    if (!replay.body || typeof replay.body !== 'object') throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
    return replay.body as { member: CollectionMemberRecord; collectionVersion: number; collectionEtag: string }
  }

  if (!row.membership_relationship_id || row.membership_position === null) {
    throw new ContentRuntimeError('NOT_FOUND', 404)
  }
  assertCollectionEditable(row.collection_state)
  assertEtag(row.collection_etag, ifMatch)

  const rows = await db.prepare(
    'SELECT relationship_id, source_id, position, created_at, updated_at ' +
    'FROM content_relationships ' +
    "WHERE target_type = 'collection' AND target_id = ? AND relation_type = 'collection-member' AND status = 'ACTIVE' " +
    'ORDER BY position ASC, relationship_id ASC',
  ).bind(collectionId).all<{
    relationship_id: string
    source_id: string
    position: number
    created_at: string
    updated_at: string
  }>()

  const members = rows.results
  const currentIndex = members.findIndex(item => item.source_id === contentId)
  if (currentIndex < 0) throw new ContentRuntimeError('NOT_FOUND', 404)
  if (position >= members.length) throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  if (position === currentIndex) {
    const member = {
      relationshipId: row.membership_relationship_id,
      collectionId,
      contentId,
      contentSlug: row.content_slug,
      contentType: row.content_type,
      contentState: row.content_state,
      title: row.content_title,
      position: currentIndex,
      createdAt: row.membership_created_at ?? now.toISOString(),
      updatedAt: row.membership_updated_at ?? now.toISOString(),
    }
    return { member, collectionVersion: row.collection_version, collectionEtag: row.collection_etag }
  }

  const reordered = [...members]
  const [selected] = reordered.splice(currentIndex, 1)
  reordered.splice(position, 0, selected)
  const newPositions = new Map(reordered.map((item, index) => [item.relationship_id, index]))

  const nowIso = now.toISOString()
  const nextVersion = row.collection_version + 1
  const collectionEtag = etagForVersion(nextVersion)
  const selectedPosition = newPositions.get(row.membership_relationship_id)
  if (selectedPosition === undefined) throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)

  const member = {
    relationshipId: row.membership_relationship_id,
    collectionId,
    contentId,
    contentSlug: row.content_slug,
    contentType: row.content_type,
    contentState: row.content_state,
    title: row.content_title,
    position: selectedPosition,
    createdAt: row.membership_created_at ?? nowIso,
    updatedAt: nowIso,
  }
  const response = { member, collectionVersion: nextVersion, collectionEtag }
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()
  const tempOffset = members.length + 1

  const mutations: D1PreparedStatement[] = [
    expireIdempotency(db, ownerUserId, operationId, idempotencyKey, nowIso),
    insertIdempotency(db, ownerUserId, operationId, idempotencyKey, hash, 200, JSON.stringify(response), nowIso, expiresAt),
    db.prepare(
      'UPDATE content_collections SET version = ?, etag = ?, updated_at = ? ' +
      'WHERE id = ? AND owner_user_id = ? AND version = ? AND etag = ?',
    ).bind(nextVersion, collectionEtag, nowIso, collectionId, ownerUserId, row.collection_version, row.collection_etag),
    atomicGuard(db),
    db.prepare(
      'UPDATE content_relationships SET position = position + ? ' +
      "WHERE target_type = 'collection' AND target_id = ? AND relation_type = 'collection-member' AND status = 'ACTIVE'",
    ).bind(tempOffset, collectionId),
  ]

  for (const item of members) {
    const nextPosition = newPositions.get(item.relationship_id)
    if (nextPosition === undefined) throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
    mutations.push(
      db.prepare(
        'UPDATE content_relationships SET position = ?, updated_at = ? WHERE relationship_id = ?',
      ).bind(nextPosition, nowIso, item.relationship_id),
    )
  }

  mutations.push(
    atomicGuard(db),
  )

  await batchMutation(db, mutations)
  return response
}
