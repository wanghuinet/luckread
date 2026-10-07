import { ContentRuntimeError, type ContentD1 } from './content-runtime.js'

export type CollectionState =
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

export interface CollectionRecord {
  id: string
  ownerUserId: string
  creatorId: string
  state: CollectionState
  version: number
  title: string
  description: string
  coverRef: string | null
  etag: string
  createdAt: string
  updatedAt: string
}

interface CollectionRow {
  id: string
  owner_user_id: string
  creator_id: string
  state: CollectionState
  version: number
  title: string
  description: string
  cover_ref: string | null
  etag: string
  created_at: string
  updated_at: string
}

interface IdempotencyRow {
  id: string
  owner_user_id: string
  request_hash: string
  status: 'IN_PROGRESS' | 'COMPLETED'
  response_status: number | null
  response_json: string | null
  expires_at: string
}

interface CollectionWithIdempotencyRow extends CollectionRow {
  idem_id: string | null
  idem_owner_user_id: string | null
  idem_request_hash: string | null
  idem_status: 'IN_PROGRESS' | 'COMPLETED' | null
  idem_response_status: number | null
  idem_response_json: string | null
  idem_expires_at: string | null
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000
const EDITABLE_STATES = new Set<CollectionState>(['DRAFT', 'REJECTED', 'UNPUBLISHED', 'RESTORED'])

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

const toCollection = (row: CollectionRow): CollectionRecord => ({
  id: row.id,
  ownerUserId: row.owner_user_id,
  creatorId: row.creator_id,
  state: row.state,
  version: row.version,
  title: row.title,
  description: row.description,
  coverRef: row.cover_ref,
  etag: row.etag,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const normalizeInput = (input: unknown): {
  title: string
  description: string
  coverRef: string | null
} => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
  const value = input as Record<string, unknown>
  if (
    typeof value.title !== 'string' ||
    value.title.trim().length === 0 ||
    value.title.length > 512 ||
    (value.description !== undefined &&
      (typeof value.description !== 'string' || value.description.length > 4096)) ||
    (value.coverRef !== undefined &&
      value.coverRef !== null &&
      (typeof value.coverRef !== 'string' || value.coverRef.length > 2048))
  ) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
  return {
    title: value.title.trim(),
    description: typeof value.description === 'string' ? value.description.trim() : '',
    coverRef: value.coverRef === undefined || value.coverRef === null
      ? null
      : value.coverRef.trim(),
  }
}

const activeIdempotency = (
  row: {
    idem_id: string | null
    idem_owner_user_id: string | null
    idem_request_hash: string | null
    idem_status: 'IN_PROGRESS' | 'COMPLETED' | null
    idem_response_status: number | null
    idem_response_json: string | null
    idem_expires_at: string | null
  } | null,
  ownerUserId: string,
  hash: string,
  now: Date,
): { replayed: boolean; body: unknown | null; status: number | null } => {
  if (!row?.idem_id || !row.idem_expires_at || Date.parse(row.idem_expires_at) <= now.getTime()) {
    return { replayed: false, body: null, status: null }
  }
  if (row.idem_owner_user_id !== ownerUserId || row.idem_request_hash !== hash) {
    throw new ContentRuntimeError('IDEMPOTENCY_KEY_REUSE_CONFLICT', 422)
  }
  if (row.idem_status === 'IN_PROGRESS') {
    throw new ContentRuntimeError('IDEMPOTENCY_IN_PROGRESS', 409)
  }
  return {
    replayed: true,
    body: parseStored(row.idem_response_json),
    status: row.idem_response_status,
  }
}

const batchMutation = async (db: ContentD1, statements: D1PreparedStatement[]): Promise<void> => {
  try {
    await db.batch(statements)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/unique constraint failed: content_mutation_idempotency./i.test(message)) {
      throw new ContentRuntimeError('IDEMPOTENCY_IN_PROGRESS', 409)
    }
    if (/CHECK constraint failed: successful|content_txn_guard/i.test(message)) {
      throw new ContentRuntimeError('PRECONDITION_FAILED', 412)
    }
    throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
}

const atomicGuard = (db: ContentD1): D1PreparedStatement =>
  db.prepare('INSERT OR REPLACE INTO content_txn_guard(id, successful) VALUES (1, changes())')

const loadIdempotency = async (
  db: ContentD1,
  ownerUserId: string,
  operationId: string,
  idempotencyKey: string,
): Promise<IdempotencyRow | null> =>
  db.prepare(
    'SELECT id, owner_user_id, request_hash, status, response_status, response_json, expires_at ' +
    'FROM content_mutation_idempotency ' +
    'WHERE owner_user_id = ? AND operation_id = ? AND idempotency_key = ? ' +
    'ORDER BY created_at DESC LIMIT 1',
  ).bind(ownerUserId, operationId, idempotencyKey).first<IdempotencyRow>()

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

const insertIdempotency = (
  db: ContentD1,
  ownerUserId: string,
  operationId: string,
  idempotencyKey: string,
  hash: string,
  status: number,
  body: string,
  nowIso: string,
  expiresAt: string,
): D1PreparedStatement =>
  db.prepare(
    'INSERT INTO content_mutation_idempotency ' +
    '(id, owner_user_id, operation_id, idempotency_key, request_hash, status, response_status, response_json, created_at, expires_at) ' +
    "VALUES (?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?)",
  ).bind(
    crypto.randomUUID(), ownerUserId, operationId, idempotencyKey, hash,
    status, body, nowIso, expiresAt,
  )

const listPageSize = (limit: number): number =>
  Math.min(Math.max(Number.isSafeInteger(limit) ? limit : 20, 1), 50)

const parseCursor = (cursor: string | null): { updatedAt: string; id: string } | null => {
  if (!cursor) return null
  try {
    const decoded = JSON.parse(atob(cursor)) as { updatedAt?: unknown; id?: unknown }
    if (typeof decoded.updatedAt !== 'string' || typeof decoded.id !== 'string') {
      throw new Error('invalid cursor')
    }
    return { updatedAt: decoded.updatedAt, id: decoded.id }
  } catch {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
}

const loadCollectionMutation = async (
  db: ContentD1,
  principalUserId: string,
  collectionId: string,
  operationId: string,
  idempotencyKey: string,
): Promise<{ collection: CollectionRecord | null; idempotency: IdempotencyRow | null }> => {
  const row = await db.prepare(
    'SELECT ' +
    's.id, s.owner_user_id, s.creator_id, s.state, s.version, s.title, s.description, ' +
    's.cover_ref, s.etag, s.created_at, s.updated_at, ' +
    'i.id AS idem_id, i.owner_user_id AS idem_owner_user_id, i.request_hash AS idem_request_hash, ' +
    'i.status AS idem_status, i.response_status AS idem_response_status, i.response_json AS idem_response_json, ' +
    'i.expires_at AS idem_expires_at ' +
    'FROM content_collection s ' +
    'LEFT JOIN (SELECT id, owner_user_id, request_hash, status, response_status, response_json, expires_at ' +
    'FROM content_mutation_idempotency WHERE owner_user_id = ? AND operation_id = ? AND idempotency_key = ? ' +
    'ORDER BY created_at DESC LIMIT 1) i ON 1 = 1 ' +
    'WHERE s.id = ? AND s.owner_user_id = ?',
  ).bind(principalUserId, operationId, idempotencyKey, collectionId, principalUserId).first<CollectionWithIdempotencyRow>()

  if (!row) return { collection: null, idempotency: null }
  return {
    collection: toCollection(row),
    idempotency: row.idem_id
      ? {
        id: row.idem_id,
        owner_user_id: row.idem_owner_user_id ?? principalUserId,
        request_hash: row.idem_request_hash ?? '',
        status: row.idem_status ?? 'COMPLETED',
        response_status: row.idem_response_status,
        response_json: row.idem_response_json,
        expires_at: row.idem_expires_at ?? '',
      }
      : null,
  }
}

export async function createCollection(
  db: ContentD1,
  ownerUserId: string,
  input: unknown,
  idempotencyKey: string,
  now = new Date(),
): Promise<CollectionRecord> {
  assertResourceId(ownerUserId)
  if (!idempotencyKey || idempotencyKey.length > 256) {
    throw new ContentRuntimeError('PRECONDITION_REQUIRED', 428)
  }
  const normalized = normalizeInput(input)
  const operationId = 'createCollection'
  const hash = await requestHash(operationId, { ownerUserId, input: normalized })
  const existing = await loadIdempotency(db, ownerUserId, operationId, idempotencyKey)
  const replay = activeIdempotency(existing && {
    idem_id: existing.id,
    idem_owner_user_id: existing.owner_user_id,
    idem_request_hash: existing.request_hash,
    idem_status: existing.status,
    idem_response_status: existing.response_status,
    idem_response_json: existing.response_json,
    idem_expires_at: existing.expires_at,
  }, ownerUserId, hash, now)
  if (replay.replayed) {
    if (!replay.body || typeof replay.body !== 'object') throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
    return replay.body as CollectionRecord
  }
  const collectionId = crypto.randomUUID()
  const createdAt = now.toISOString()
  const collection: CollectionRecord = {
    id: collectionId,
    ownerUserId,
    creatorId: ownerUserId,
    state: 'DRAFT',
    version: 1,
    title: normalized.title,
    description: normalized.description,
    coverRef: normalized.coverRef,
    etag: etagForVersion(1),
    createdAt,
    updatedAt: createdAt,
  }
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()
  await batchMutation(db, [
    expireIdempotency(db, ownerUserId, operationId, idempotencyKey, createdAt),
    insertIdempotency(db, ownerUserId, operationId, idempotencyKey, hash, 201, JSON.stringify(collection), createdAt, expiresAt),
    db.prepare(
      'INSERT INTO content_collection ' +
      '(id, owner_user_id, creator_id, state, version, title, description, cover_ref, etag, created_at, updated_at) ' +
      "VALUES (?, ?, ?, 'DRAFT', 1, ?, ?, ?, ?, ?, ?)",
    ).bind(
      collectionId, ownerUserId, ownerUserId, normalized.title, normalized.description,
      normalized.coverRef, collection.etag, createdAt, createdAt,
    ),
    atomicGuard(db),
  ])
  return collection
}

export async function getCollection(
  db: ContentD1,
  principalUserId: string,
  collectionId: string,
): Promise<CollectionRecord> {
  assertResourceId(principalUserId)
  assertResourceId(collectionId)
  const row = await db.prepare(
    'SELECT id, owner_user_id, creator_id, state, version, title, description, ' +
    'cover_ref, etag, created_at, updated_at FROM content_collection WHERE id = ? AND owner_user_id = ?',
  ).bind(collectionId, principalUserId).first<CollectionRow>()
  if (!row) throw new ContentRuntimeError('NOT_FOUND', 404)
  return toCollection(row)
}

export async function listCreatorCollections(
  db: ContentD1,
  ownerUserId: string,
  cursor: string | null,
  limit: number,
): Promise<{ items: CollectionRecord[]; nextCursor: string | null; hasMore: boolean }> {
  assertResourceId(ownerUserId)
  const pageSize = listPageSize(limit)
  const decoded = parseCursor(cursor)
  const cursorClause = decoded ? 'AND (updated_at < ? OR (updated_at = ? AND id < ?))' : ''
  const bindings: unknown[] = [ownerUserId]
  if (decoded) bindings.push(decoded.updatedAt, decoded.updatedAt, decoded.id)
  bindings.push(pageSize + 1)
  const rows = await db.prepare(
    'SELECT id, owner_user_id, creator_id, state, version, title, description, ' +
    'cover_ref, etag, created_at, updated_at FROM content_collection ' +
    'WHERE owner_user_id = ? ' + cursorClause +
    ' ORDER BY updated_at DESC, id DESC LIMIT ?',
  ).bind(...bindings).all<CollectionRow>()
  const hasMore = rows.results.length > pageSize
  const page = rows.results.slice(0, pageSize).map(toCollection)
  const last = page.at(-1)
  return {
    items: page,
    hasMore,
    nextCursor: hasMore && last
      ? btoa(JSON.stringify({ updatedAt: last.updatedAt, id: last.id }))
      : null,
  }
}

export async function updateCollection(
  db: ContentD1,
  principalUserId: string,
  collectionId: string,
  input: unknown,
  ifMatch: string,
  idempotencyKey: string,
  now = new Date(),
): Promise<CollectionRecord> {
  assertResourceId(principalUserId)
  assertResourceId(collectionId)
  if (!ifMatch || !idempotencyKey) throw new ContentRuntimeError('PRECONDITION_REQUIRED', 428)
  const normalized = normalizeInput(input)
  const operationId = 'updateCollection'
  const hash = await requestHash(operationId, {
    collectionId,
    input: normalized,
    ifMatch: normalizeEtag(ifMatch),
  })
  const loaded = await loadCollectionMutation(db, principalUserId, collectionId, operationId, idempotencyKey)
  const replay = activeIdempotency(loaded.idempotency && {
    idem_id: loaded.idempotency.id,
    idem_owner_user_id: loaded.idempotency.owner_user_id,
    idem_request_hash: loaded.idempotency.request_hash,
    idem_status: loaded.idempotency.status,
    idem_response_status: loaded.idempotency.response_status,
    idem_response_json: loaded.idempotency.response_json,
    idem_expires_at: loaded.idempotency.expires_at,
  }, principalUserId, hash, now)
  if (replay.replayed) {
    if (!replay.body || typeof replay.body !== 'object') throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
    return replay.body as CollectionRecord
  }
  const collection = loaded.collection
  if (!collection) throw new ContentRuntimeError('NOT_FOUND', 404)
  assertEtag(collection.etag, ifMatch)
  if (!EDITABLE_STATES.has(collection.state)) throw new ContentRuntimeError('INVALID_STATE', 409)
  const updatedAt = now.toISOString()
  const nextVersion = collection.version + 1
  const updated: CollectionRecord = {
    ...collection,
    title: normalized.title,
    description: normalized.description,
    coverRef: normalized.coverRef,
    version: nextVersion,
    etag: etagForVersion(nextVersion),
    updatedAt,
  }
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()
  await batchMutation(db, [
    expireIdempotency(db, principalUserId, operationId, idempotencyKey, updatedAt),
    insertIdempotency(db, principalUserId, operationId, idempotencyKey, hash, 200, JSON.stringify(updated), updatedAt, expiresAt),
    db.prepare(
      'UPDATE content_collection SET title = ?, description = ?, cover_ref = ?, version = ?, etag = ?, updated_at = ? ' +
      'WHERE id = ? AND owner_user_id = ? AND version = ? AND etag = ?',
    ).bind(
      updated.title, updated.description, updated.coverRef, updated.version, updated.etag,
      updatedAt, collection.id, principalUserId, collection.version, collection.etag,
    ),
    atomicGuard(db),
  ])
  return updated
}

export async function deleteCollection(
  db: ContentD1,
  principalUserId: string,
  collectionId: string,
  ifMatch: string,
  idempotencyKey: string,
  now = new Date(),
): Promise<void> {
  assertResourceId(principalUserId)
  assertResourceId(collectionId)
  if (!ifMatch || !idempotencyKey) throw new ContentRuntimeError('PRECONDITION_REQUIRED', 428)
  const operationId = 'deleteCollection'
  const hash = await requestHash(operationId, { collectionId, ifMatch: normalizeEtag(ifMatch) })
  const loaded = await loadCollectionMutation(db, principalUserId, collectionId, operationId, idempotencyKey)
  const replay = activeIdempotency(loaded.idempotency && {
    idem_id: loaded.idempotency.id,
    idem_owner_user_id: loaded.idempotency.owner_user_id,
    idem_request_hash: loaded.idempotency.request_hash,
    idem_status: loaded.idempotency.status,
    idem_response_status: loaded.idempotency.response_status,
    idem_response_json: loaded.idempotency.response_json,
    idem_expires_at: loaded.idempotency.expires_at,
  }, principalUserId, hash, now)
  if (replay.replayed) return
  const collection = loaded.collection
  if (!collection) throw new ContentRuntimeError('NOT_FOUND', 404)
  assertEtag(collection.etag, ifMatch)
  if (!['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED'].includes(collection.state)) {
    throw new ContentRuntimeError('INVALID_STATE', 409)
  }
  const updatedAt = now.toISOString()
  const nextVersion = collection.version + 1
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()
  await batchMutation(db, [
    expireIdempotency(db, principalUserId, operationId, idempotencyKey, updatedAt),
    insertIdempotency(db, principalUserId, operationId, idempotencyKey, hash, 204, '', updatedAt, expiresAt),
    db.prepare(
      "UPDATE content_collection SET state = 'DELETED', version = ?, etag = ?, updated_at = ? " +
      'WHERE id = ? AND owner_user_id = ? AND version = ? AND etag = ?',
    ).bind(
      nextVersion, etagForVersion(nextVersion), updatedAt,
      collection.id, principalUserId, collection.version, collection.etag,
    ),
    atomicGuard(db),
  ])
}
