import { ContentRuntimeError, decodeScopedCursor, encodeScopedCursor } from './content-runtime.js'

export type SeriesState =
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

export interface SeriesRecord {
  id: string
  ownerUserId: string
  creatorId: string
  ipId: string | null
  state: SeriesState
  version: number
  title: string
  description: string
  coverRef: string | null
  etag: string
  createdAt: string
  updatedAt: string
}

export type SeriesListCursor = Readonly<{
  updatedAt: string
  id: string
}>

export interface SeriesReadStore {
  getSeries(ownerUserId: string, seriesId: string): Promise<SeriesRecord | null>
  listCreatorSeries(
    ownerUserId: string,
    cursor: SeriesListCursor | null,
    limit: number,
  ): Promise<readonly SeriesRecord[]>
}

export interface IdempotencyRow {
  id: string
  owner_user_id: string
  request_hash: string
  status: 'IN_PROGRESS' | 'COMPLETED'
  response_status: number | null
  response_json: string | null
  expires_at: string
}

export interface SeriesCreateStore {
  loadIdempotency(
    ownerUserId: string,
    operationId: string,
    idempotencyKey: string,
  ): Promise<IdempotencyRow | null>
  create(input: Readonly<{
    ownerUserId: string
    operationId: string
    idempotencyKey: string
    requestHash: string
    responseJson: string
    createdAt: string
    expiresAt: string
    series: SeriesRecord
  }>): Promise<void>
}

export interface SeriesMutationSnapshot {
  series: SeriesRecord | null
  idempotency: IdempotencyRow | null
}

export interface SeriesUpdateStore {
  loadMutation(
    ownerUserId: string,
    seriesId: string,
    operationId: string,
    idempotencyKey: string,
  ): Promise<SeriesMutationSnapshot>
  update(input: Readonly<{
    ownerUserId: string
    operationId: string
    idempotencyKey: string
    requestHash: string
    responseJson: string
    updatedAt: string
    expiresAt: string
    series: SeriesRecord
    expectedVersion: number
    expectedEtag: string
  }>): Promise<void>
}

export interface SeriesDeleteStore {
  loadMutation(
    ownerUserId: string,
    seriesId: string,
    operationId: string,
    idempotencyKey: string,
  ): Promise<SeriesMutationSnapshot>
  delete(input: Readonly<{
    ownerUserId: string
    operationId: string
    idempotencyKey: string
    requestHash: string
    deletedAt: string
    expiresAt: string
    seriesId: string
    nextVersion: number
    nextEtag: string
    expectedVersion: number
    expectedEtag: string
  }>): Promise<void>
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000
const EDITABLE_STATES = new Set<SeriesState>(['DRAFT', 'REJECTED', 'UNPUBLISHED', 'RESTORED'])

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

const listPageSize = (limit: number): number =>
  Math.min(Math.max(Number.isSafeInteger(limit) ? limit : 20, 1), 50)

export async function createSeries(
  createStore: SeriesCreateStore, ownerUserId: string, input: unknown, idempotencyKey: string, now = new Date(),
): Promise<SeriesRecord> {
  assertResourceId(ownerUserId)
  if (!idempotencyKey || idempotencyKey.length > 256) throw new ContentRuntimeError('PRECONDITION_REQUIRED', 428)
  const normalized = normalizeInput(input)
  const operationId = 'createSeries'
  const hash = await requestHash(operationId, { ownerUserId, input: normalized })
  const existing = await createStore.loadIdempotency(ownerUserId, operationId, idempotencyKey)
  const replay = activeIdempotency(existing && {
    idem_id: existing.id, idem_owner_user_id: existing.owner_user_id, idem_request_hash: existing.request_hash,
    idem_status: existing.status, idem_response_status: existing.response_status,
    idem_response_json: existing.response_json, idem_expires_at: existing.expires_at,
  }, ownerUserId, hash, now)
  if (replay.replayed) {
    if (!replay.body || typeof replay.body !== 'object') throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
    return replay.body as SeriesRecord
  }
  const createdAt = now.toISOString()
  const series: SeriesRecord = {
    id: crypto.randomUUID(), ownerUserId, creatorId: ownerUserId, ipId: null, state: 'DRAFT',
    version: 1, title: normalized.title, description: normalized.description, coverRef: normalized.coverRef,
    etag: etagForVersion(1), createdAt, updatedAt: createdAt,
  }
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()
  await createStore.create({ ownerUserId, operationId, idempotencyKey, requestHash: hash,
    responseJson: JSON.stringify(series), createdAt, expiresAt, series })
  return series
}


export async function getSeries(
  readStore: SeriesReadStore, principalUserId: string, seriesId: string,
): Promise<SeriesRecord> {
  assertResourceId(principalUserId)
  assertResourceId(seriesId)
  const series = await readStore.getSeries(principalUserId, seriesId)
  if (!series) throw new ContentRuntimeError('NOT_FOUND', 404)
  return series
}


export async function listCreatorSeries(
  readStore: SeriesReadStore, ownerUserId: string, cursor: string | null, limit: number,
): Promise<{ items: SeriesRecord[]; nextCursor: string | null; hasMore: boolean }> {
  assertResourceId(ownerUserId)
  const pageSize = listPageSize(limit)
  const cursorScope = JSON.stringify({ type: 'creator-series', ownerUserId })
  const decoded = cursor ? decodeScopedCursor(cursor, cursorScope) : null
  const rows = await readStore.listCreatorSeries(ownerUserId, decoded, pageSize + 1)
  const hasMore = rows.length > pageSize
  const page = rows.slice(0, pageSize)
  const last = page.at(-1)
  return { items: [...page], hasMore,
    nextCursor: hasMore && last ? encodeScopedCursor(last.updatedAt, last.id, cursorScope) : null }
}


export async function updateSeries(
  updateStore: SeriesUpdateStore, principalUserId: string, seriesId: string, input: unknown,
  ifMatch: string, idempotencyKey: string, now = new Date(),
): Promise<SeriesRecord> {
  assertResourceId(principalUserId)
  assertResourceId(seriesId)
  if (!ifMatch || !idempotencyKey) throw new ContentRuntimeError('PRECONDITION_REQUIRED', 428)
  const normalized = normalizeInput(input)
  const operationId = 'updateSeries'
  const hash = await requestHash(operationId, { seriesId, input: normalized, ifMatch: normalizeEtag(ifMatch) })
  const loaded = await updateStore.loadMutation(principalUserId, seriesId, operationId, idempotencyKey)
  const replay = activeIdempotency(loaded.idempotency && {
    idem_id: loaded.idempotency.id, idem_owner_user_id: loaded.idempotency.owner_user_id,
    idem_request_hash: loaded.idempotency.request_hash, idem_status: loaded.idempotency.status,
    idem_response_status: loaded.idempotency.response_status, idem_response_json: loaded.idempotency.response_json,
    idem_expires_at: loaded.idempotency.expires_at,
  }, principalUserId, hash, now)
  if (replay.replayed) {
    if (!replay.body || typeof replay.body !== 'object') throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
    return replay.body as SeriesRecord
  }
  const series = loaded.series
  if (!series) throw new ContentRuntimeError('NOT_FOUND', 404)
  assertEtag(series.etag, ifMatch)
  if (!EDITABLE_STATES.has(series.state)) throw new ContentRuntimeError('INVALID_STATE', 409)
  const updatedAt = now.toISOString()
  const nextVersion = series.version + 1
  const updated: SeriesRecord = { ...series, title: normalized.title, description: normalized.description,
    coverRef: normalized.coverRef, version: nextVersion, etag: etagForVersion(nextVersion), updatedAt }
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()
  await updateStore.update({ ownerUserId: principalUserId, operationId, idempotencyKey, requestHash: hash,
    responseJson: JSON.stringify(updated), updatedAt, expiresAt, series: updated,
    expectedVersion: series.version, expectedEtag: series.etag })
  return updated
}


export async function deleteSeries(
  deleteStore: SeriesDeleteStore, principalUserId: string, seriesId: string, ifMatch: string,
  idempotencyKey: string, now = new Date(),
): Promise<void> {
  assertResourceId(principalUserId)
  assertResourceId(seriesId)
  if (!ifMatch || !idempotencyKey) throw new ContentRuntimeError('PRECONDITION_REQUIRED', 428)
  const operationId = 'deleteSeries'
  const hash = await requestHash(operationId, { seriesId, ifMatch: normalizeEtag(ifMatch) })
  const loaded = await deleteStore.loadMutation(principalUserId, seriesId, operationId, idempotencyKey)
  const replay = activeIdempotency(loaded.idempotency && {
    idem_id: loaded.idempotency.id, idem_owner_user_id: loaded.idempotency.owner_user_id,
    idem_request_hash: loaded.idempotency.request_hash, idem_status: loaded.idempotency.status,
    idem_response_status: loaded.idempotency.response_status, idem_response_json: loaded.idempotency.response_json,
    idem_expires_at: loaded.idempotency.expires_at,
  }, principalUserId, hash, now)
  if (replay.replayed) return
  const series = loaded.series
  if (!series) throw new ContentRuntimeError('NOT_FOUND', 404)
  assertEtag(series.etag, ifMatch)
  if (!['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED'].includes(series.state)) throw new ContentRuntimeError('INVALID_STATE', 409)
  const deletedAt = now.toISOString()
  const nextVersion = series.version + 1
  const nextEtag = etagForVersion(nextVersion)
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()
  await deleteStore.delete({ ownerUserId: principalUserId, operationId, idempotencyKey, requestHash: hash,
    deletedAt, expiresAt, seriesId: series.id, nextVersion, nextEtag,
    expectedVersion: series.version, expectedEtag: series.etag })
}

