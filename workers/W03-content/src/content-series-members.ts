import { ContentRuntimeError } from './content-runtime.js'

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

export interface SeriesMemberRecord {
  relationshipId: string
  seriesId: string
  contentId: string
  contentSlug: string
  contentType: 'article' | 'post' | 'video'
  contentState: string
  title: string
  position: number
  createdAt: string
  updatedAt: string
}

export type SeriesMemberListCursor = Readonly<{ position: number; id: string }>

export interface SeriesMembersReadStore {
  listSeriesMembers(
    ownerUserId: string,
    seriesId: string,
    cursor: SeriesMemberListCursor | null,
    limit: number,
  ): Promise<{
    items: readonly SeriesMemberRecord[]
    seriesVersion: number
    seriesEtag: string
  }>
}

export interface SeriesMemberAttachStore {
  loadMutation(
    ownerUserId: string,
    seriesId: string,
    contentId: string,
    operationId: string,
    idempotencyKey: string,
  ): Promise<SeriesMemberMutationRow | null>
  attach(input: Readonly<{
    ownerUserId: string
    operationId: string
    idempotencyKey: string
    requestHash: string
    responseJson: string
    nowIso: string
    expiresAt: string
    seriesId: string
    contentId: string
    relationshipId: string
    position: number
    nextVersion: number
    seriesEtag: string
    expectedVersion: number
    expectedEtag: string
  }>): Promise<void>
}

export interface SeriesMemberRemoveStore {
  loadMutation(
    ownerUserId: string,
    seriesId: string,
    contentId: string,
    operationId: string,
    idempotencyKey: string,
  ): Promise<SeriesMemberMutationRow | null>
  remove(input: Readonly<{
    ownerUserId: string
    operationId: string
    idempotencyKey: string
    requestHash: string
    responseJson: string
    nowIso: string
    expiresAt: string
    seriesId: string
    contentId: string
    relationshipId: string
    nextVersion: number
    seriesEtag: string
    expectedVersion: number
    expectedEtag: string
  }>): Promise<void>
}

export type SeriesMemberOrderRow = Readonly<{
  relationship_id: string
  source_id: string
  position: number
  created_at: string
  updated_at: string
}>

export interface SeriesMemberReorderStore {
  loadMutation(ownerUserId: string, seriesId: string, contentId: string, operationId: string, idempotencyKey: string): Promise<SeriesMemberMutationRow | null>
  listMembers(ownerUserId: string, seriesId: string): Promise<readonly SeriesMemberOrderRow[]>
  reorder(input: Readonly<{
    ownerUserId: string
    operationId: string
    idempotencyKey: string
    requestHash: string
    responseJson: string
    nowIso: string
    expiresAt: string
    seriesId: string
    nextVersion: number
    seriesEtag: string
    expectedVersion: number
    expectedEtag: string
    members: readonly Readonly<{ relationshipId: string; position: number }>[]
  }>): Promise<void>
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

export interface SeriesMemberMutationRow {
  series_id: string
  series_owner_user_id: string
  series_state: SeriesState
  series_version: number
  series_etag: string
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
const EDITABLE_SERIES_STATES = new Set<SeriesState>([
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

const assertSeriesEditable = (state: SeriesState): void => {
  if (!EDITABLE_SERIES_STATES.has(state)) {
    throw new ContentRuntimeError('INVALID_STATE', 409)
  }
}

const toMember = (row: {
  relationship_id: string
  series_id: string
  content_id: string
  content_slug: string
  content_type: 'article' | 'post' | 'video'
  content_state: string
  content_title: string
  position: number
  created_at: string
  updated_at: string
}): SeriesMemberRecord => ({
  relationshipId: row.relationship_id,
  seriesId: row.series_id,
  contentId: row.content_id,
  contentSlug: row.content_slug,
  contentType: row.content_type,
  contentState: row.content_state,
  title: row.content_title,
  position: row.position,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export async function attachSeriesMember(
  mutationStore: SeriesMemberAttachStore,
  ownerUserId: string,
  seriesId: string,
  input: unknown,
  ifMatch: string,
  idempotencyKey: string,
  now = new Date(),
): Promise<{ member: SeriesMemberRecord; seriesVersion: number; seriesEtag: string }> {
  assertResourceId(ownerUserId)
  assertResourceId(seriesId)
  if (!ifMatch || !idempotencyKey) throw new ContentRuntimeError('PRECONDITION_REQUIRED', 428)
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
  const contentId = typeof (input as Record<string, unknown>).contentId === 'string'
    ? String((input as Record<string, unknown>).contentId).trim()
    : ''
  assertResourceId(contentId)

  const operationId = 'attachSeriesMember'
  const hash = await requestHash(operationId, {
    seriesId,
    contentId,
    ifMatch: normalizeEtag(ifMatch),
  })
  const row = await mutationStore.loadMutation(ownerUserId, seriesId, contentId, operationId, idempotencyKey)
  if (!row) throw new ContentRuntimeError('NOT_FOUND', 404)

  const replay = inspectIdempotency(row, ownerUserId, hash, now)
  if (replay.replayed) {
    if (!replay.body || typeof replay.body !== 'object') throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
    return replay.body as { member: SeriesMemberRecord; seriesVersion: number; seriesEtag: string }
  }

  if (row.series_owner_user_id !== ownerUserId) throw new ContentRuntimeError('PERMISSION_DENIED', 403)
  if (row.content_owner_user_id !== row.series_owner_user_id) throw new ContentRuntimeError('PERMISSION_DENIED', 403)
    if (row.idem_owner_user_id && row.idem_owner_user_id !== ownerUserId) {
    throw new ContentRuntimeError('IDEMPOTENCY_KEY_REUSE_CONFLICT', 422)
  }
  assertSeriesEditable(row.series_state)
  if (row.idem_request_hash && row.idem_request_hash !== hash) {
    throw new ContentRuntimeError('IDEMPOTENCY_KEY_REUSE_CONFLICT', 422)
  }
  assertEtag(row.series_etag, ifMatch)
  if (row.membership_relationship_id) throw new ContentRuntimeError('CONFLICT', 409)
  if (row.series_state === 'DELETED') throw new ContentRuntimeError('INVALID_STATE', 409)

  const nowIso = now.toISOString()
  const nextVersion = row.series_version + 1
  const seriesEtag = etagForVersion(nextVersion)
  const member: SeriesMemberRecord = {
    relationshipId: crypto.randomUUID(),
    seriesId,
    contentId,
    contentSlug: row.content_slug,
    contentType: row.content_type,
    contentState: row.content_state,
    title: row.content_title,
    position: row.next_position,
    createdAt: nowIso,
    updatedAt: nowIso,
  }
  const response = { member, seriesVersion: nextVersion, seriesEtag }
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()

await mutationStore.attach({
      ownerUserId,
      operationId,
      idempotencyKey,
      requestHash: hash,
      responseJson: JSON.stringify(response),
      nowIso,
      expiresAt,
      seriesId,
      contentId,
      relationshipId: member.relationshipId,
      position: member.position,
      nextVersion,
      seriesEtag,
      expectedVersion: row.series_version,
      expectedEtag: row.series_etag,
    })


  return response
}

type SeriesMemberCursor = {
  version: 1
  ownerUserId: string
  seriesId: string
  position: number
  id: string
}

const encodeSeriesMemberCursor = (cursor: SeriesMemberCursor): string =>
  btoa(JSON.stringify(cursor)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')

const decodeSeriesMemberCursor = (
  value: string,
  ownerUserId: string,
  seriesId: string,
): { position: number; id: string } => {
  try {
    if (!value || value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid cursor')
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
    const parsed = JSON.parse(atob(padded)) as Partial<SeriesMemberCursor>
    if (
      parsed.version !== 1 ||
      parsed.ownerUserId !== ownerUserId ||
      parsed.seriesId !== seriesId ||
      !Number.isSafeInteger(parsed.position) ||
      Number(parsed.position) < 0 ||
      typeof parsed.id !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(parsed.id)
    ) throw new Error('invalid cursor')
    return { position: Number(parsed.position), id: parsed.id }
  } catch {
    throw new ContentRuntimeError('INVALID_CURSOR', 400)
  }
}

export async function listSeriesMembers(
  readStore: SeriesMembersReadStore,
  ownerUserId: string,
  seriesId: string,
  cursor: string | null,
  limit: number,
): Promise<{
  items: SeriesMemberRecord[]
  nextCursor: string | null
  hasMore: boolean
  seriesVersion: number
  seriesEtag: string
}> {
  assertResourceId(ownerUserId)
  assertResourceId(seriesId)
  const pageSize = Math.min(Math.max(Number.isSafeInteger(limit) ? limit : 20, 1), 100)

  const decoded = cursor ? decodeSeriesMemberCursor(cursor, ownerUserId, seriesId) : null

  const result = await readStore.listSeriesMembers(ownerUserId, seriesId, decoded, pageSize + 1)
  const rows = result.items
  const seriesVersion = result.seriesVersion
  const seriesEtag = result.seriesEtag

  const hasMore = rows.length > pageSize
  const page = rows.slice(0, pageSize)
  const last = page.at(-1)
  return {
    items: page,
    hasMore,
    nextCursor: hasMore && last
      ? encodeSeriesMemberCursor({
          version: 1,
          ownerUserId,
          seriesId,
          position: last.position,
          id: last.relationshipId,
        })
      : null,
    seriesVersion,
    seriesEtag,
  }
}

export async function removeSeriesMember(
  mutationStore: SeriesMemberRemoveStore,
  ownerUserId: string,
  seriesId: string,
  contentId: string,
  ifMatch: string,
  idempotencyKey: string,
  now = new Date(),
): Promise<{ member: SeriesMemberRecord; seriesVersion: number; seriesEtag: string }> {
  assertResourceId(ownerUserId)
  assertResourceId(seriesId)
  assertResourceId(contentId)
  if (!ifMatch || !idempotencyKey) throw new ContentRuntimeError('PRECONDITION_REQUIRED', 428)

  const operationId = 'removeSeriesMember'
  const hash = await requestHash(operationId, {
    seriesId,
    contentId,
    ifMatch: normalizeEtag(ifMatch),
  })
  const row = await mutationStore.loadMutation(ownerUserId, seriesId, contentId, operationId, idempotencyKey)
  if (!row) throw new ContentRuntimeError('NOT_FOUND', 404)

  const replay = inspectIdempotency(row, ownerUserId, hash, now)
  if (replay.replayed) {
    if (!replay.body || typeof replay.body !== 'object') throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
    return replay.body as { member: SeriesMemberRecord; seriesVersion: number; seriesEtag: string }
  }

  if (!row.membership_relationship_id || row.membership_position === null) {
    throw new ContentRuntimeError('NOT_FOUND', 404)
  }
  assertSeriesEditable(row.series_state)
  assertEtag(row.series_etag, ifMatch)

  const nowIso = now.toISOString()
  const nextVersion = row.series_version + 1
  const seriesEtag = etagForVersion(nextVersion)
  const member = {
    relationshipId: row.membership_relationship_id,
    seriesId,
    contentId,
    contentSlug: row.content_slug,
    contentType: row.content_type,
    contentState: row.content_state,
    title: row.content_title,
    position: row.membership_position,
    createdAt: row.membership_created_at ?? nowIso,
    updatedAt: nowIso,
  }
  const response = { member, seriesVersion: nextVersion, seriesEtag }
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()

await mutationStore.remove({
      ownerUserId,
      operationId,
      idempotencyKey,
      requestHash: hash,
      responseJson: JSON.stringify(response),
      nowIso,
      expiresAt,
      seriesId,
      contentId,
      relationshipId: row.membership_relationship_id,
      nextVersion,
      seriesEtag,
      expectedVersion: row.series_version,
      expectedEtag: row.series_etag,
    })


  return response
}

export async function reorderSeriesMember(
  mutationStore: SeriesMemberReorderStore,
  ownerUserId: string,
  seriesId: string,
  contentId: string,
  position: number,
  ifMatch: string,
  idempotencyKey: string,
  now = new Date(),
): Promise<{ member: SeriesMemberRecord; seriesVersion: number; seriesEtag: string }> {
  assertResourceId(ownerUserId)
  assertResourceId(seriesId)
  assertResourceId(contentId)
  if (!Number.isSafeInteger(position) || position < 0 || position > 1000000) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
  if (!ifMatch || !idempotencyKey) throw new ContentRuntimeError('PRECONDITION_REQUIRED', 428)

  const operationId = 'reorderSeriesMember'
  const hash = await requestHash(operationId, {
    seriesId,
    contentId,
    position,
    ifMatch: normalizeEtag(ifMatch),
  })
  const row = await mutationStore.loadMutation(ownerUserId, seriesId, contentId, operationId, idempotencyKey)
  if (!row) throw new ContentRuntimeError('NOT_FOUND', 404)

  const replay = inspectIdempotency(row, ownerUserId, hash, now)
  if (replay.replayed) {
    if (!replay.body || typeof replay.body !== 'object') throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
    return replay.body as { member: SeriesMemberRecord; seriesVersion: number; seriesEtag: string }
  }

  if (!row.membership_relationship_id || row.membership_position === null) {
    throw new ContentRuntimeError('NOT_FOUND', 404)
  }
  assertSeriesEditable(row.series_state)
  assertEtag(row.series_etag, ifMatch)

  const members = await mutationStore.listMembers(ownerUserId, seriesId)
  const currentIndex = members.findIndex(item => item.source_id === contentId)
  if (currentIndex < 0) throw new ContentRuntimeError('NOT_FOUND', 404)
  if (position >= members.length) throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  if (position === currentIndex) {
    const member = {
      relationshipId: row.membership_relationship_id,
      seriesId,
      contentId,
      contentSlug: row.content_slug,
      contentType: row.content_type,
      contentState: row.content_state,
      title: row.content_title,
      position: currentIndex,
      createdAt: row.membership_created_at ?? now.toISOString(),
      updatedAt: row.membership_updated_at ?? now.toISOString(),
    }
    return { member, seriesVersion: row.series_version, seriesEtag: row.series_etag }
  }

  const reordered = [...members]
  const [selected] = reordered.splice(currentIndex, 1)
  reordered.splice(position, 0, selected)
  const newPositions = new Map(reordered.map((item, index) => [item.relationship_id, index]))

  const nowIso = now.toISOString()
  const nextVersion = row.series_version + 1
  const seriesEtag = etagForVersion(nextVersion)
  const selectedPosition = newPositions.get(row.membership_relationship_id)
  if (selectedPosition === undefined) throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)

  const member = {
    relationshipId: row.membership_relationship_id,
    seriesId,
    contentId,
    contentSlug: row.content_slug,
    contentType: row.content_type,
    contentState: row.content_state,
    title: row.content_title,
    position: selectedPosition,
    createdAt: row.membership_created_at ?? nowIso,
    updatedAt: nowIso,
  }
  const response = { member, seriesVersion: nextVersion, seriesEtag }
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()
  const tempOffset = members.length + 1

  const memberPositions = members.map(item => {
    const nextPosition = newPositions.get(item.relationship_id)
    if (nextPosition === undefined) throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
    return { relationshipId: item.relationship_id, position: nextPosition }
  })

await mutationStore.reorder({
      ownerUserId,
      operationId,
      idempotencyKey,
      requestHash: hash,
      responseJson: JSON.stringify(response),
      nowIso,
      expiresAt,
      seriesId,
      nextVersion,
      seriesEtag,
      expectedVersion: row.series_version,
      expectedEtag: row.series_etag,
      members: memberPositions,
    })

  return response
}
