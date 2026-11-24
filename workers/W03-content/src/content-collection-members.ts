import { ContentRuntimeError } from './content-runtime.js'

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

export type CollectionMemberListCursor = Readonly<{ position: number; id: string }>

export interface CollectionMembersReadStore {
  listCollectionMembers(
    ownerUserId: string,
    collectionId: string,
    cursor: CollectionMemberListCursor | null,
    limit: number,
  ): Promise<{
    items: readonly CollectionMemberRecord[]
    collectionVersion: number
    collectionEtag: string
  }>
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

export interface CollectionMemberMutationRow {
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

export interface CollectionMemberAttachStore {
  loadMutation(
    ownerUserId: string,
    collectionId: string,
    contentId: string,
    operationId: string,
    idempotencyKey: string,
  ): Promise<CollectionMemberMutationRow | null>
  attach(input: Readonly<{
    ownerUserId: string
    operationId: string
    idempotencyKey: string
    requestHash: string
    responseJson: string
    nowIso: string
    expiresAt: string
    collectionId: string
    contentId: string
    relationshipId: string
    position: number
    nextVersion: number
    collectionEtag: string
    expectedVersion: number
    expectedEtag: string
  }>): Promise<void>
}

export interface CollectionMemberRemoveStore {
  loadMutation(ownerUserId: string, collectionId: string, contentId: string, operationId: string, idempotencyKey: string): Promise<CollectionMemberMutationRow | null>
  remove(input: Readonly<{
    ownerUserId: string
    operationId: string
    idempotencyKey: string
    requestHash: string
    responseJson: string
    nowIso: string
    expiresAt: string
    collectionId: string
    contentId: string
    relationshipId: string
    nextVersion: number
    collectionEtag: string
    expectedVersion: number
    expectedEtag: string
  }>): Promise<void>
}

export type CollectionMemberOrderRow = Readonly<{
  relationship_id: string
  source_id: string
  position: number
  created_at: string
  updated_at: string
}>

export interface CollectionMemberReorderStore {
  loadMutation(ownerUserId: string, collectionId: string, contentId: string, operationId: string, idempotencyKey: string): Promise<CollectionMemberMutationRow | null>
  listMembers(ownerUserId: string, collectionId: string): Promise<readonly CollectionMemberOrderRow[]>
  reorder(input: Readonly<{
    ownerUserId: string
    operationId: string
    idempotencyKey: string
    requestHash: string
    responseJson: string
    nowIso: string
    expiresAt: string
    collectionId: string
    nextVersion: number
    collectionEtag: string
    expectedVersion: number
    expectedEtag: string
    members: readonly Readonly<{ relationshipId: string; position: number }>[]
  }>): Promise<void>
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
  mutationStore: CollectionMemberAttachStore,
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
  const row = await mutationStore.loadMutation(ownerUserId, collectionId, contentId, operationId, idempotencyKey)
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

await mutationStore.attach({
      ownerUserId,
      operationId,
      idempotencyKey,
      requestHash: hash,
      responseJson: JSON.stringify(response),
      nowIso,
      expiresAt,
      collectionId,
      contentId,
      relationshipId: member.relationshipId,
      position: member.position,
      nextVersion,
      collectionEtag,
      expectedVersion: row.collection_version,
      expectedEtag: row.collection_etag,
    })


  return response
}

type CollectionMemberCursor = {
  version: 1
  ownerUserId: string
  collectionId: string
  position: number
  id: string
}

const encodeCollectionMemberCursor = (cursor: CollectionMemberCursor): string =>
  btoa(JSON.stringify(cursor)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')

const decodeCollectionMemberCursor = (
  value: string,
  ownerUserId: string,
  collectionId: string,
): { position: number; id: string } => {
  try {
    if (!value || value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid cursor')
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
    const parsed = JSON.parse(atob(padded)) as Partial<CollectionMemberCursor>
    if (
      parsed.version !== 1 ||
      parsed.ownerUserId !== ownerUserId ||
      parsed.collectionId !== collectionId ||
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

export async function listCollectionMembers(
  readStore: CollectionMembersReadStore,
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

  const decoded = cursor ? decodeCollectionMemberCursor(cursor, ownerUserId, collectionId) : null

  const result = await readStore.listCollectionMembers(ownerUserId, collectionId, decoded, pageSize + 1)
  const rows = result.items
  const collectionVersion = result.collectionVersion
  const collectionEtag = result.collectionEtag

  const hasMore = rows.length > pageSize
  const page = rows.slice(0, pageSize)
  const last = page.at(-1)
  return {
    items: page,
    hasMore,
    nextCursor: hasMore && last
      ? encodeCollectionMemberCursor({
          version: 1,
          ownerUserId,
          collectionId,
          position: last.position,
          id: last.relationshipId,
        })
      : null,
    collectionVersion,
    collectionEtag,
  }
}

export async function removeCollectionMember(
  mutationStore: CollectionMemberRemoveStore,
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
  const row = await mutationStore.loadMutation(ownerUserId, collectionId, contentId, operationId, idempotencyKey)
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

await mutationStore.remove({
      ownerUserId,
      operationId,
      idempotencyKey,
      requestHash: hash,
      responseJson: JSON.stringify(response),
      nowIso,
      expiresAt,
      collectionId,
      contentId,
      relationshipId: row.membership_relationship_id,
      nextVersion,
      collectionEtag,
      expectedVersion: row.collection_version,
      expectedEtag: row.collection_etag,
    })


  return response
}

export async function reorderCollectionMember(
  mutationStore: CollectionMemberReorderStore,
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
  const row = await mutationStore.loadMutation(ownerUserId, collectionId, contentId, operationId, idempotencyKey)
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

  const members = await mutationStore.listMembers(ownerUserId, collectionId)
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
      collectionId,
      nextVersion,
      collectionEtag,
      expectedVersion: row.collection_version,
      expectedEtag: row.collection_etag,
      members: memberPositions,
    })

  return response
}
