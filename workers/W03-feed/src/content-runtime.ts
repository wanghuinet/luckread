/// <reference types="@cloudflare/workers-types" />

export type ContentState =
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

export type PrincipalLayer = 'L3' | 'L6' | 'L7' | 'L8'

export interface ContentInput {
  title: string
  bodyRef: string
}

export interface ContentRecord {
  id: string
  contentType: 'article'
  ownerUserId: string
  creatorId: string | null
  ipId: string | null
  state: ContentState
  version: number
  revision: number
  title: string
  bodyRef: string
  etag: string
  createdAt: string
  updatedAt: string
}

export interface ContentD1 {
  prepare(query: string): D1PreparedStatement
  batch<T = D1Result<unknown>>(statements: D1PreparedStatement[]): Promise<T[]>
}

interface ContentRow {
  id: string
  content_type: 'article'
  owner_user_id: string
  creator_id: string | null
  ip_id: string | null
  state: ContentState
  version: number
  revision: number
  title: string
  body_ref: string
  etag: string
  created_at: string
  updated_at: string
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

interface ContentWithIdempotencyRow extends ContentRow, IdempotencyRow {}

export class ContentRuntimeError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code)
  }
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000
const PUBLIC_STATES = new Set<ContentState>(['PUBLISHED'])
const EDITABLE_STATES = new Set<ContentState>(['DRAFT', 'REJECTED', 'PENDING_REVIEW'])

const json = (body: unknown, status = 200): Response =>
  Response.json(body, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

const errorResponse = (error: ContentRuntimeError): Response =>
  json({
    error: {
      code: error.code,
      message: publicMessage(error.code),
      details: {},
    },
    requestId: crypto.randomUUID(),
  }, error.status)

const publicMessage = (code: string): string => {
  switch (code) {
    case 'UNAUTHENTICATED': return 'Authentication required'
    case 'PERMISSION_DENIED': return 'Permission denied'
    case 'NOT_FOUND': return 'Content not found'
    case 'PRECONDITION_REQUIRED': return 'If-Match and Idempotency-Key are required'
    case 'PRECONDITION_FAILED': return 'Content has changed'
    case 'INVALID_STATE': return 'Invalid content state transition'
    case 'VALIDATION_FAILED': return 'Invalid content request'
    case 'IDEMPOTENCY_IN_PROGRESS': return 'A matching content mutation is already in progress'
    case 'IDEMPOTENCY_KEY_REUSE_CONFLICT': return 'Idempotency-Key cannot be reused with different input'
    case 'SERVICE_UNAVAILABLE': return 'Content service unavailable'
    default: return 'Content request failed'
  }
}

const toContent = (row: ContentRow): ContentRecord => ({
  id: row.id,
  contentType: row.content_type,
  ownerUserId: row.owner_user_id,
  creatorId: row.creator_id,
  ipId: row.ip_id,
  state: row.state,
  version: row.version,
  revision: row.revision,
  title: row.title,
  bodyRef: row.body_ref,
  etag: row.etag,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export const publicContent = (content: ContentRecord) => ({
  id: content.id,
  state: content.state,
  version: content.version,
  etag: content.etag,
  title: content.title,
  bodyRef: content.bodyRef,
})

const normalizeEtag = (value: string): string => {
  let result = value.trim()
  if (result.startsWith('W/')) result = result.slice(2)
  if (result.startsWith('"') && result.endsWith('"')) result = result.slice(1, -1)
  return result
}

const etagForVersion = (version: number): string => `W/"${version}"`

const assertEtag = (actual: string, expected: string): void => {
  if (normalizeEtag(actual) !== normalizeEtag(expected)) {
    throw new ContentRuntimeError('PRECONDITION_FAILED', 412)
  }
}

const isState = (value: unknown): value is ContentState =>
  typeof value === 'string' && [
    'DRAFT','PENDING_REVIEW','REJECTED','APPROVED','SCHEDULED',
    'PUBLISHED','UNPUBLISHED','ARCHIVED','DELETED','RESTORED',
  ].includes(value)

const assertResourceId = (value: string): void => {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
}

const validateInput = (input: unknown): ContentInput => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
  const candidate = input as { title?: unknown; bodyRef?: unknown }
  if (
    typeof candidate.title !== 'string' ||
    candidate.title.trim().length === 0 ||
    candidate.title.length > 512 ||
    typeof candidate.bodyRef !== 'string' ||
    candidate.bodyRef.trim().length === 0 ||
    candidate.bodyRef.length > 2048
  ) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
  return { title: candidate.title.trim(), bodyRef: candidate.bodyRef.trim() }
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
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const requestHash = async (operationId: string, input: unknown): Promise<string> =>
  sha256Hex(JSON.stringify(canonicalize({ operationId, input })))

const parseResponseJson = (value: string | null): unknown => {
  if (!value) return null
  try { return JSON.parse(value) } catch { return null }
}

const assertIdempotency = (
  row: IdempotencyRow | null,
  ownerUserId: string,
  requestHashValue: string,
): Response | null => {
  if (!row?.idem_id) return null
  if (row.idem_owner_user_id !== ownerUserId) {
    throw new ContentRuntimeError('IDEMPOTENCY_KEY_REUSE_CONFLICT', 422)
  }
  if (row.idem_request_hash !== requestHashValue) {
    throw new ContentRuntimeError('IDEMPOTENCY_KEY_REUSE_CONFLICT', 422)
  }
  if (row.idem_status === 'IN_PROGRESS') {
    throw new ContentRuntimeError('IDEMPOTENCY_IN_PROGRESS', 409)
  }
  const status = row.idem_response_status ?? 200
  return new Response(row.idem_response_json ?? '', {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

const rowFromJoined = (row: ContentWithIdempotencyRow): {
  content: ContentRecord
  idempotency: IdempotencyRow
} => ({
  content: toContent(row),
  idempotency: {
    idem_id: row.idem_id,
    idem_owner_user_id: row.idem_owner_user_id,
    idem_request_hash: row.idem_request_hash,
    idem_status: row.idem_status,
    idem_response_status: row.idem_response_status,
    idem_response_json: row.idem_response_json,
    idem_expires_at: row.idem_expires_at,
  },
})

const purgeExpiredIdempotency = (db: ContentD1, ownerUserId: string, operationId: string, key: string, nowIso: string) =>
  db.prepare(
    `DELETE FROM content_mutation_idempotency
     WHERE owner_user_id = ? AND operation_id = ? AND idempotency_key = ? AND expires_at <= ?`,
  ).bind(ownerUserId, operationId, key, nowIso)

const buildIdempotencyInsert = (
  id: string,
  ownerUserId: string,
  operationId: string,
  key: string,
  requestHashValue: string,
  status: 'COMPLETED',
  responseStatus: number,
  responseJson: string,
  nowIso: string,
  expiresAt: string,
) => dbStatement(
  `INSERT INTO content_mutation_idempotency
    (id, owner_user_id, operation_id, idempotency_key, request_hash, status, response_status, response_json, created_at, expires_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [id, ownerUserId, operationId, key, requestHashValue, status, responseStatus, responseJson, nowIso, expiresAt],
)

const dbStatement = (query: string, args: unknown[]): D1PreparedStatement =>
  (globalThis as unknown as { __contentPrepare?: (query: string, args: unknown[]) => D1PreparedStatement }).__contentPrepare?.(query, args)
    ?? (() => { throw new Error('INTERNAL_PREPARE_UNAVAILABLE') })()

export const makePrepared = (db: ContentD1, query: string, ...args: unknown[]): D1PreparedStatement =>
  db.prepare(query).bind(...args)

const insertOutbox = (
  db: ContentD1,
  eventId: string,
  operationId: string,
  eventType: string,
  contentId: string,
  version: number,
  payload: unknown,
  createdAt: string,
) => makePrepared(
  db,
  `INSERT INTO content_outbox_events
    (event_id, operation_id, event_type, content_id, aggregate_version, payload_json, created_at, published_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
  eventId,
  operationId,
  eventType,
  contentId,
  version,
  JSON.stringify(payload),
  createdAt,
)

export async function getContent(
  db: ContentD1,
  contentId: string,
  principalUserId: string | null,
): Promise<ContentRecord> {
  assertResourceId(contentId)
  const row = await db.prepare(
    `SELECT id, content_type, owner_user_id, creator_id, ip_id, state, version, revision,
            title, body_ref, etag, created_at, updated_at
       FROM contents
      WHERE id = ?
        AND (state = 'PUBLISHED' OR owner_user_id = ?)`,
  ).bind(contentId, principalUserId ?? '').first<ContentRow>()
  if (!row) throw new ContentRuntimeError('NOT_FOUND', 404)
  return toContent(row)
}

export async function listContents(
  db: ContentD1,
  cursor: string | null,
  limit: number,
): Promise<{ items: ContentRecord[]; nextCursor: string | null; hasMore: boolean }> {
  const pageSize = Math.min(Math.max(Number.isSafeInteger(limit) ? limit : 20, 1), 50)
  const decoded = cursor ? decodeCursor(cursor) : null
  const rows = decoded
    ? await db.prepare(
        `SELECT id, content_type, owner_user_id, creator_id, ip_id, state, version, revision,
                title, body_ref, etag, created_at, updated_at
           FROM contents
          WHERE state = 'PUBLISHED'
            AND (updated_at < ? OR (updated_at = ? AND id < ?))
          ORDER BY updated_at DESC, id DESC
          LIMIT ?`,
      ).bind(decoded.updatedAt, decoded.updatedAt, decoded.id, pageSize + 1).all<ContentRow>()
    : await db.prepare(
        `SELECT id, content_type, owner_user_id, creator_id, ip_id, state, version, revision,
                title, body_ref, etag, created_at, updated_at
           FROM contents
          WHERE state = 'PUBLISHED'
          ORDER BY updated_at DESC, id DESC
          LIMIT ?`,
      ).bind(pageSize + 1).all<ContentRow>()

  const hasMore = rows.results.length > pageSize
  const page = rows.results.slice(0, pageSize).map(toContent)
  const last = page.at(-1)
  return {
    items: page,
    hasMore,
    nextCursor: hasMore && last ? encodeCursor(last.updatedAt, last.id) : null,
  }
}

export async function createContent(
  db: ContentD1,
  ownerUserId: string,
  input: unknown,
  idempotencyKey: string,
  now = new Date(),
): Promise<ContentRecord> {
  assertResourceId(ownerUserId)
  if (!idempotencyKey || idempotencyKey.length > 256) {
    throw new ContentRuntimeError('PRECONDITION_REQUIRED', 428)
  }
  const normalized = validateInput(input)
  const operationId = 'createContent'
  const hash = await requestHash(operationId, normalized)
  const existing = await db.prepare(
    `SELECT id AS idem_id, owner_user_id AS idem_owner_user_id, request_hash AS idem_request_hash,
            status AS idem_status, response_status AS idem_response_status, response_json AS idem_response_json,
            expires_at AS idem_expires_at
       FROM content_mutation_idempotency
      WHERE operation_id = ? AND idempotency_key = ?
      ORDER BY created_at DESC
      LIMIT 1`,
  ).bind(operationId, idempotencyKey).first<IdempotencyRow>()
  const replay = assertIdempotency(existing, ownerUserId, hash)
  if (replay) {
    const payload = parseResponseJson(existing?.idem_response_json ?? null)
    if (!payload || typeof payload !== 'object') throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
    const replayContent = await Promise.resolve(payload as ContentRecord)
    return replayContent
  }

  const contentId = crypto.randomUUID()
  const createdAt = now.toISOString()
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()
  const content: ContentRecord = {
    id: contentId,
    contentType: 'article',
    ownerUserId,
    creatorId: ownerUserId,
    ipId: null,
    state: 'DRAFT',
    version: 1,
    revision: 1,
    title: normalized.title,
    bodyRef: normalized.bodyRef,
    etag: etagForVersion(1),
    createdAt,
    updatedAt: createdAt,
  }
  const responseBody = publicContent(content)
  const statements = [
    purgeExpiredIdempotency(db, ownerUserId, operationId, idempotencyKey, createdAt),
    makePrepared(db,
      `INSERT INTO contents
        (id, content_type, owner_user_id, creator_id, ip_id, state, version, revision, title, body_ref, etag, created_at, updated_at)
       VALUES (?, 'article', ?, ?, NULL, 'DRAFT', 1, 1, ?, ?, ?, ?, ?)`,
      content.id, ownerUserId, ownerUserId, normalized.title, normalized.bodyRef, content.etag, createdAt, createdAt),
    insertOutbox(db, crypto.randomUUID(), operationId, 'content.created', content.id, 1, responseBody, createdAt),
    makePrepared(db,
      `INSERT INTO content_mutation_idempotency
        (id, owner_user_id, operation_id, idempotency_key, request_hash, status, response_status, response_json, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, 'COMPLETED', 201, ?, ?, ?)`,
      crypto.randomUUID(), ownerUserId, operationId, idempotencyKey, hash, JSON.stringify(responseBody), createdAt, expiresAt),
  ]
  try {
    await db.batch(statements)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/unique|constraint/i.test(message)) {
      throw new ContentRuntimeError('IDEMPOTENCY_IN_PROGRESS', 409)
    }
    throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  return content
}

const loadMutationRow = async (
  db: ContentD1,
  contentId: string,
  operationId: string,
  idempotencyKey: string,
): Promise<{ content: ContentRecord | null; idempotency: IdempotencyRow }> => {
  const row = await db.prepare(
    `SELECT
        c.id, c.content_type, c.owner_user_id, c.creator_id, c.ip_id, c.state, c.version, c.revision,
        c.title, c.body_ref, c.etag, c.created_at, c.updated_at,
        i.id AS idem_id,
        i.owner_user_id AS idem_owner_user_id,
        i.request_hash AS idem_request_hash,
        i.status AS idem_status,
        i.response_status AS idem_response_status,
        i.response_json AS idem_response_json,
        i.expires_at AS idem_expires_at
       FROM contents c
       LEFT JOIN (
         SELECT id, owner_user_id, request_hash, status, response_status, response_json, expires_at
         FROM content_mutation_idempotency
         WHERE operation_id = ? AND idempotency_key = ?
         ORDER BY created_at DESC
         LIMIT 1
       ) i ON 1 = 1
      WHERE c.id = ?`,
  ).bind(operationId, idempotencyKey, contentId).first<ContentWithIdempotencyRow>()
  if (!row) return { content: null, idempotency: {idem_id:null,idem_owner_user_id:null,idem_request_hash:null,idem_status:null,idem_response_status:null,idem_response_json:null,idem_expires_at:null} }
  return rowFromJoined(row)
}

export async function updateContent(
  db: ContentD1,
  principalUserId: string,
  contentId: string,
  input: unknown,
  ifMatch: string,
  idempotencyKey: string,
  now = new Date(),
): Promise<ContentRecord> {
  assertResourceId(principalUserId)
  assertResourceId(contentId)
  if (!ifMatch || !idempotencyKey) throw new ContentRuntimeError('PRECONDITION_REQUIRED', 428)
  const normalized = validateInput(input)
  const operationId = 'updateContent'
  const hash = await requestHash(operationId, { contentId, input: normalized, ifMatch: normalizeEtag(ifMatch) })
  const { content, idempotency } = await loadMutationRow(db, contentId, operationId, idempotencyKey)
  const replay = assertIdempotency(idempotency, principalUserId, hash)
  if (replay) {
    const payload = parseResponseJson(idempotency.idem_response_json)
    if (!payload) throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
    return payload as ContentRecord
  }
  if (!content) throw new ContentRuntimeError('NOT_FOUND', 404)
  if (content.ownerUserId !== principalUserId) throw new ContentRuntimeError('PERMISSION_DENIED', 403)
  assertEtag(content.etag, ifMatch)
  if (!EDITABLE_STATES.has(content.state)) throw new ContentRuntimeError('INVALID_STATE', 409)

  const nextVersion = content.version + 1
  const nextRevision = content.revision + 1
  const updatedAt = now.toISOString()
  const updated: ContentRecord = {
    ...content,
    title: normalized.title,
    bodyRef: normalized.bodyRef,
    version: nextVersion,
    revision: nextRevision,
    etag: etagForVersion(nextVersion),
    updatedAt,
  }
  const responseBody = publicContent(updated)
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()
  try {
    await db.batch([
      purgeExpiredIdempotency(db, principalUserId, operationId, idempotencyKey, updatedAt),
      makePrepared(db,
        `UPDATE contents
            SET title = ?, body_ref = ?, version = ?, revision = ?, etag = ?, updated_at = ?
          WHERE id = ? AND owner_user_id = ? AND version = ? AND etag = ?`,
        updated.title, updated.bodyRef, nextVersion, nextRevision, updated.etag, updatedAt,
        content.id, principalUserId, content.version, content.etag),
      insertOutbox(db, crypto.randomUUID(), operationId, 'content.updated', updated.id, nextVersion, responseBody, updatedAt),
      makePrepared(db,
        `INSERT INTO content_mutation_idempotency
          (id, owner_user_id, operation_id, idempotency_key, request_hash, status, response_status, response_json, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, 'COMPLETED', 200, ?, ?, ?)`,
        crypto.randomUUID(), principalUserId, operationId, idempotencyKey, hash, JSON.stringify(responseBody), updatedAt, expiresAt),
    ])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/unique|constraint/i.test(message)) throw new ContentRuntimeError('IDEMPOTENCY_IN_PROGRESS', 409)
    throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  return updated
}

export async function deleteContent(
  db: ContentD1,
  principalUserId: string,
  contentId: string,
  ifMatch: string,
  idempotencyKey: string,
  now = new Date(),
): Promise<void> {
  assertResourceId(principalUserId)
  assertResourceId(contentId)
  if (!ifMatch || !idempotencyKey) throw new ContentRuntimeError('PRECONDITION_REQUIRED', 428)
  const operationId = 'deleteContent'
  const hash = await requestHash(operationId, { contentId, ifMatch: normalizeEtag(ifMatch) })
  const { content, idempotency } = await loadMutationRow(db, contentId, operationId, idempotencyKey)
  const replay = assertIdempotency(idempotency, principalUserId, hash)
  if (replay) return
  if (!content) throw new ContentRuntimeError('NOT_FOUND', 404)
  if (content.ownerUserId !== principalUserId) throw new ContentRuntimeError('PERMISSION_DENIED', 403)
  assertEtag(content.etag, ifMatch)
  if (!['DRAFT','PUBLISHED','UNPUBLISHED','ARCHIVED'].includes(content.state)) {
    throw new ContentRuntimeError('INVALID_STATE', 409)
  }
  const updatedAt = now.toISOString()
  const deletedVersion = content.version + 1
  const updatedEtag = etagForVersion(deletedVersion)
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()
  try {
    await db.batch([
      purgeExpiredIdempotency(db, principalUserId, operationId, idempotencyKey, updatedAt),
      makePrepared(db,
        `UPDATE contents SET state='DELETED', version=?, etag=?, updated_at=?
          WHERE id=? AND owner_user_id=? AND version=? AND etag=?`,
        deletedVersion, updatedEtag, updatedAt, content.id, principalUserId, content.version, content.etag),
      insertOutbox(db, crypto.randomUUID(), operationId, 'content.deleted', content.id, deletedVersion, { from: content.state, to: 'DELETED' }, updatedAt),
      makePrepared(db,
        `INSERT INTO content_mutation_idempotency
          (id, owner_user_id, operation_id, idempotency_key, request_hash, status, response_status, response_json, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, 'COMPLETED', 204, '', ?, ?)`,
        crypto.randomUUID(), principalUserId, operationId, idempotencyKey, hash, updatedAt, expiresAt),
    ])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/unique|constraint/i.test(message)) throw new ContentRuntimeError('IDEMPOTENCY_IN_PROGRESS', 409)
    throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
}

const actorKindForLayer = (layer: string): 'CREATOR' | 'MODERATOR' | null =>
  layer === 'L3' ? 'CREATOR' : ['L6','L7','L8'].includes(layer) ? 'MODERATOR' : null

const transitionAllowed = (
  from: ContentState,
  to: ContentState,
  kind: 'CREATOR' | 'MODERATOR',
  owns: boolean,
  reason?: string,
): boolean => {
  if (kind === 'MODERATOR') {
    return (to === 'APPROVED' || to === 'REJECTED') && from === 'PENDING_REVIEW'
  }
  if (!owns) return false
  if (from === 'DRAFT' && to === 'PENDING_REVIEW') return true
  if (from === 'REJECTED' && to === 'DRAFT') return true
  if (from === 'APPROVED' && (to === 'PUBLISHED' || to === 'SCHEDULED')) return to !== 'SCHEDULED'
  if (from === 'SCHEDULED' && to === 'DRAFT') return true
  if (from === 'PUBLISHED' && (to === 'UNPUBLISHED' || to === 'ARCHIVED')) return true
  if (from === 'PUBLISHED' && to === 'PENDING_REVIEW') return reason === 'material_edit_requires_review'
  if (from === 'UNPUBLISHED' && (to === 'PUBLISHED' || to === 'DRAFT')) return true
  if (from === 'ARCHIVED' && to === 'DRAFT') return true
  if (from === 'DELETED' && to === 'RESTORED') return true
  return false
}

export async function transitionContentState(
  db: ContentD1,
  principalUserId: string,
  principalLayer: string,
  contentId: string,
  to: ContentState,
  reason: string | undefined,
  ifMatch: string,
  idempotencyKey: string,
  now = new Date(),
): Promise<{ from: ContentState; to: ContentState; version: number; etag: string }> {
  assertResourceId(principalUserId)
  assertResourceId(contentId)
  if (!isState(to) || !ifMatch || !idempotencyKey) throw new ContentRuntimeError('PRECONDITION_REQUIRED', 428)
  if (principalLayer === 'L0' || principalLayer === 'L1' || principalLayer === 'L2') {
    throw new ContentRuntimeError('PERMISSION_DENIED', 403)
  }
  const kind = actorKindForLayer(principalLayer)
  if (!kind) throw new ContentRuntimeError('PERMISSION_DENIED', 403)

  const operationId = 'transitionContentState'
  const hash = await requestHash(operationId, { contentId, to, reason: reason ?? null, ifMatch: normalizeEtag(ifMatch) })
  const { content, idempotency } = await loadMutationRow(db, contentId, operationId, idempotencyKey)
  const replay = assertIdempotency(idempotency, principalUserId, hash)
  if (replay) {
    const payload = parseResponseJson(idempotency.idem_response_json) as { from: ContentState; to: ContentState; version: number; etag: string } | null
    if (!payload) throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
    return payload
  }
  if (!content) throw new ContentRuntimeError('NOT_FOUND', 404)
  assertEtag(content.etag, ifMatch)
  const owns = content.ownerUserId === principalUserId
  if (!transitionAllowed(content.state, to, kind, owns, reason)) {
    throw new ContentRuntimeError('PERMISSION_DENIED', 403)
  }

  const nextVersion = content.version + 1
  const updatedAt = now.toISOString()
  const result = { from: content.state, to, version: nextVersion, etag: etagForVersion(nextVersion) }
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()
  await db.batch([
    purgeExpiredIdempotency(db, principalUserId, operationId, idempotencyKey, updatedAt),
    makePrepared(db,
      `UPDATE contents SET state=?, version=?, etag=?, updated_at=?
        WHERE id=? AND version=? AND etag=?`,
      to, nextVersion, result.etag, updatedAt, content.id, content.version, content.etag),
    insertOutbox(db, crypto.randomUUID(), operationId, 'content.state_changed', content.id, nextVersion, result, updatedAt),
    makePrepared(db,
      `INSERT INTO content_mutation_idempotency
        (id, owner_user_id, operation_id, idempotency_key, request_hash, status, response_status, response_json, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, 'COMPLETED', 200, ?, ?, ?)`,
      crypto.randomUUID(), principalUserId, operationId, idempotencyKey, hash, JSON.stringify(result), updatedAt, expiresAt),
  ])
  return result
}

export function encodeCursor(updatedAt: string, id: string): string {
  const raw = JSON.stringify({ updatedAt, id })
  return btoa(String.fromCharCode(...new TextEncoder().encode(raw)))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

export function decodeCursor(value: string): { updatedAt: string; id: string } {
  try {
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
    const bytes = Uint8Array.from(atob(padded), char => char.charCodeAt(0))
    const decoded = JSON.parse(new TextDecoder().decode(bytes)) as { updatedAt?: unknown; id?: unknown }
    if (typeof decoded.updatedAt !== 'string' || typeof decoded.id !== 'string') throw new Error('INVALID')
    assertResourceId(decoded.id)
    if (!Number.isFinite(Date.parse(decoded.updatedAt))) throw new Error('INVALID')
    return { updatedAt: decoded.updatedAt, id: decoded.id }
  } catch {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
}

export function toErrorResponse(error: unknown): Response {
  if (error instanceof ContentRuntimeError) return errorResponse(error)
  return errorResponse(new ContentRuntimeError('SERVICE_UNAVAILABLE', 503))
}
