/// <reference types="@cloudflare/workers-types" />

import { contentSlugFor, isContentSlug } from './content-slug.js'
import { allocateContentSnowflakeId } from './content-snowflake-id.js'
import { normalizePreflightInput, preflightContent } from './publish-preflight.js'

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

export type ContentType = 'article' | 'post' | 'video'
export type ContentAccessMode = 'PUBLIC' | 'MEMBERS_ONLY'

export interface ContentInput {
  contentType: ContentType
  title: string
  bodyRef: string
  mediaRefs: string[]
  coverRef: string | null
  accessMode?: ContentAccessMode
}

export interface ContentRecord {
  id: string
  contentType: ContentType
  ownerUserId: string
  creatorId: string | null
  ipId: string | null
  state: ContentState
  scheduledAt?: string | null
  accessMode?: ContentAccessMode
  /** Read-time authorization result; never persisted. */
  accessGranted?: boolean
  version: number
  revision: number
  slug: string
  title: string
  bodyRef: string
  mediaRefs: string[]
  coverRef: string | null
  etag: string
  createdAt: string
  updatedAt: string
}


export type ContentRevisionOperation = 'CREATE' | 'UPDATE' | 'ROLLBACK'

export interface ContentRevision {
  id: string
  contentId: string
  revision: number
  contentVersion: number
  actorUserId: string
  sourceRevision: number | null
  operation: ContentRevisionOperation
  state: ContentState
  accessMode?: ContentAccessMode
  slug: string
  title: string
  bodyRef: string
  mediaRefs: string[]
  coverRef: string | null
  etag: string
  reason: string | null
  correlationId: string
  createdAt: string
}

export interface ContentD1 {
  prepare(query: string): D1PreparedStatement
  batch(statements: D1PreparedStatement[]): Promise<D1Result<unknown>[]>
}

interface ContentRow {
  id: string
  content_type: ContentType
  owner_user_id: string
  creator_id: string | null
  ip_id: string | null
  state: ContentState
  scheduled_at: string | null
  access_mode?: ContentAccessMode
  version: number
  revision: number
  slug: string
  title: string
  body_ref: string
  media_refs_json: string
  cover_ref: string | null
  etag: string
  created_at: string
  updated_at: string
}


interface ContentRevisionRow {
  id: string
  content_id: string
  revision: number
  content_version: number
  actor_user_id: string
  source_revision: number | null
  operation: ContentRevisionOperation
  state: ContentState
  access_mode?: ContentAccessMode
  slug: string
  title: string
  body_ref: string
  media_refs_json: string
  cover_ref: string | null
  etag: string
  reason: string | null
  correlation_id: string
  created_at: string
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
const EDITABLE_STATES = new Set<ContentState>(['DRAFT', 'REJECTED', 'RESTORED'])
const ALL_STATES: readonly ContentState[] = [
  'DRAFT','PENDING_REVIEW','REJECTED','APPROVED','SCHEDULED',
  'PUBLISHED','UNPUBLISHED','ARCHIVED','DELETED','RESTORED',
]

export const createRequestId = (): string => 'req_' + crypto.randomUUID()

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
    case 'INVALID_CURSOR': return 'Invalid pagination cursor'
    case 'CURSOR_EXPIRED': return 'Pagination cursor expired'
    case 'RATE_LIMITED': return 'Rate limit exceeded'
    default: return 'Content request failed'
  }
}

const errorResponse = (error: ContentRuntimeError): Response => {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  if (error.code === 'RATE_LIMITED') headers.set('retry-after', '60')
  return Response.json({
    error: {
      code: error.code,
      message: publicMessage(error.code),
      details: error.code === 'RATE_LIMITED' ? { retryAfter: 60 } : {},
    },
    requestId: createRequestId(),
  }, { status: error.code === 'VALIDATION_FAILED' && error.status === 400 ? 422 : error.status, headers })
}

const toContent = (row: ContentRow): ContentRecord => ({
  id: row.id,
  contentType: row.content_type,
  ownerUserId: row.owner_user_id,
  creatorId: row.creator_id,
  ipId: row.ip_id,
  state: row.state,
  scheduledAt: row.scheduled_at ?? null,
  accessMode: row.access_mode === 'MEMBERS_ONLY' ? 'MEMBERS_ONLY' : 'PUBLIC',
  version: row.version,
  revision: row.revision,
  slug: row.slug,
  title: row.title,
  bodyRef: row.body_ref,
  mediaRefs: JSON.parse(row.media_refs_json || '[]') as string[],
  coverRef: row.cover_ref,
  etag: row.etag,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export const MEMBERS_ONLY_CONTENT_PREVIEW_TITLE = '会员专享内容'

export const publicContent = (content: ContentRecord) => {
  const accessGranted = content.accessGranted ?? content.accessMode !== 'MEMBERS_ONLY'
  return {
    id: content.id,
    creatorId: content.creatorId,
    state: content.state,
    scheduledAt: content.scheduledAt,
    accessMode: content.accessMode ?? 'PUBLIC',
    accessGranted,
    version: content.version,
    etag: content.etag,
    slug: content.slug,
    title: accessGranted ? content.title : MEMBERS_ONLY_CONTENT_PREVIEW_TITLE,
    bodyRef: accessGranted ? content.bodyRef : '',
    mediaRefs: accessGranted ? content.mediaRefs : [],
    coverRef: accessGranted ? content.coverRef : null,
  }
}

const publicPostMediaReferenceCandidates = (value: string): string[] => {
  if (value.length === 0 || value.length > 2048) return []
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      !['img.luckread.com', 'video.luckread.com'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.port ||
      url.pathname === '/'
    ) return []

    const encodedSegments = url.pathname.slice(1).split('/')
    const decodedSegments = encodedSegments.map((segment) => {
      try { return decodeURIComponent(segment) } catch { return '' }
    })
    if (decodedSegments.some((segment) =>
      !segment ||
      segment === '.' ||
      segment === '..' ||
      segment.includes('/') ||
      segment.includes('\\') ||
      /[\u0000-\u001f\u007f]/.test(segment)
    )) return []

    const objectKey = decodedSegments.map(encodeURIComponent).join('/')
    const candidates = new Set<string>([
      url.origin + '/' + objectKey,
    ])

    return [...candidates]
  } catch {
    return []
  }
}

/**
 * A media URL is public only while it is referenced by published social-post
 * content. Article/video entitlement rules are not represented by this W03
 * record yet, so the public resolver deliberately fails closed for those types.
 * W03 remains the authority for the live publication state.
 */
export type PublishedMediaReferenceAccess = Readonly<{
  isPublic: boolean
  isMemberContent: boolean
  allowed: boolean
}>

type PublishedMediaReferenceRow = Readonly<{
  id: string
  owner_user_id: string
  creator_id: string | null
  content_type: ContentType
  access_mode: ContentAccessMode
}>

/**
 * Resolves a delivery URL against currently published content references.
 * Public media keeps the existing public-post-only rule. If a reference is used
 * by any member-only content, the URL is protected and must pass a fresh
 * subscription check; it cannot fall back to anonymous public delivery merely
 * because the same object is also referenced by a public post.
 */
export async function resolvePublishedMediaReferenceAccess(
  db: ContentD1,
  mediaUrlValue: string,
  viewerUserId: string | null,
  hasCreatorMembership?: CreatorMembershipAccessResolver,
): Promise<PublishedMediaReferenceAccess> {
  const candidates = publicPostMediaReferenceCandidates(mediaUrlValue)
  if (candidates.length === 0) {
    return { isPublic: false, isMemberContent: false, allowed: false }
  }
  const placeholders = candidates.map(() => '?').join(', ')
  const sql = [
    'SELECT id, owner_user_id, creator_id, content_type, access_mode',
    'FROM contents',
    "WHERE state = 'PUBLISHED'",
    '  AND (',
    '    body_ref IN (' + placeholders + ')',
    '    OR cover_ref IN (' + placeholders + ')',
    '    OR EXISTS (',
    '      SELECT 1',
    '      FROM json_each(contents.media_refs_json) AS media_ref',
    '      WHERE media_ref.value IN (' + placeholders + ')',
    '    )',
    '  )',
    'ORDER BY id ASC',
    'LIMIT 51',
  ].join('\n')
  let rows: PublishedMediaReferenceRow[]
  try {
    const result = await db.prepare(sql)
      .bind(...candidates, ...candidates, ...candidates)
      .all<PublishedMediaReferenceRow>()
    rows = result.results ?? []
  } catch {
    throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  if (rows.length > 50) throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
  if (rows.length === 0) return { isPublic: false, isMemberContent: false, allowed: false }

  const memberRows = rows.filter((row) => row.access_mode === 'MEMBERS_ONLY')
  if (memberRows.length > 0) {
    // A URL can be referenced by more than one content record. Do not grant the
    // bytes because a viewer is entitled to one of several unrelated creators;
    // every protected reference to this object must independently authorize it.
    for (const row of memberRows) {
      if (viewerUserId && row.owner_user_id === viewerUserId) continue
      if (!viewerUserId || !hasCreatorMembership || !row.creator_id ||
          !(await hasCreatorMembership(row.creator_id))) {
        return { isPublic: false, isMemberContent: true, allowed: false }
      }
    }
    return { isPublic: false, isMemberContent: true, allowed: true }
  }

  const isPublic = rows.some((row) => row.content_type === 'post' && row.access_mode !== 'MEMBERS_ONLY')
  return { isPublic, isMemberContent: false, allowed: isPublic }
}

export async function isPublishedPublicPostMediaReference(
  db: ContentD1,
  mediaUrlValue: string,
): Promise<boolean> {
  const candidates = publicPostMediaReferenceCandidates(mediaUrlValue)
  if (candidates.length === 0) return false

  const placeholders = candidates.map(() => '?').join(', ')
  const sql = [
    'SELECT id',
    'FROM contents',
    "WHERE state = 'PUBLISHED'",
    "  AND access_mode = 'PUBLIC'",
    "  AND content_type = 'post'",
    '  AND (',
    '    body_ref IN (' + placeholders + ')',
    '    OR cover_ref IN (' + placeholders + ')',
    '    OR EXISTS (',
    '      SELECT 1',
    '      FROM json_each(contents.media_refs_json) AS media_ref',
    '      WHERE media_ref.value IN (' + placeholders + ')',
    '    )',
    '  )',
    'LIMIT 1',
  ].join('\n')
  const row = await db.prepare(sql)
    .bind(...candidates, ...candidates, ...candidates)
    .first<{ id: string }>()
  return typeof row?.id === 'string' && row.id.length > 0
}

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

const assertResourceId = (value: string): void => {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
}

const assertContentReference = (value: string): void => {
  if (/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value) || isContentSlug(value)) return
  throw new ContentRuntimeError('VALIDATION_FAILED', 400)
}

export const validateInput = (input: unknown): ContentInput => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
  const candidate = input as { contentType?: unknown; title?: unknown; bodyRef?: unknown; mediaRefs?: unknown; coverRef?: unknown; accessMode?: unknown }
  const contentType = candidate.contentType === undefined ? 'article' : candidate.contentType
  const mediaRefs = candidate.mediaRefs === undefined ? [] : candidate.mediaRefs
  // Keep omission backward-compatible in the canonical idempotency hash.
  // Persistence and read-time defaults still resolve omitted accessMode to PUBLIC.
  const accessMode = candidate.accessMode
  if (
    !['article', 'post', 'video'].includes(String(contentType)) ||
    (accessMode !== undefined && !['PUBLIC', 'MEMBERS_ONLY'].includes(String(accessMode))) ||
    !Array.isArray(mediaRefs) || mediaRefs.length > 20 ||
    (contentType === 'video' && mediaRefs.length === 0) ||
    mediaRefs.some(ref => typeof ref !== 'string' || ref.trim().length === 0 || ref.length > 2048) ||
    (candidate.coverRef !== undefined && candidate.coverRef !== null && (typeof candidate.coverRef !== 'string' || candidate.coverRef.length > 2048)) ||
    typeof candidate.title !== 'string' ||
    candidate.title.trim().length === 0 ||
    candidate.title.length > 512 ||
    typeof candidate.bodyRef !== 'string' ||
    candidate.bodyRef.trim().length === 0 ||
    candidate.bodyRef.length > 2048
  ) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
  return { contentType: contentType as ContentType, title: candidate.title.trim(), bodyRef: candidate.bodyRef.trim(), mediaRefs: mediaRefs.map(ref => ref.trim()), coverRef: candidate.coverRef === undefined || candidate.coverRef === null ? null : candidate.coverRef.trim(), accessMode: accessMode as ContentAccessMode | undefined }
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

const parseResponseJson = (value: string | null): unknown => {
  if (!value) return null
  try { return JSON.parse(value) } catch { return null }
}

const isActiveIdempotency = (row: IdempotencyRow | null, now: Date): boolean =>
  !!row?.idem_id && !!row.idem_expires_at && Date.parse(row.idem_expires_at) > now.getTime()

const inspectIdempotency = (
  row: IdempotencyRow | null,
  ownerUserId: string,
  requestHashValue: string,
  now: Date,
): { replayed: boolean; body: unknown | null; status: number | null } => {
  if (!isActiveIdempotency(row, now)) return { replayed: false, body: null, status: null }
  if (row?.idem_owner_user_id !== ownerUserId || row.idem_request_hash !== requestHashValue) {
    throw new ContentRuntimeError('IDEMPOTENCY_KEY_REUSE_CONFLICT', 422)
  }
  if (row.idem_status === 'IN_PROGRESS') {
    throw new ContentRuntimeError('IDEMPOTENCY_IN_PROGRESS', 409)
  }
  return {
    replayed: true,
    body: parseResponseJson(row.idem_response_json),
    status: row.idem_response_status,
  }
}


const toRevision = (row: ContentRevisionRow): ContentRevision => ({
  id: row.id,
  contentId: row.content_id,
  revision: row.revision,
  contentVersion: row.content_version,
  actorUserId: row.actor_user_id,
  sourceRevision: row.source_revision,
  operation: row.operation,
  state: row.state,
  accessMode: row.access_mode === 'MEMBERS_ONLY' ? 'MEMBERS_ONLY' : 'PUBLIC',
  slug: row.slug,
  title: row.title,
  bodyRef: row.body_ref,
  mediaRefs: JSON.parse(row.media_refs_json || '[]') as string[],
  coverRef: row.cover_ref,
  etag: row.etag,
  reason: row.reason,
  correlationId: row.correlation_id,
  createdAt: row.created_at,
})

const revisionPageSize = (limit: number): number =>
  Math.min(Math.max(Number.isSafeInteger(limit) ? limit : 20, 1), 100)

const normalizeCorrelationId = (value: string): string => {
  const normalized = value.trim()
  if (!normalized || normalized.length > 256) throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  return normalized
}

const insertRevision = (db: ContentD1, revision: ContentRevision): D1PreparedStatement =>
  db.prepare(`INSERT INTO content_revisions
    (id, content_id, revision, content_version, actor_user_id, source_revision, operation,
     state, access_mode, slug, title, body_ref, media_refs_json, cover_ref, etag, reason, correlation_id, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    revision.id, revision.contentId, revision.revision, revision.contentVersion,
    revision.actorUserId, revision.sourceRevision, revision.operation, revision.state,
    revision.accessMode ?? 'PUBLIC', revision.slug, revision.title, revision.bodyRef, JSON.stringify(revision.mediaRefs), revision.coverRef,
    revision.etag, revision.reason, revision.correlationId, revision.createdAt,
  )
const emptyIdempotency = (): IdempotencyRow => ({
  idem_id: null,
  idem_owner_user_id: null,
  idem_request_hash: null,
  idem_status: null,
  idem_response_status: null,
  idem_response_json: null,
  idem_expires_at: null,
})

const loadMutationRow = async (
  db: ContentD1,
  contentId: string,
  operationId: string,
  idempotencyKey: string,
  ownerUserId: string,
): Promise<{ content: ContentRecord | null; idempotency: IdempotencyRow }> => {
  const row = await db.prepare(
    `SELECT
        c.id, c.content_type, c.owner_user_id, c.creator_id, c.ip_id, c.state, c.scheduled_at, c.access_mode, c.version, c.revision,
        c.slug, c.title, c.body_ref, c.media_refs_json, c.cover_ref, c.etag, c.created_at, c.updated_at,
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
         WHERE owner_user_id = ? AND operation_id = ? AND idempotency_key = ?
         ORDER BY created_at DESC
         LIMIT 1
       ) i ON 1 = 1
      WHERE c.id = ?`,
  ).bind(ownerUserId, operationId, idempotencyKey, contentId).first<ContentWithIdempotencyRow>()

  if (!row) return { content: null, idempotency: emptyIdempotency() }

  return {
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
  }
}

const expireMutationRow = (
  db: ContentD1,
  ownerUserId: string,
  operationId: string,
  idempotencyKey: string,
  nowIso: string,
): D1PreparedStatement =>
  db.prepare(
    `DELETE FROM content_mutation_idempotency
      WHERE owner_user_id = ? AND operation_id = ? AND idempotency_key = ? AND expires_at <= ?`,
  ).bind(ownerUserId, operationId, idempotencyKey, nowIso)

const insertCompletedIdempotency = (
  db: ContentD1,
  ownerUserId: string,
  operationId: string,
  idempotencyKey: string,
  requestHashValue: string,
  responseStatus: number,
  responseJson: string,
  nowIso: string,
  expiresAt: string,
): D1PreparedStatement =>
  db.prepare(
    `INSERT INTO content_mutation_idempotency
      (id, owner_user_id, operation_id, idempotency_key, request_hash, status, response_status, response_json, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    ownerUserId,
    operationId,
    idempotencyKey,
    requestHashValue,
    responseStatus,
    responseJson,
    nowIso,
    expiresAt,
  )

const atomicGuard = (db: ContentD1): D1PreparedStatement =>
  db.prepare(
    `INSERT OR REPLACE INTO content_txn_guard(id, successful)
     VALUES (1, changes())`,
  )

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const isIdempotencyUniqueConstraint = (error: unknown): boolean =>
  /unique constraint failed: content_mutation_idempotency\.|UNIQUE constraint failed: content_mutation_idempotency\./i.test(errorMessage(error))

const isContentCasGuardFailure = (error: unknown): boolean =>
  /CHECK constraint failed: successful|content_txn_guard.*CHECK constraint/i.test(errorMessage(error))

const batchMutation = async (
  db: ContentD1,
  statements: D1PreparedStatement[],
): Promise<void> => {
  try {
    await db.batch(statements)
  } catch (error) {
    if (isIdempotencyUniqueConstraint(error)) throw new ContentRuntimeError('IDEMPOTENCY_IN_PROGRESS', 409)
    if (isContentCasGuardFailure(error)) throw new ContentRuntimeError('PRECONDITION_FAILED', 412)
    throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
}

export type CreatorMembershipAccessResolver = (creatorId: string) => Promise<boolean>

export async function getContent(
  db: ContentD1,
  contentId: string,
  principalUserId: string | null,
  resolveCreatorMembershipAccess?: CreatorMembershipAccessResolver,
): Promise<ContentRecord> {
  assertContentReference(contentId)
  const row = await db.prepare(
    `SELECT id, content_type, owner_user_id, creator_id, ip_id, state, scheduled_at, access_mode, version, revision,
            slug, title, body_ref, media_refs_json, cover_ref, etag, created_at, updated_at
       FROM contents
      WHERE (id = ? OR slug = ?)
        AND (state = 'PUBLISHED' OR owner_user_id = ?)`,
  ).bind(contentId, contentId, principalUserId ?? '').first<ContentRow>()
  if (!row) throw new ContentRuntimeError('NOT_FOUND', 404)
  const content = toContent(row)
  if (content.accessMode !== 'MEMBERS_ONLY' ||
      (principalUserId !== null && principalUserId === content.ownerUserId)) {
    return { ...content, accessGranted: true }
  }
  let allowed = false
  if (principalUserId && content.creatorId && resolveCreatorMembershipAccess) {
    allowed = await resolveCreatorMembershipAccess(content.creatorId)
  }
  if (allowed) return { ...content, accessGranted: true }
  // Keep a discoverable paywall shell, but never expose body or private media
  // references to anonymous or non-member readers.
  return {
    ...content,
    accessGranted: false,
    title: MEMBERS_ONLY_CONTENT_PREVIEW_TITLE,
    bodyRef: '',
    mediaRefs: [],
    coverRef: null,
  }
}

export type OwnedPostContext = {
  contentId: string
  ownerUserId: string
  contentType: 'post'
  state: 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED'
  updatedAt: string
}

/**
 * W03 is the sole authority for content ownership and lifecycle. W05 uses this
 * owner-scoped context for W05 social actions on the caller's own post.
 */
export async function getOwnedPostContext(
  db: ContentD1,
  contentIdValue: string,
  principalUserIdValue: string,
): Promise<OwnedPostContext> {
  const contentId = contentIdValue.trim()
  const principalUserId = principalUserIdValue.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(contentId)) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(principalUserId)) {
    throw new ContentRuntimeError('UNAUTHENTICATED', 401)
  }
  const row = await db.prepare(
    `SELECT id, owner_user_id, content_type, state, updated_at
       FROM contents
      WHERE id = ?
        AND owner_user_id = ?
        AND content_type = 'post'
        AND state IN ('DRAFT', 'PUBLISHED', 'UNPUBLISHED')
      LIMIT 1`,
  ).bind(contentId, principalUserId).first<{
    id: string
    owner_user_id: string
    content_type: string
    state: string
    updated_at: string
  }>()
  if (!row) throw new ContentRuntimeError('NOT_FOUND', 404)
  return {
    contentId: row.id,
    ownerUserId: row.owner_user_id,
    contentType: 'post',
    state: row.state as 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED',
    updatedAt: row.updated_at,
  }
}

/**
 * W03 validates a public profile pin without treating the requested profile
 * owner as an authenticated principal. Only a published post owned by that
 * profile can be returned through this read-only internal context.
 */
export type PublishedContentSocialContext = {
  contentId: string
  ownerUserId: string | null
  contentType: ContentType
  state: 'PUBLISHED'
  updatedAt: string
}

/**
 * Minimal published-content context for W05 social reads and visibility checks.
 * Includes the canonical timestamp used to preserve poll expiry semantics.
 */
export async function getPublishedContentSocialContext(
  db: ContentD1,
  contentIdValue: string,
): Promise<PublishedContentSocialContext> {
  const contentId = contentIdValue.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(contentId)) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
  const row = await db.prepare(
    `SELECT id, owner_user_id, content_type, updated_at
       FROM contents
      WHERE id = ? AND state = 'PUBLISHED'
      LIMIT 1`,
  ).bind(contentId).first<{
    id: string
    owner_user_id: string | null
    content_type: string
    updated_at: string
  }>()
  if (!row) throw new ContentRuntimeError('NOT_FOUND', 404)
  if (!['article', 'post', 'video'].includes(row.content_type)) {
    throw new ContentRuntimeError('INTERNAL_ERROR', 500)
  }
  return {
    contentId: row.id,
    ownerUserId: row.owner_user_id,
    contentType: row.content_type as ContentType,
    state: 'PUBLISHED',
    updatedAt: row.updated_at,
  }
}

export type PublishedContentSocialSummaryContext = PublishedContentSocialContext & { title: string }

export async function getPublishedContentSocialContexts(
  db: ContentD1,
  contentIdsValue: string[],
): Promise<PublishedContentSocialSummaryContext[]> {
  if (!Array.isArray(contentIdsValue) || contentIdsValue.length > 50) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
  const contentIds = contentIdsValue.map(value => typeof value === 'string' ? value.trim() : '')
  if (contentIds.some(contentId => !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(contentId))) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
  const uniqueContentIds = [...new Set(contentIds)]
  if (uniqueContentIds.length === 0) return []

  const placeholders = uniqueContentIds.map(() => '?').join(', ')
  const rows = await db.prepare(
    `SELECT id, owner_user_id, content_type, title, updated_at
       FROM contents
      WHERE state = 'PUBLISHED'
        AND id IN (${placeholders})`,
  ).bind(...uniqueContentIds).all<{
    id: string
    owner_user_id: string | null
    content_type: string
    title: string
    updated_at: string
  }>()
  const byId = new Map<string, PublishedContentSocialSummaryContext>()
  for (const row of rows.results ?? []) {
    if (!uniqueContentIds.includes(row.id)) throw new ContentRuntimeError('INTERNAL_ERROR', 500)
    if (!['article', 'post', 'video'].includes(row.content_type)) {
      throw new ContentRuntimeError('INTERNAL_ERROR', 500)
    }
    byId.set(row.id, {
      contentId: row.id,
      ownerUserId: row.owner_user_id,
      contentType: row.content_type as ContentType,
      state: 'PUBLISHED',
      title: row.title,
      updatedAt: row.updated_at,
    })
  }
  return uniqueContentIds.flatMap(contentId => {
    const context = byId.get(contentId)
    return context ? [context] : []
  })
}

export async function getPublishedOwnerPostContext(
  db: ContentD1,
  contentIdValue: string,
  ownerUserIdValue: string,
): Promise<OwnedPostContext> {
  const contentId = contentIdValue.trim()
  const ownerUserId = ownerUserIdValue.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(contentId)) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(ownerUserId)) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
  const row = await db.prepare(
    `SELECT id, owner_user_id, content_type, state, updated_at
       FROM contents
      WHERE id = ?
        AND owner_user_id = ?
        AND content_type = 'post'
        AND state = 'PUBLISHED'
      LIMIT 1`,
  ).bind(contentId, ownerUserId).first<{
    id: string
    owner_user_id: string
    content_type: string
    state: string
    updated_at: string
  }>()
  if (!row) throw new ContentRuntimeError('NOT_FOUND', 404)
  return {
    contentId: row.id,
    ownerUserId: row.owner_user_id,
    contentType: 'post',
    state: 'PUBLISHED',
    updatedAt: row.updated_at,
  }
}

export async function listContentRevisions(
  db: ContentD1,
  principalUserId: string,
  contentId: string,
  cursor: string | null,
  limit: number,
): Promise<{ items: ContentRevision[]; nextCursor: string | null; hasMore: boolean }> {
  assertResourceId(principalUserId)
  assertResourceId(contentId)
  const pageSize = revisionPageSize(limit)
  const cursorScope = JSON.stringify({ type: 'content-revisions', principalUserId, contentId })
  const decoded = cursor ? decodeScopedCursor(cursor, cursorScope) : null
  const cursorClause = decoded ? 'AND (r.created_at < ? OR (r.created_at = ? AND r.id < ?))' : ''
  const cursorBindings = decoded ? [decoded.updatedAt, decoded.updatedAt, decoded.id] : []
  const rows = await db.prepare(`
    SELECT r.id, r.content_id, r.revision, r.content_version, r.actor_user_id,
           r.source_revision, r.operation, r.state, r.access_mode, r.slug, r.title, r.body_ref,
           r.media_refs_json, r.cover_ref, r.etag, r.reason, r.correlation_id, r.created_at
      FROM content_revisions r
      JOIN contents c ON c.id = r.content_id
     WHERE r.content_id = ? AND c.owner_user_id = ? ${cursorClause}
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT ?`).bind(contentId, principalUserId, ...cursorBindings, pageSize + 1).all<ContentRevisionRow>()
  const hasMore = rows.results.length > pageSize
  const page = rows.results.slice(0, pageSize).map(toRevision)
  const last = page.at(-1)
  return { items: page, hasMore, nextCursor: hasMore && last ? encodeScopedCursor(last.createdAt, last.id, cursorScope) : null }
}

export async function getContentRevision(
  db: ContentD1,
  principalUserId: string,
  contentId: string,
  revisionId: string,
): Promise<ContentRevision> {
  assertResourceId(principalUserId)
  assertResourceId(contentId)
  assertResourceId(revisionId)
  const row = await db.prepare(`
    SELECT r.id, r.content_id, r.revision, r.content_version, r.actor_user_id,
           r.source_revision, r.operation, r.state, r.access_mode, r.slug, r.title, r.body_ref,
           r.media_refs_json, r.cover_ref, r.etag, r.reason, r.correlation_id, r.created_at
      FROM content_revisions r
      JOIN contents c ON c.id = r.content_id
     WHERE r.id = ? AND r.content_id = ? AND c.owner_user_id = ?`).bind(revisionId, contentId, principalUserId).first<ContentRevisionRow>()
  if (!row) throw new ContentRuntimeError('NOT_FOUND', 404)
  return toRevision(row)
}

export function validateListFilters(statusValue: string | null, typeValue: string | null): {
  status?: ContentState
  contentType?: ContentType
} {
  const status = statusValue?.trim() || undefined
  const contentType = typeValue?.trim() || undefined
  if (status && !isState(status)) throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  if (contentType && !['article', 'post', 'video'].includes(contentType)) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
  return {
    status: status as ContentState | undefined,
    contentType: contentType as ContentType | undefined,
  }
}

export async function listCreatorContents(
  db: ContentD1,
  ownerUserId: string,
  cursor: string | null,
  limit: number,
  filters: { status?: ContentState; contentType?: ContentType } = {},
): Promise<{ items: ContentRecord[]; nextCursor: string | null; hasMore: boolean }> {
  assertResourceId(ownerUserId)
  const pageSize = Math.min(Math.max(Number.isSafeInteger(limit) ? limit : 20, 1), 50)
  const cursorScope = JSON.stringify({
    type: 'creator-contents',
    ownerUserId,
    status: filters.status ?? null,
    contentType: filters.contentType ?? null,
  })
  const decoded = cursor ? decodeScopedCursor(cursor, cursorScope) : null
  const conditions = ['owner_user_id = ?']
  const bindings: unknown[] = [ownerUserId]
  if (filters.status) {
    conditions.push('state = ?')
    bindings.push(filters.status)
  }
  if (filters.contentType) {
    conditions.push('content_type = ?')
    bindings.push(filters.contentType)
  }
  if (decoded) {
    conditions.push('(updated_at < ? OR (updated_at = ? AND id < ?))')
    bindings.push(decoded.updatedAt, decoded.updatedAt, decoded.id)
  }
  const rows = await db.prepare(
    `SELECT id, content_type, owner_user_id, creator_id, ip_id, state, scheduled_at, access_mode, version, revision,
            slug, title, body_ref, media_refs_json, cover_ref, etag, created_at, updated_at
       FROM contents
      WHERE ${conditions.join(' AND ')}
      ORDER BY updated_at DESC, id DESC
      LIMIT ?`,
  ).bind(...bindings, pageSize + 1).all<ContentRow>()
  const hasMore = rows.results.length > pageSize
  const page = rows.results.slice(0, pageSize).map(toContent)
  const last = page.at(-1)
  return {
    items: page,
    hasMore,
    nextCursor: hasMore && last
      ? encodeScopedCursor(last.updatedAt, last.id, cursorScope)
      : null,
  }
}


export async function listPublishedContentsByIds(
  db: ContentD1,
  contentIds: string[],
): Promise<ContentRecord[]> {
  if (!Array.isArray(contentIds) || contentIds.length > 50) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
  const ids = [...new Set(contentIds)]
  for (const id of ids) assertResourceId(id)
  if (ids.length === 0) return []

  const rows = await db.prepare(
    `SELECT c.id, c.content_type, c.owner_user_id, c.creator_id, c.ip_id, c.state,
            c.scheduled_at, c.access_mode, c.version, c.revision, c.slug, c.title, c.body_ref,
            c.media_refs_json, c.cover_ref, c.etag, c.created_at, c.updated_at
       FROM json_each(?) AS requested
       INNER JOIN contents AS c ON c.id = requested.value
      WHERE c.state = 'PUBLISHED'
      ORDER BY CAST(requested.key AS INTEGER) ASC
      LIMIT ?`,
  ).bind(JSON.stringify(ids), ids.length).all<ContentRow>()

  return rows.results.map(toContent)
}

export async function listContents(
  db: ContentD1,
  cursor: string | null,
  limit: number,
  creatorId: string | null = null,
  contentType: ContentType | null = null,
  ownerUserId: string | null = null,
): Promise<{ items: ContentRecord[]; nextCursor: string | null; hasMore: boolean }> {
  const pageSize = Math.min(Math.max(Number.isSafeInteger(limit) ? limit : 20, 1), 50)
  if (creatorId) assertResourceId(creatorId)
  if (ownerUserId) assertResourceId(ownerUserId)
  if (contentType && !['article', 'post', 'video'].includes(contentType)) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }

  const decoded = cursor ? decodeContentListCursor(cursor, creatorId, contentType, ownerUserId) : null
  const conditions = ["state = 'PUBLISHED'"]
  const bindings: unknown[] = []

  if (creatorId) {
    conditions.push('creator_id = ?')
    bindings.push(creatorId)
  }
  if (ownerUserId) {
    conditions.push('owner_user_id = ?')
    bindings.push(ownerUserId)
  }
  if (contentType) {
    conditions.push('content_type = ?')
    bindings.push(contentType)
  }

  if (decoded) {
    conditions.push('(created_at < ? OR (created_at = ? AND id < ?))')
    bindings.push(decoded.createdAt, decoded.createdAt, decoded.id)
  }

  const rows = await db.prepare(
    `SELECT id, content_type, owner_user_id, creator_id, ip_id, state, scheduled_at, access_mode, version, revision,
            slug, title, body_ref, media_refs_json, cover_ref, etag, created_at, updated_at
       FROM contents
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT ?`,
  ).bind(...bindings, pageSize + 1).all<ContentRow>()

  const hasMore = rows.results.length > pageSize
  const page = rows.results.slice(0, pageSize).map(toContent)
  const last = page.at(-1)
  return {
    items: page,
    hasMore,
    nextCursor: hasMore && last ? encodeContentListCursor(last.createdAt, last.id, creatorId, contentType, ownerUserId) : null,
  }
}

/**
 * Search only published canonical content metadata. The cursor is scoped to the
 * normalized query so it cannot be reused to enumerate a different search.
 * Search is intentionally limited to title/slug until an admitted derived
 * full-text index exists; body references are opaque IDs/URLs, not body text.
 */
export async function searchPublishedContents(
  db: ContentD1,
  queryValue: string,
  cursorValue: string | null,
  limit: number,
): Promise<{ items: ContentRecord[]; nextCursor: string | null; hasMore: boolean }> {
  const query = queryValue.normalize('NFKC').trim()
  if (!query || query.length > 256) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }

  const pageSize = Math.min(Math.max(Number.isSafeInteger(limit) ? limit : 20, 1), 50)
  const scope = JSON.stringify({
    type: 'published-content-search',
    query: query.toLowerCase(),
  })
  const decoded = cursorValue ? decodeScopedCursor(cursorValue, scope) : null
  const cursorClause = decoded
    ? 'AND (created_at < ? OR (created_at = ? AND id < ?))'
    : ''
  const cursorBindings: unknown[] = decoded
    ? [decoded.updatedAt, decoded.updatedAt, decoded.id]
    : []

  const rows = await db.prepare(`
    SELECT id, content_type, owner_user_id, creator_id, ip_id, state, scheduled_at, access_mode,
           version, revision, slug, title, body_ref, media_refs_json, cover_ref,
           etag, created_at, updated_at
      FROM contents
     WHERE state = 'PUBLISHED'
       AND (instr(lower(title), lower(?)) > 0 OR instr(lower(slug), lower(?)) > 0)
       ${cursorClause}
     ORDER BY created_at DESC, id DESC
     LIMIT ?`).bind(query, query, ...cursorBindings, pageSize + 1).all<ContentRow>()

  const hasMore = rows.results.length > pageSize
  const items = rows.results.slice(0, pageSize).map(toContent)
  const last = items.at(-1)
  return {
    items,
    hasMore,
    nextCursor: hasMore && last
      ? encodeScopedCursor(last.createdAt, last.id, scope)
      : null,
  }
}



type FollowingContentsCursor = {
  version: 1
  viewerUserId: string
  scopeHash: string
  createdAt: string
  id: string
}

const encodeFollowingContentsCursor = (cursor: FollowingContentsCursor): string =>
  btoa(JSON.stringify(cursor)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')

const decodeFollowingContentsCursor = (
  value: string | null,
  viewerUserId: string,
  scopeHash: string,
): FollowingContentsCursor | null => {
  if (!value) return null
  if (value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ContentRuntimeError('INVALID_CURSOR', 400)
  }
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
    const parsed = JSON.parse(atob(padded)) as Partial<FollowingContentsCursor>
    if (
      parsed.version !== 1 ||
      parsed.viewerUserId !== viewerUserId ||
      parsed.scopeHash !== scopeHash ||
      typeof parsed.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(parsed.createdAt)) ||
      typeof parsed.id !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(parsed.id)
    ) {
      throw new Error('invalid following cursor')
    }
    return {
      version: 1,
      viewerUserId,
      scopeHash,
      createdAt: parsed.createdAt,
      id: parsed.id,
    }
  } catch {
    throw new ContentRuntimeError('INVALID_CURSOR', 400)
  }
}

export async function listFollowingOwnerContents(
  db: ContentD1,
  viewerUserId: string,
  followedOwnerIdsInput: string[],
  cursorValue: string | null,
  limit: number,
): Promise<{ items: ContentRecord[]; nextCursor: string | null; hasMore: boolean }> {
  const viewerId = viewerUserId.trim()
  assertResourceId(viewerId)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
  const ownerIds = [...new Set(followedOwnerIdsInput.map((id) => id.trim()))].sort()
  if (ownerIds.length < 1 || ownerIds.length > 500) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
  for (const ownerId of ownerIds) assertResourceId(ownerId)

  const scopeHash = await sha256Hex(JSON.stringify({
    type: 'following-feed',
    viewerUserId: viewerId,
    ownerIds,
  }))
  const cursor = decodeFollowingContentsCursor(cursorValue, viewerId, scopeHash)
  const cursorClause = cursor
    ? 'AND (c.created_at < ? OR (c.created_at = ? AND c.id < ?))'
    : ''
  const cursorBindings: unknown[] = cursor
    ? [cursor.createdAt, cursor.createdAt, cursor.id]
    : []
  const ownerIdsJson = JSON.stringify(ownerIds)
  const rows = await db.prepare(`
    SELECT c.id, c.content_type, c.owner_user_id, c.creator_id, c.ip_id, c.state,
           c.scheduled_at, c.access_mode, c.version, c.revision, c.slug, c.title, c.body_ref,
           c.media_refs_json, c.cover_ref, c.etag, c.created_at, c.updated_at
      FROM contents c
     WHERE c.state = 'PUBLISHED'
       AND c.owner_user_id IN (SELECT value FROM json_each(?))
       ${cursorClause}
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT ?`).bind(
       ownerIdsJson,
       ...cursorBindings,
       limit + 1,
     ).all<ContentRow>()

  const sourceRows = rows.results ?? []
  const hasMore = sourceRows.length > limit
  const items = sourceRows.slice(0, limit).map(toContent)
  const last = items.at(-1)
  return {
    items,
    hasMore,
    nextCursor: hasMore && last
      ? encodeFollowingContentsCursor({
          version: 1,
          viewerUserId: viewerId,
          scopeHash,
          createdAt: last.createdAt,
          id: last.id,
        })
      : null,
  }
}

export async function createContent(
  db: ContentD1,
  ownerUserId: string,
  input: unknown,
  idempotencyKey: string,
  now = new Date(),
  correlationId = 'runtime',
  verifiedCreatorId?: string,
): Promise<ContentRecord> {
  assertResourceId(ownerUserId)
  if (!idempotencyKey || idempotencyKey.length > 256) {
    throw new ContentRuntimeError('PRECONDITION_REQUIRED', 428)
  }

  const normalized = validateInput(input)
  let creatorId = ownerUserId
  if (normalized.accessMode === 'MEMBERS_ONLY') {
    if (!verifiedCreatorId) throw new ContentRuntimeError('PERMISSION_DENIED', 403)
    assertResourceId(verifiedCreatorId)
    creatorId = verifiedCreatorId
  }
  const operationId = 'createContent'
  // Keep old public-create idempotency material byte-for-byte compatible. A
  // paid creator offer additionally binds the verified W08 creator identity.
  const hashInput = normalized.accessMode === 'MEMBERS_ONLY'
    ? { ownerUserId, input: normalized, verifiedCreatorId: creatorId }
    : { ownerUserId, input: normalized }
  const hash = await requestHash(operationId, hashInput)

  const existing = await db.prepare(
    `SELECT id AS idem_id, owner_user_id AS idem_owner_user_id, request_hash AS idem_request_hash,
            status AS idem_status, response_status AS idem_response_status, response_json AS idem_response_json,
            expires_at AS idem_expires_at
       FROM content_mutation_idempotency
      WHERE owner_user_id = ? AND operation_id = ? AND idempotency_key = ?
      ORDER BY created_at DESC LIMIT 1`,
  ).bind(ownerUserId, operationId, idempotencyKey).first<IdempotencyRow>()

  const replay = inspectIdempotency(existing, ownerUserId, hash, now)
  if (replay.replayed) {
    const parsed = replay.body as Partial<ContentRecord> | null
    if (
      !parsed ||
      typeof parsed.id !== 'string' ||
      !['article', 'post', 'video'].includes(String(parsed.contentType)) ||
      parsed.ownerUserId !== ownerUserId ||
      parsed.creatorId !== creatorId ||
      parsed.ipId !== null ||
      !isState(parsed.state) ||
      typeof parsed.version !== 'number' ||
      parsed.version < 1 ||
      typeof parsed.revision !== 'number' ||
      parsed.revision < 1 ||
      typeof parsed.slug !== 'string' ||
      typeof parsed.title !== 'string' ||
      (parsed.accessMode !== undefined && !['PUBLIC', 'MEMBERS_ONLY'].includes(String(parsed.accessMode))) ||
      typeof parsed.bodyRef !== 'string' ||
      !Array.isArray(parsed.mediaRefs) ||
      parsed.mediaRefs.some(ref => typeof ref !== 'string') ||
      (parsed.coverRef !== null && typeof parsed.coverRef !== 'string') ||
      typeof parsed.etag !== 'string' ||
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.updatedAt !== 'string' ||
      (parsed.scheduledAt !== undefined && parsed.scheduledAt !== null && typeof parsed.scheduledAt !== 'string')
    ) {
      throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
    }
    return parsed as ContentRecord
  }

  let contentId: string
  try {
    // Every newly created content type shares W03's atomic D1-02 ID sequence.
    // Never fall back to an isolate-local generator: concurrent W03 isolates
    // must draw from the same uniqueness boundary.
    contentId = await allocateContentSnowflakeId(db, now.getTime())
  } catch {
    throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  const slug = contentSlugFor(normalized.title, contentId)
  const createdAt = now.toISOString()
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()
  const createdContent: ContentRecord = {
    id: contentId,
    contentType: normalized.contentType,
    ownerUserId,
    creatorId,
    ipId: null,
    state: 'DRAFT',
    scheduledAt: null,
    accessMode: normalized.accessMode ?? 'PUBLIC',
    accessGranted: true,
    version: 1,
    revision: 1,
    slug,
    title: normalized.title,
    bodyRef: normalized.bodyRef,
    mediaRefs: normalized.mediaRefs,
    coverRef: normalized.coverRef,
    etag: etagForVersion(1),
    createdAt,
    updatedAt: createdAt,
  }

  await batchMutation(db, [
    expireMutationRow(db, ownerUserId, operationId, idempotencyKey, createdAt),
    insertCompletedIdempotency(db, ownerUserId, operationId, idempotencyKey, hash, 201, JSON.stringify(createdContent), createdAt, expiresAt),
    db.prepare(
      `INSERT INTO contents
        (id, content_type, owner_user_id, creator_id, ip_id, state, scheduled_at, access_mode, version, revision, slug, title, body_ref, media_refs_json, cover_ref, etag, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 'DRAFT', NULL, ?, 1, 1, ?, ?, ?, ?, ?, ?, ?, ?) `,
    ).bind(contentId, normalized.contentType, ownerUserId, creatorId, normalized.accessMode ?? 'PUBLIC', slug, normalized.title, normalized.bodyRef, JSON.stringify(normalized.mediaRefs), normalized.coverRef, createdContent.etag, createdAt, createdAt),
    atomicGuard(db),
    insertRevision(db, {
      id: crypto.randomUUID(),
      contentId,
      revision: 1,
      contentVersion: 1,
      actorUserId: ownerUserId,
      sourceRevision: null,
      operation: 'CREATE',
      state: 'DRAFT',
      accessMode: createdContent.accessMode,
      slug,
      title: normalized.title,
      bodyRef: normalized.bodyRef,
      mediaRefs: normalized.mediaRefs,
      coverRef: createdContent.coverRef,
      etag: createdContent.etag,
      reason: null,
      correlationId: normalizeCorrelationId(correlationId),
      createdAt,
    }),
  ])

  return createdContent
}

export async function updateContent(
  db: ContentD1,
  principalUserId: string,
  contentId: string,
  input: unknown,
  ifMatch: string,
  idempotencyKey: string,
  now = new Date(),
  correlationId = 'runtime',
  principalLayer?: string,
  verifiedCreatorId?: string,
): Promise<ContentRecord> {
  assertResourceId(principalUserId)
  assertResourceId(contentId)
  if (!ifMatch || !idempotencyKey) throw new ContentRuntimeError('PRECONDITION_REQUIRED', 428)

  const normalized = validateInput(input)
  const operationId = 'updateContent'
  const hash = await requestHash(operationId, { contentId, input: normalized, ifMatch: normalizeEtag(ifMatch) })
  const { content, idempotency } = await loadMutationRow(db, contentId, operationId, idempotencyKey, principalUserId)
  const replay = inspectIdempotency(idempotency, principalUserId, hash, now)
  if (replay.replayed) {
    if (!replay.body) throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
    return replay.body as ContentRecord
  }
  if (!content) throw new ContentRuntimeError('NOT_FOUND', 404)
  if (content.ownerUserId !== principalUserId) throw new ContentRuntimeError('PERMISSION_DENIED', 403)
  if (isSocialOnlyLayer(principalLayer) && content.contentType !== 'post') {
    throw new ContentRuntimeError('PERMISSION_DENIED', 403)
  }
  assertEtag(content.etag, ifMatch)
  if (content.contentType !== normalized.contentType) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
  const currentAccessMode = content.accessMode ?? 'PUBLIC'
  const nextAccessMode = normalized.accessMode ?? currentAccessMode
  let nextCreatorId = content.creatorId
  if (normalized.accessMode !== undefined) {
    if (!verifiedCreatorId) throw new ContentRuntimeError('PERMISSION_DENIED', 403)
    if (nextAccessMode === 'MEMBERS_ONLY' && content.creatorId !== verifiedCreatorId) {
      // Older public content stored the author user ID in creator_id. W08 has
      // just verified that this same owner has an active canonical Creator ID;
      // allow the one-way reference normalization as part of paywall activation.
      if (currentAccessMode !== 'PUBLIC' ||
          (content.creatorId !== content.ownerUserId && content.creatorId !== null)) {
        throw new ContentRuntimeError('PERMISSION_DENIED', 403)
      }
      nextCreatorId = verifiedCreatorId
    } else if (currentAccessMode === 'MEMBERS_ONLY' && content.creatorId !== verifiedCreatorId) {
      throw new ContentRuntimeError('PERMISSION_DENIED', 403)
    }
  }
  if (!EDITABLE_STATES.has(content.state)) throw new ContentRuntimeError('INVALID_STATE', 409)

  const nextVersion = content.version + 1
  const nextRevision = content.revision + 1
  const updatedAt = now.toISOString()
  const updated: ContentRecord = {
    ...content,
    creatorId: nextCreatorId,
    scheduledAt: content.scheduledAt,
    accessMode: nextAccessMode,
    accessGranted: true,
    title: normalized.title,
    bodyRef: normalized.bodyRef,
    mediaRefs: normalized.mediaRefs,
    coverRef: normalized.coverRef,
    version: nextVersion,
    revision: nextRevision,
    etag: etagForVersion(nextVersion),
    updatedAt,
  }
  const idempotencyResponseBody = JSON.stringify(updated)
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()

  await batchMutation(db, [
    expireMutationRow(db, principalUserId, operationId, idempotencyKey, updatedAt),
    insertCompletedIdempotency(db, principalUserId, operationId, idempotencyKey, hash, 200, idempotencyResponseBody, updatedAt, expiresAt),
    db.prepare(
      `UPDATE contents
          SET creator_id = ?, title = ?, body_ref = ?, media_refs_json = ?, cover_ref = ?, access_mode = ?, version = ?, revision = ?, etag = ?, updated_at = ?
        WHERE id = ? AND owner_user_id = ? AND version = ? AND etag = ?`,
    ).bind(nextCreatorId, updated.title, updated.bodyRef, JSON.stringify(updated.mediaRefs), updated.coverRef, nextAccessMode, nextVersion, nextRevision, updated.etag, updatedAt, content.id, principalUserId, content.version, content.etag),
    atomicGuard(db),
    insertRevision(db, {
      id: crypto.randomUUID(),
      contentId: content.id,
      revision: nextRevision,
      contentVersion: nextVersion,
      actorUserId: principalUserId,
      sourceRevision: content.revision,
      operation: 'UPDATE',
      state: content.state,
      accessMode: updated.accessMode,
      slug: updated.slug,
      title: updated.title,
      bodyRef: updated.bodyRef,
      mediaRefs: updated.mediaRefs,
      coverRef: updated.coverRef,
      etag: updated.etag,
      reason: null,
      correlationId: normalizeCorrelationId(correlationId),
      createdAt: updatedAt,
    }),
  ])

  return updated
}

export async function rollbackContentRevision(
  db: ContentD1,
  principalUserId: string,
  contentId: string,
  revisionId: string,
  ifMatch: string,
  idempotencyKey: string,
  reason: string | undefined,
  correlationId: string,
  now = new Date(),
  verifiedCreatorId?: string,
): Promise<{ content: ContentRecord; sourceRevision: number; resultingRevision: number }> {
  assertResourceId(principalUserId)
  assertResourceId(contentId)
  assertResourceId(revisionId)
  if (!ifMatch || !idempotencyKey) throw new ContentRuntimeError('PRECONDITION_REQUIRED', 428)
  if (reason !== undefined && reason.length > 2048) throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  const normalizedCorrelationId = normalizeCorrelationId(correlationId)
  const operationId = 'rollbackContentRevision'
  const hash = await requestHash(operationId, {
    contentId, revisionId, ifMatch: normalizeEtag(ifMatch), reason: reason ?? null,
  })
  const { content, idempotency } = await loadMutationRow(db, contentId, operationId, idempotencyKey, principalUserId)
  const replay = inspectIdempotency(idempotency, principalUserId, hash, now)
  if (replay.replayed) {
    if (!replay.body || typeof replay.body !== 'object') throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
    return replay.body as { content: ContentRecord; sourceRevision: number; resultingRevision: number }
  }
  if (!content) throw new ContentRuntimeError('NOT_FOUND', 404)
  if (content.ownerUserId !== principalUserId) throw new ContentRuntimeError('PERMISSION_DENIED', 403)
  assertEtag(content.etag, ifMatch)
  if (!['DRAFT', 'REJECTED', 'UNPUBLISHED', 'RESTORED'].includes(content.state)) {
    throw new ContentRuntimeError('INVALID_STATE', 409)
  }

  const source = await db.prepare(`SELECT id, content_id, revision, content_version, actor_user_id, source_revision, operation,
       state, access_mode, slug, title, body_ref, media_refs_json, cover_ref, etag, reason, correlation_id, created_at
  FROM content_revisions
 WHERE id = ? AND content_id = ?`).bind(revisionId, contentId).first<ContentRevisionRow>()
  if (!source) throw new ContentRuntimeError('NOT_FOUND', 404)

  const sourceAccessMode = source.access_mode === 'MEMBERS_ONLY' ? 'MEMBERS_ONLY' : 'PUBLIC'
  const currentAccessMode = content.accessMode ?? 'PUBLIC'
  if (sourceAccessMode !== currentAccessMode &&
      (sourceAccessMode === 'MEMBERS_ONLY' || currentAccessMode === 'MEMBERS_ONLY') &&
      (!verifiedCreatorId || verifiedCreatorId !== content.creatorId)) {
    throw new ContentRuntimeError('PERMISSION_DENIED', 403)
  }

  const nextVersion = content.version + 1
  const nextRevision = content.revision + 1
  const updatedAt = now.toISOString()
  const updated: ContentRecord = {
    ...content,
    scheduledAt: null,
    accessMode: sourceAccessMode,
    accessGranted: true,
    slug: source.slug,
    title: source.title,
    bodyRef: source.body_ref,
    mediaRefs: JSON.parse(source.media_refs_json || '[]') as string[],
    coverRef: source.cover_ref,
    version: nextVersion,
    revision: nextRevision,
    etag: etagForVersion(nextVersion),
    updatedAt,
  }
  const result = { content: updated, sourceRevision: source.revision, resultingRevision: nextRevision }
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()
  await batchMutation(db, [
    expireMutationRow(db, principalUserId, operationId, idempotencyKey, updatedAt),
    insertCompletedIdempotency(db, principalUserId, operationId, idempotencyKey, hash, 200, JSON.stringify(result), updatedAt, expiresAt),
    db.prepare(`UPDATE contents
   SET title = ?, body_ref = ?, media_refs_json = ?, cover_ref = ?, access_mode = ?, version = ?, revision = ?, etag = ?, updated_at = ?
 WHERE id = ? AND owner_user_id = ? AND version = ? AND etag = ?`).bind(
      updated.title, updated.bodyRef, JSON.stringify(updated.mediaRefs), updated.coverRef, updated.accessMode ?? 'PUBLIC',
      nextVersion, nextRevision, updated.etag, updatedAt,
      content.id, principalUserId, content.version, content.etag,
    ),
    atomicGuard(db),
    insertRevision(db, {
      id: crypto.randomUUID(),
      contentId: content.id,
      revision: nextRevision,
      contentVersion: nextVersion,
      actorUserId: principalUserId,
      sourceRevision: source.revision,
      operation: 'ROLLBACK',
      state: content.state,
      accessMode: updated.accessMode,
      slug: updated.slug,
      title: updated.title,
      bodyRef: updated.bodyRef,
      mediaRefs: updated.mediaRefs,
      coverRef: updated.coverRef,
      etag: updated.etag,
      reason: reason?.trim() || null,
      correlationId: normalizedCorrelationId,
      createdAt: updatedAt,
    }),
    db.prepare(`INSERT INTO content_outbox_events
      (event_id, operation_id, event_type, content_id, aggregate_version, payload_json, created_at, published_at)
     VALUES (?, 'rollbackContentRevision', 'content.revision.rolled_back', ?, ?, ?, ?, NULL)`).bind(
      crypto.randomUUID(),
      content.id,
      nextVersion,
      JSON.stringify({
        schemaVersion: '1.0',
        producer: 'W03',
        contentId: content.id,
        sourceRevision: source.revision,
        resultingRevision: nextRevision,
        contentVersion: nextVersion,
        actorUserId: principalUserId,
        reason: reason?.trim() || null,
        correlationId: normalizedCorrelationId,
        idempotencyKey,
      }),
      updatedAt,
    ),
  ])
  return result
}

export async function deleteContent(
  db: ContentD1,
  principalUserId: string,
  contentId: string,
  ifMatch: string,
  idempotencyKey: string,
  now = new Date(),
  principalLayer?: string,
): Promise<void> {
  assertResourceId(principalUserId)
  assertResourceId(contentId)
  if (!ifMatch || !idempotencyKey) throw new ContentRuntimeError('PRECONDITION_REQUIRED', 428)

  const operationId = 'deleteContent'
  const hash = await requestHash(operationId, { contentId, ifMatch: normalizeEtag(ifMatch) })
  const { content, idempotency } = await loadMutationRow(db, contentId, operationId, idempotencyKey, principalUserId)
  const replay = inspectIdempotency(idempotency, principalUserId, hash, now)
  if (replay.replayed) return
  if (!content) throw new ContentRuntimeError('NOT_FOUND', 404)
  if (content.ownerUserId !== principalUserId) throw new ContentRuntimeError('PERMISSION_DENIED', 403)
  if (isSocialOnlyLayer(principalLayer) && content.contentType !== 'post') {
    throw new ContentRuntimeError('PERMISSION_DENIED', 403)
  }
  assertEtag(content.etag, ifMatch)
  if (!['DRAFT','PUBLISHED','UNPUBLISHED','ARCHIVED'].includes(content.state)) {
    throw new ContentRuntimeError('INVALID_STATE', 409)
  }

  const updatedAt = now.toISOString()
  const deletedVersion = content.version + 1
  const updatedEtag = etagForVersion(deletedVersion)
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()

  await batchMutation(db, [
    expireMutationRow(db, principalUserId, operationId, idempotencyKey, updatedAt),
    insertCompletedIdempotency(db, principalUserId, operationId, idempotencyKey, hash, 204, '', updatedAt, expiresAt),
    db.prepare(
      `UPDATE contents SET state='DELETED', version=?, etag=?, updated_at=?
        WHERE id=? AND owner_user_id=? AND version=? AND etag=?`,
    ).bind(deletedVersion, updatedEtag, updatedAt, content.id, principalUserId, content.version, content.etag),
    atomicGuard(db),
  ])
}

const isSocialOnlyLayer = (layer: string | undefined): boolean =>
  layer === 'L2' || /^L[5-8]$/.test(layer ?? '')

const actorKindForLayer = (layer: string): 'SOCIAL_AUTHOR' | 'CREATOR' | null =>
  isSocialOnlyLayer(layer) ? 'SOCIAL_AUTHOR' : /^L[3-4]$/.test(layer) ? 'CREATOR' : null

export const canTransitionContentState = (
  from: ContentState,
  to: ContentState,
  kind: 'SOCIAL_AUTHOR' | 'CREATOR' | 'MODERATOR',
  owns: boolean,
  reason?: string,
  contentType?: ContentType,
): boolean => {
  if (kind === 'MODERATOR') {
    return from === 'PENDING_REVIEW' && (to === 'APPROVED' || to === 'REJECTED')
  }
  if (!owns) return false

  // Social authors may publish an ordinary post directly. Editing a published
  // post preserves immutable public revisions by requiring it to be unpublished,
  // returned to draft, edited under If-Match, and explicitly published again.
  // This never grants article/video, review, scheduling, or moderation authority.
  if (kind === 'SOCIAL_AUTHOR') {
    if (contentType !== 'post') return false
    return (
      (from === 'DRAFT' && to === 'PUBLISHED') ||
      (from === 'PUBLISHED' && to === 'UNPUBLISHED') ||
      (from === 'UNPUBLISHED' && to === 'DRAFT')
    )
  }
  if (contentType === 'post' && from === 'DRAFT' && to === 'PUBLISHED') return true

  if (from === 'DRAFT' && to === 'PENDING_REVIEW') return true
  if (from === 'REJECTED' && to === 'DRAFT') return true
  if (from === 'APPROVED' && to === 'PUBLISHED') return true
  if (from === 'APPROVED' && to === 'SCHEDULED') return true
  if (from === 'SCHEDULED' && to === 'DRAFT') return true
  if (from === 'PUBLISHED' && (to === 'UNPUBLISHED' || to === 'ARCHIVED')) return true
  if (from === 'PUBLISHED' && to === 'PENDING_REVIEW') return reason === 'material_edit_requires_review'
  if (from === 'UNPUBLISHED' && (to === 'PUBLISHED' || to === 'DRAFT')) return true
  if (from === 'ARCHIVED' && to === 'DRAFT') return true
  if (from === 'DELETED' && to === 'RESTORED') return true
  if (from === 'RESTORED' && to === 'DRAFT') return true
  return false
}

const normalizeScheduledAt = (value: unknown, now: Date): string => {
  if (typeof value !== 'string' || !value.trim()) throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed) || parsed <= now.getTime()) throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  return new Date(parsed).toISOString()
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
  options: { scheduledAt?: string | null; preflight?: unknown; verifiedCreatorId?: string } = {},
): Promise<{ from: ContentState; to: ContentState; version: number; etag: string; scheduledAt?: string | null }> {
  assertResourceId(principalUserId)
  assertResourceId(contentId)
  if (!isState(to) || !ifMatch || !idempotencyKey) {
    throw new ContentRuntimeError('PRECONDITION_REQUIRED', 428)
  }

  const kind = actorKindForLayer(principalLayer)
  if (!kind) throw new ContentRuntimeError('PERMISSION_DENIED', 403)
  // Social authors can publish drafts directly, and can edit their own published
  // posts only through the explicit PUBLISHED -> UNPUBLISHED -> DRAFT path.
  // Reject unrelated targets before D1; resource ownership and source state are
  // re-checked against the authoritative row below.
  if (kind === 'SOCIAL_AUTHOR' && !['PUBLISHED', 'UNPUBLISHED', 'DRAFT'].includes(to)) {
    throw new ContentRuntimeError('PERMISSION_DENIED', 403)
  }

  const operationId = 'transitionContentState'
  const normalizedRequestedScheduledAt = to === 'SCHEDULED' ? normalizeScheduledAt(options.scheduledAt, now) : null
  const hashInput = {
    contentId,
    to,
    reason: reason ?? null,
    ifMatch: normalizeEtag(ifMatch),
    ...(to === 'SCHEDULED' ? { scheduledAt: normalizedRequestedScheduledAt } : {}),
  }
  const hash = await requestHash(operationId, hashInput)
  const { content, idempotency } = await loadMutationRow(db, contentId, operationId, idempotencyKey, principalUserId)
  const replay = inspectIdempotency(idempotency, principalUserId, hash, now)
  if (replay.replayed) {
    if (!replay.body) throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
    return replay.body as { from: ContentState; to: ContentState; version: number; etag: string }
  }
  if (!content) throw new ContentRuntimeError('NOT_FOUND', 404)

  if ((to === 'PUBLISHED' || to === 'SCHEDULED') && content.accessMode === 'MEMBERS_ONLY' &&
      (!options.verifiedCreatorId || options.verifiedCreatorId !== content.creatorId)) {
    throw new ContentRuntimeError('PERMISSION_DENIED', 403)
  }

  assertEtag(content.etag, ifMatch)
  const ownsContent = content.ownerUserId === principalUserId
  if (!ownsContent) {
    throw new ContentRuntimeError('PERMISSION_DENIED', 403)
  }
  if (kind === 'SOCIAL_AUTHOR') {
    if (content.contentType !== 'post') {
      throw new ContentRuntimeError('PERMISSION_DENIED', 403)
    }
    const isOwnerPostEditTransition =
      (content.state === 'PUBLISHED' && to === 'UNPUBLISHED') ||
      (content.state === 'UNPUBLISHED' && to === 'DRAFT')
    if (to !== 'PUBLISHED' && !isOwnerPostEditTransition) {
      throw new ContentRuntimeError('PERMISSION_DENIED', 403)
    }
  }

  // Direct publication is narrowly available for draft social posts only.
  // Re-run the risk/quality preflight at the content authority before any write.
  if (content.state === 'DRAFT' && content.contentType === 'post' && to === 'PUBLISHED') {
    if (!options.preflight || typeof options.preflight !== 'object' || Array.isArray(options.preflight)) {
      throw new ContentRuntimeError('VALIDATION_FAILED', 400)
    }
    let report
    try {
      const preflightInput = normalizePreflightInput(options.preflight)
      const rawPreflight = options.preflight as Record<string, unknown>
      if (
        preflightInput.contentType !== content.contentType ||
        typeof rawPreflight.title !== 'string' ||
        rawPreflight.title.trim() !== content.title
      ) {
        throw new Error('PREFLIGHT_CONTENT_MISMATCH')
      }
      report = preflightContent(preflightInput)
    } catch {
      throw new ContentRuntimeError('VALIDATION_FAILED', 400)
    }
    if (report.verdict === 'RED') throw new ContentRuntimeError('VALIDATION_FAILED', 422)
  }

  if (!canTransitionContentState(content.state, to, kind, ownsContent, reason, content.contentType)) {
    throw new ContentRuntimeError('INVALID_STATE', 409)
  }

  if (to !== 'SCHEDULED' && options.scheduledAt !== undefined && options.scheduledAt !== null) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }

  const nextVersion = content.version + 1
  const updatedAt = now.toISOString()
  const scheduledAt = to === 'SCHEDULED' ? normalizedRequestedScheduledAt : null
  const result = { from: content.state, to, version: nextVersion, etag: etagForVersion(nextVersion), scheduledAt }
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()

  await batchMutation(db, [
    expireMutationRow(db, principalUserId, operationId, idempotencyKey, updatedAt),
    insertCompletedIdempotency(db, principalUserId, operationId, idempotencyKey, hash, 200, JSON.stringify(result), updatedAt, expiresAt),
    db.prepare(
      `UPDATE contents SET state=?, scheduled_at=?, version=?, etag=?, updated_at=?
        WHERE id=? AND version=? AND etag=?`,
    ).bind(to, scheduledAt, nextVersion, result.etag, updatedAt, content.id, content.version, content.etag),
    atomicGuard(db),
  ])

  return result
}

export async function publishDueScheduledContent(
  db: ContentD1,
  now = new Date(),
  limit = 50,
): Promise<{ scanned: number; published: number }> {
  const pageSize = Math.min(Math.max(Number.isSafeInteger(limit) ? limit : 50, 1), 50)
  const nowIso = now.toISOString()
  const rows = await db.prepare(
    `SELECT id, version, scheduled_at
       FROM contents
      WHERE state = 'SCHEDULED' AND scheduled_at IS NOT NULL AND scheduled_at <= ?
      ORDER BY scheduled_at ASC, id ASC
      LIMIT ?`,
  ).bind(nowIso, pageSize).all<{ id: string; version: number; scheduled_at: string }>()

  if (!rows.results.length) return { scanned: 0, published: 0 }

  const statements = rows.results.map((row) => {
    const nextVersion = row.version + 1
    return db.prepare(
      `UPDATE contents
          SET state = 'PUBLISHED', scheduled_at = NULL, version = ?, etag = ?, updated_at = ?
        WHERE id = ? AND state = 'SCHEDULED' AND scheduled_at = ? AND version = ?`,
    ).bind(
      nextVersion,
      etagForVersion(nextVersion),
      nowIso,
      row.id,
      row.scheduled_at,
      row.version,
    )
  })
  const results = await db.batch(statements)
  const published = results.reduce((count, result) => count + Number(result.meta?.changes ?? 0), 0)
  return { scanned: rows.results.length, published }
}

export function encodeCursor(updatedAt: string, id: string): string {
  const raw = JSON.stringify({ updatedAt, id })
  const bytes = new TextEncoder().encode(raw)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
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
    throw new ContentRuntimeError('INVALID_CURSOR', 400)
  }
}

export function encodeScopedCursor(updatedAt: string, id: string, scope: string): string {
  const raw = JSON.stringify({ version: 1, scope, updatedAt, id })
  const bytes = new TextEncoder().encode(raw)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

export function decodeScopedCursor(
  value: string,
  scope: string,
): { updatedAt: string; id: string } {
  try {
    if (!value || value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('INVALID')
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
    const bytes = Uint8Array.from(atob(padded), char => char.charCodeAt(0))
    const decoded = JSON.parse(new TextDecoder().decode(bytes)) as {
      version?: unknown
      scope?: unknown
      updatedAt?: unknown
      id?: unknown
    }
    if (
      decoded.version !== 1 ||
      decoded.scope !== scope ||
      typeof decoded.updatedAt !== 'string' ||
      !Number.isFinite(Date.parse(decoded.updatedAt)) ||
      typeof decoded.id !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(decoded.id)
    ) throw new Error('INVALID')
    return { updatedAt: decoded.updatedAt, id: decoded.id }
  } catch {
    throw new ContentRuntimeError('INVALID_CURSOR', 400)
  }
}

type ContentListCursor = {
  version: 1
  createdAt: string
  id: string
  creatorId: string | null
  ownerUserId?: string | null
  contentType: ContentType | null
}

export function encodeContentListCursor(
  createdAt: string,
  id: string,
  creatorId: string | null,
  contentType: ContentType | null,
  ownerUserId: string | null = null,
): string {
  const raw = JSON.stringify({ version: 1, createdAt, id, creatorId, ownerUserId, contentType } satisfies ContentListCursor)
  const bytes = new TextEncoder().encode(raw)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

export function decodeContentListCursor(
  value: string,
  creatorId: string | null,
  contentType: ContentType | null,
  ownerUserId: string | null = null,
): ContentListCursor {
  try {
    if (!value || value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('INVALID')
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
    const bytes = Uint8Array.from(atob(padded), char => char.charCodeAt(0))
    const decoded = JSON.parse(new TextDecoder().decode(bytes)) as Partial<ContentListCursor>
    if (
      decoded.version !== 1 ||
      typeof decoded.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(decoded.createdAt)) ||
      typeof decoded.id !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(decoded.id) ||
      (decoded.creatorId !== null && typeof decoded.creatorId !== 'string') ||
      (decoded.ownerUserId !== undefined && decoded.ownerUserId !== null && typeof decoded.ownerUserId !== 'string') ||
      (decoded.contentType !== null && !['article', 'post', 'video'].includes(decoded.contentType as string)) ||
      decoded.creatorId !== creatorId ||
      (decoded.ownerUserId ?? null) !== ownerUserId ||
      decoded.contentType !== contentType
    ) throw new Error('INVALID')
    return { ...decoded, ownerUserId: decoded.ownerUserId ?? null } as ContentListCursor
  } catch {
    throw new ContentRuntimeError('INVALID_CURSOR', 400)
  }
}

export function isState(value: unknown): value is ContentState {
  return typeof value === 'string' && (ALL_STATES as readonly string[]).includes(value)
}

export function toErrorResponse(error: unknown): Response {
  if (error instanceof ContentRuntimeError) return errorResponse(error)
  return errorResponse(new ContentRuntimeError('SERVICE_UNAVAILABLE', 503))
}

export async function applyModerationContentTransition(
  db: ContentD1,
  input: {
    contentId: string
    decisionId: string
    policyVersion: string
    outcome: Extract<ContentState, 'APPROVED' | 'REJECTED'>
    ifMatch: string
    idempotencyKey: string
  },
  now = new Date(),
): Promise<{ from: ContentState; to: ContentState; version: number; etag: string }> {
  assertResourceId(input.contentId)
  assertResourceId(input.decisionId)
  if (!input.policyVersion || input.policyVersion.length > 128) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
  if (!input.ifMatch || !input.idempotencyKey) {
    throw new ContentRuntimeError('PRECONDITION_REQUIRED', 428)
  }
  if (input.outcome !== 'APPROVED' && input.outcome !== 'REJECTED') {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }

  const operationId = 'transitionContentState'
  const hash = await requestHash(operationId, {
    moderation: true,
    contentId: input.contentId,
    decisionId: input.decisionId,
    policyVersion: input.policyVersion,
    outcome: input.outcome,
    ifMatch: normalizeEtag(input.ifMatch),
  })
  const { content, idempotency } = await loadMutationRow(
    db,
    input.contentId,
    operationId,
    input.idempotencyKey,
    'W06',
  )
  const replay = inspectIdempotency(idempotency, 'W06', hash, now)
  if (replay.replayed) {
    if (!replay.body) throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
    return replay.body as { from: ContentState; to: ContentState; version: number; etag: string }
  }
  if (!content) throw new ContentRuntimeError('NOT_FOUND', 404)

  assertEtag(content.etag, input.ifMatch)
  if (content.state !== 'PENDING_REVIEW') {
    throw new ContentRuntimeError('INVALID_STATE', 409)
  }

  const nextVersion = content.version + 1
  const updatedAt = now.toISOString()
  const result = {
    from: content.state,
    to: input.outcome,
    version: nextVersion,
    etag: etagForVersion(nextVersion),
  }
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()

  await batchMutation(db, [
    expireMutationRow(db, 'W06', operationId, input.idempotencyKey, updatedAt),
    insertCompletedIdempotency(
      db,
      'W06',
      operationId,
      input.idempotencyKey,
      hash,
      200,
      JSON.stringify(result),
      updatedAt,
      expiresAt,
    ),
    db.prepare(
      `UPDATE contents SET state=?, version=?, etag=?, updated_at=?
        WHERE id=? AND version=? AND etag=?`,
    ).bind(
      input.outcome,
      nextVersion,
      result.etag,
      updatedAt,
      content.id,
      content.version,
      content.etag,
    ),
    atomicGuard(db),
  ])

  return result
}
