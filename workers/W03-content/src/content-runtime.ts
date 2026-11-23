import { contentSlugFor, isContentSlug } from './content-slug.js'
import { normalizePreflightInput, preflightContent } from './publish-preflight.js'
import type {
  PublishedMediaReferenceReadStore,
  PublishedMediaReferenceRecord,
} from './published-media-reference-read-store.js'

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
export type ContentMediaWarning = 'NUDITY' | 'VIOLENCE' | 'SENSITIVE'

const isContentMediaWarning = (value: unknown): value is ContentMediaWarning =>
  value === 'NUDITY' || value === 'VIOLENCE' || value === 'SENSITIVE'

export interface ContentInput {
  contentType: ContentType
  title: string
  bodyRef: string
  mediaRefs: string[]
  coverRef: string | null
  accessMode?: ContentAccessMode
  mediaWarning?: ContentMediaWarning | null
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
  mediaWarning?: ContentMediaWarning | null
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
  mediaWarning?: ContentMediaWarning | null
  etag: string
  reason: string | null
  correlationId: string
  createdAt: string
}

export interface ContentRow {
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
  media_warning?: ContentMediaWarning | null
  etag: string
  created_at: string
  updated_at: string
}

export type PublicContentKeysetCursor = Readonly<{
  createdAt: string
  id: string
}>

export interface PublicContentListReadStore {
  list(input: Readonly<{
    cursor: PublicContentKeysetCursor | null
    limit: number
    creatorId: string | null
    ownerUserId: string | null
    contentType: ContentType | null
  }>): Promise<readonly ContentRow[]>
  search(input: Readonly<{
    query: string
    cursor: PublicContentKeysetCursor | null
    limit: number
  }>): Promise<readonly ContentRow[]>
}

export interface PublishedContentsByIdsReadStore {
  /** Return the published rows in the same order as the supplied IDs. */
  list(contentIds: readonly string[]): Promise<readonly ContentRow[]>
}

export type FollowingOwnerContentsCursor = Readonly<{
  createdAt: string
  id: string
}>

export interface FollowingOwnerContentsReadStore {
  /** Return the published rows in stable descending feed order. */
  list(
    ownerIds: readonly string[],
    cursor: FollowingOwnerContentsCursor | null,
    limit: number,
  ): Promise<readonly ContentRow[]>
}

export interface ContentDetailReadStore {
  /** Resolve published content by ID or slug, or unpublished content owned by the principal. */
  getContent(contentIdOrSlug: string, principalUserId: string | null): Promise<ContentRow | null>
}

export type CreatorContentsCursor = Readonly<{
  updatedAt: string
  id: string
}>

export type CreatorContentsFilters = Readonly<{
  status?: ContentState
  contentType?: ContentType
}>

export interface CreatorContentsReadStore {
  list(
    ownerUserId: string,
    cursor: CreatorContentsCursor | null,
    limit: number,
    filters: CreatorContentsFilters,
  ): Promise<readonly ContentRow[]>
}

export type ContentRevisionCursor = Readonly<{
  updatedAt: string
  id: string
}>

/** Owner-scoped PostgreSQL reader for the content revision history endpoints. */
export interface ContentRevisionReadStore {
  list(
    principalUserId: string,
    contentId: string,
    cursor: ContentRevisionCursor | null,
    limit: number,
  ): Promise<readonly ContentRevision[]>
  get(
    principalUserId: string,
    contentId: string,
    revisionId: string,
  ): Promise<ContentRevision | null>
}


export interface IdempotencyRow {
  idem_id: string | null
  idem_owner_user_id: string | null
  idem_request_hash: string | null
  idem_status: 'IN_PROGRESS' | 'COMPLETED' | null
  idem_response_status: number | null
  idem_response_json: string | null
  idem_expires_at: string | null
}

export interface ContentCreateStore {
  loadIdempotency(
    ownerUserId: string,
    operationId: string,
    idempotencyKey: string,
  ): Promise<IdempotencyRow | null>
  allocateContentId(nowMs: number): Promise<string>
  create(input: Readonly<{
    ownerUserId: string
    operationId: string
    idempotencyKey: string
    requestHash: string
    responseJson: string
    createdAt: string
    expiresAt: string
    content: ContentRecord
    revision: ContentRevision
  }>): Promise<void>
}

export interface ContentMutationSnapshot {
  content: ContentRecord | null
  idempotency: IdempotencyRow
}

export interface ContentMutationStore {
  loadMutation(
    ownerUserId: string,
    contentId: string,
    operationId: string,
    idempotencyKey: string,
  ): Promise<ContentMutationSnapshot>
  update(input: Readonly<{
    ownerUserId: string
    operationId: string
    idempotencyKey: string
    requestHash: string
    responseJson: string
    updatedAt: string
    expiresAt: string
    expectedVersion: number
    expectedEtag: string
    content: ContentRecord
    revision: ContentRevision
  }>): Promise<void>
  delete(input: Readonly<{
    ownerUserId: string
    operationId: string
    idempotencyKey: string
    requestHash: string
    deletedAt: string
    expiresAt: string
    contentId: string
    expectedVersion: number
    expectedEtag: string
    nextVersion: number
    nextEtag: string
  }>): Promise<void>
  transition(input: Readonly<{
    ownerUserId: string
    operationId: string
    idempotencyKey: string
    requestHash: string
    responseJson: string
    updatedAt: string
    expiresAt: string
    contentId: string
    expectedVersion: number
    expectedEtag: string
    nextState: ContentState
    scheduledAt: string | null
    nextCreatorId: string | null
    nextVersion: number
    nextEtag: string
  }>): Promise<void>
  moderationTransition(input: Readonly<{
    idempotencyOwnerUserId: string
    operationId: string
    idempotencyKey: string
    requestHash: string
    responseJson: string
    updatedAt: string
    expiresAt: string
    contentId: string
    expectedVersion: number
    expectedEtag: string
    nextState: Extract<ContentState, 'APPROVED' | 'REJECTED'>
    nextVersion: number
    nextEtag: string
  }>): Promise<void>
  loadRevision(contentId: string, revisionId: string): Promise<ContentRevision | null>
  rollback(input: Readonly<{
    ownerUserId: string
    operationId: string
    idempotencyKey: string
    requestHash: string
    responseJson: string
    updatedAt: string
    expiresAt: string
    expectedVersion: number
    expectedEtag: string
    content: ContentRecord
    revision: ContentRevision
    outboxEventPayloadJson: string
  }>): Promise<void>
  listDueScheduled(now: string, limit: number): Promise<DueScheduledContentCandidate[]>
  publishScheduled(
    candidates: readonly AuthorizedScheduledPublishCandidate[],
    now: string,
  ): Promise<number>
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
  mediaWarning: row.media_warning ?? null,
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
    mediaWarning: accessGranted ? content.mediaWarning ?? null : null,
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

/**
 * Resolves a delivery URL against currently published content references.
 * Public media keeps the existing public-post-only rule. If a reference is used
 * by any member-only content, the URL is protected and must pass a fresh
 * subscription check; it cannot fall back to anonymous public delivery merely
 * because the same object is also referenced by a public post.
 */
export async function resolvePublishedMediaReferenceAccess(
  mediaUrlValue: string,
  viewerUserId: string | null,
  hasCreatorMembership: CreatorMembershipAccessResolver | undefined,
  readStore: PublishedMediaReferenceReadStore,
): Promise<PublishedMediaReferenceAccess> {
  const candidates = publicPostMediaReferenceCandidates(mediaUrlValue)
  if (candidates.length === 0) {
    return { isPublic: false, isMemberContent: false, allowed: false }
  }
  let rows: readonly PublishedMediaReferenceRecord[]
  try {
    rows = await readStore.listPublishedMediaReferences(candidates, 51)
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
  const candidate = input as { contentType?: unknown; title?: unknown; bodyRef?: unknown; mediaRefs?: unknown; coverRef?: unknown; accessMode?: unknown; mediaWarning?: unknown }
  const contentType = candidate.contentType === undefined ? 'article' : candidate.contentType
  const mediaRefs = candidate.mediaRefs === undefined ? [] : candidate.mediaRefs
  // Keep omission backward-compatible in the canonical idempotency hash.
  // Persistence and read-time defaults still resolve omitted accessMode to PUBLIC.
  const accessMode = candidate.accessMode
  const mediaWarning = candidate.mediaWarning
  if (
    !['article', 'post', 'video'].includes(String(contentType)) ||
    (accessMode !== undefined && !['PUBLIC', 'MEMBERS_ONLY'].includes(String(accessMode))) ||
    (mediaWarning !== undefined && mediaWarning !== null && !isContentMediaWarning(mediaWarning)) ||
    (mediaWarning !== undefined && mediaWarning !== null && (contentType !== 'post' || !Array.isArray(mediaRefs) || mediaRefs.length === 0)) ||
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
  return { contentType: contentType as ContentType, title: candidate.title.trim(), bodyRef: candidate.bodyRef.trim(), mediaRefs: mediaRefs.map(ref => ref.trim()), coverRef: candidate.coverRef === undefined || candidate.coverRef === null ? null : candidate.coverRef.trim(), accessMode: accessMode as ContentAccessMode | undefined, mediaWarning: mediaWarning as ContentMediaWarning | null | undefined }
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


const revisionPageSize = (limit: number): number =>
  Math.min(Math.max(Number.isSafeInteger(limit) ? limit : 20, 1), 100)

const normalizeCorrelationId = (value: string): string => {
  const normalized = value.trim()
  if (!normalized || normalized.length > 256) throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  return normalized
}

const emptyIdempotency = (): IdempotencyRow => ({
  idem_id: null,
  idem_owner_user_id: null,
  idem_request_hash: null,
  idem_status: null,
  idem_response_status: null,
  idem_response_json: null,
  idem_expires_at: null,
})

export type CreatorMembershipAccessResolver = (creatorId: string) => Promise<boolean>

export async function getContent(
  readStore: ContentDetailReadStore,
  contentId: string,
  principalUserId: string | null,
  resolveCreatorMembershipAccess?: CreatorMembershipAccessResolver,
): Promise<ContentRecord> {
  assertContentReference(contentId)
  const row = await readStore.getContent(contentId, principalUserId)
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

/** Minimal public author projection for W01 server-rendered pages. */
export type PublishedContentAuthorContext = Readonly<{
  contentId: string
  ownerUserId: string
}>

export type OwnedPostContext = {
  contentId: string
  ownerUserId: string
  contentType: 'post'
  state: 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED'
  updatedAt: string
}

/** Minimal published content context for W05 social reads and visibility checks. */
export type PublishedContentSocialContext = {
  contentId: string
  ownerUserId: string | null
  contentType: ContentType
  state: 'PUBLISHED'
  updatedAt: string
}

export type PublishedContentSocialSummaryContext = PublishedContentSocialContext & { title: string }

export async function listContentRevisions(
  readStore: ContentRevisionReadStore,
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
  const rows = await readStore.list(principalUserId, contentId, decoded, pageSize + 1)
  const hasMore = rows.length > pageSize
  const page = rows.slice(0, pageSize)
  const last = page.at(-1)
  return {
    items: page,
    hasMore,
    nextCursor: hasMore && last ? encodeScopedCursor(last.createdAt, last.id, cursorScope) : null,
  }
}

export async function getContentRevision(
  readStore: ContentRevisionReadStore,
  principalUserId: string,
  contentId: string,
  revisionId: string,
): Promise<ContentRevision> {
  assertResourceId(principalUserId)
  assertResourceId(contentId)
  assertResourceId(revisionId)
  const revision = await readStore.get(principalUserId, contentId, revisionId)
  if (!revision) throw new ContentRuntimeError('NOT_FOUND', 404)
  return revision
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
  readStore: CreatorContentsReadStore,
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
  const rows = await readStore.list(ownerUserId, decoded, pageSize + 1, filters)
  const hasMore = rows.length > pageSize
  const page = rows.slice(0, pageSize).map(toContent)
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
  readStore: PublishedContentsByIdsReadStore,
  contentIds: string[],
): Promise<ContentRecord[]> {
  if (!Array.isArray(contentIds) || contentIds.length > 50) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
  const ids = [...new Set(contentIds)]
  for (const id of ids) assertResourceId(id)
  if (ids.length === 0) return []
  const rows = await readStore.list(ids)
  return rows.map(toContent)
}


export async function listContents(
  readStore: PublicContentListReadStore,
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
  const rows = await readStore.list({
    cursor: decoded,
    limit: pageSize + 1,
    creatorId,
    ownerUserId,
    contentType,
  })
  const hasMore = rows.length > pageSize
  const page = rows.slice(0, pageSize).map(toContent)
  const last = page.at(-1)
  return {
    items: page,
    hasMore,
    nextCursor: hasMore && last
      ? encodeContentListCursor(last.createdAt, last.id, creatorId, contentType, ownerUserId)
      : null,
  }
}


export async function searchPublishedContents(
  readStore: PublicContentListReadStore,
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
  const rows = await readStore.search({
    query,
    cursor: decoded ? { createdAt: decoded.updatedAt, id: decoded.id } : null,
    limit: pageSize + 1,
  })
  const hasMore = rows.length > pageSize
  const items = rows.slice(0, pageSize).map(toContent)
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
  readStore: FollowingOwnerContentsReadStore,
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
  const sourceRows = [...await readStore.list(ownerIds, cursor, limit + 1)]
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
  ownerUserId: string,
  input: unknown,
  idempotencyKey: string,
  now: Date = new Date(),
  correlationId = 'runtime',
  verifiedCreatorId: string | undefined,
  mutationStore: ContentCreateStore,
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

  const existing = await mutationStore.loadIdempotency(
    ownerUserId,
    operationId,
    idempotencyKey,
  )

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
    // All W03 content IDs use the shared PostgreSQL sequence on D1-02 / Neon.
    // Allocation is atomic across isolates and never falls back to D1 or memory.
    contentId = await mutationStore.allocateContentId(now.getTime())
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
    mediaWarning: normalized.mediaWarning ?? null,
    etag: etagForVersion(1),
    createdAt,
    updatedAt: createdAt,
  }

  const revision: ContentRevision = {
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
    mediaWarning: createdContent.mediaWarning,
    etag: createdContent.etag,
    reason: null,
    correlationId: normalizeCorrelationId(correlationId),
    createdAt,
  }

  await mutationStore.create({
    ownerUserId,
    operationId,
    idempotencyKey,
    requestHash: hash,
    responseJson: JSON.stringify(createdContent),
    createdAt,
    expiresAt,
    content: createdContent,
    revision,
  })

  return createdContent
}

export async function updateContent(
  principalUserId: string,
  contentId: string,
  input: unknown,
  ifMatch: string,
  idempotencyKey: string,
  mutationStore: ContentMutationStore,
  now: Date = new Date(),
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
  const { content, idempotency } = await mutationStore.loadMutation(
    principalUserId,
    contentId,
    operationId,
    idempotencyKey,
  )
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
  const nextMediaWarning = normalized.mediaRefs.length === 0
    ? null
    : normalized.mediaWarning === undefined
      ? content.mediaWarning ?? null
      : normalized.mediaWarning
  if (nextMediaWarning !== null && content.contentType !== 'post') {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
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
    mediaWarning: nextMediaWarning,
    version: nextVersion,
    revision: nextRevision,
    etag: etagForVersion(nextVersion),
    updatedAt,
  }
  const idempotencyResponseBody = JSON.stringify(updated)
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()

  const revision: ContentRevision = {
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
    mediaWarning: updated.mediaWarning,
    etag: updated.etag,
    reason: null,
    correlationId: normalizeCorrelationId(correlationId),
    createdAt: updatedAt,
  }

  await mutationStore.update({
    ownerUserId: principalUserId,
    operationId,
    idempotencyKey,
    requestHash: hash,
    responseJson: idempotencyResponseBody,
    updatedAt,
    expiresAt,
    expectedVersion: content.version,
    expectedEtag: content.etag,
    content: updated,
    revision,
  })

  return updated
}

export async function rollbackContentRevision(
  mutationStore: ContentMutationStore,
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
  const { content, idempotency } = await mutationStore.loadMutation(
    principalUserId,
    contentId,
    operationId,
    idempotencyKey,
  )
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

  const source = await mutationStore.loadRevision(contentId, revisionId)
  if (!source) throw new ContentRuntimeError('NOT_FOUND', 404)

  const sourceAccessMode = source.accessMode === 'MEMBERS_ONLY' ? 'MEMBERS_ONLY' : 'PUBLIC'
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
    bodyRef: source.bodyRef,
    mediaRefs: source.mediaRefs,
    coverRef: source.coverRef,
    mediaWarning: source.mediaWarning ?? null,
    version: nextVersion,
    revision: nextRevision,
    etag: etagForVersion(nextVersion),
    updatedAt,
  }
  const result = { content: updated, sourceRevision: source.revision, resultingRevision: nextRevision }
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()
  const rollbackRevision: ContentRevision = {
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
    mediaWarning: updated.mediaWarning,
    etag: updated.etag,
    reason: reason?.trim() || null,
    correlationId: normalizedCorrelationId,
    createdAt: updatedAt,
  }
  const outboxEventPayloadJson = JSON.stringify({
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
  })

  await mutationStore.rollback({
    ownerUserId: principalUserId,
    operationId,
    idempotencyKey,
    requestHash: hash,
    responseJson: JSON.stringify(result),
    updatedAt,
    expiresAt,
    expectedVersion: content.version,
    expectedEtag: content.etag,
    content: updated,
    revision: rollbackRevision,
    outboxEventPayloadJson,
  })
  return result
}

export async function deleteContent(
  principalUserId: string,
  contentId: string,
  ifMatch: string,
  idempotencyKey: string,
  now: Date = new Date(),
  principalLayer: string | undefined,
  mutationStore: ContentMutationStore,
): Promise<void> {
  assertResourceId(principalUserId)
  assertResourceId(contentId)
  if (!ifMatch || !idempotencyKey) throw new ContentRuntimeError('PRECONDITION_REQUIRED', 428)

  const operationId = 'deleteContent'
  const hash = await requestHash(operationId, { contentId, ifMatch: normalizeEtag(ifMatch) })
  const { content, idempotency } = await mutationStore.loadMutation(
    principalUserId,
    contentId,
    operationId,
    idempotencyKey,
  )
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

  await mutationStore.delete({
    ownerUserId: principalUserId,
    operationId,
    idempotencyKey,
    requestHash: hash,
    deletedAt: updatedAt,
    expiresAt,
    contentId: content.id,
    expectedVersion: content.version,
    expectedEtag: content.etag,
    nextVersion: deletedVersion,
    nextEtag: updatedEtag,
  })
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
  if (contentType === 'post' && from === 'DRAFT' && to === 'SCHEDULED') return kind === 'CREATOR'

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
  mutationStore: ContentMutationStore,
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
  // Reject unrelated targets before the database call; ownership and source state are
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
  const { content, idempotency } = await mutationStore.loadMutation(
    principalUserId,
    contentId,
    operationId,
    idempotencyKey,
  )
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
  // A scheduled item must retain the canonical W08 Creator identity so the
  // execution-time permission check can re-resolve current account and role facts.
  // Legacy public content may have ownerUserId mirrored into creatorId; only that
  // self-owned placeholder may be rebound to the verified W08 Creator ID.
  if (to === 'SCHEDULED') {
    if (!options.verifiedCreatorId) {
      throw new ContentRuntimeError('PERMISSION_DENIED', 403)
    }
    if (
      content.creatorId !== null &&
      content.creatorId !== principalUserId &&
      content.creatorId !== options.verifiedCreatorId
    ) {
      throw new ContentRuntimeError('PERMISSION_DENIED', 403)
    }
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

  // Direct and scheduled publication of draft social posts share the same
  // risk/quality preflight at the content authority before any state write.
  if (content.state === 'DRAFT' && content.contentType === 'post' &&
      (to === 'PUBLISHED' || to === 'SCHEDULED')) {
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

  await mutationStore.transition({
    ownerUserId: principalUserId,
    operationId,
    idempotencyKey,
    requestHash: hash,
    responseJson: JSON.stringify(result),
    updatedAt,
    expiresAt,
    contentId: content.id,
    expectedVersion: content.version,
    expectedEtag: content.etag,
    nextState: to,
    scheduledAt,
    nextCreatorId: to === 'SCHEDULED' ? options.verifiedCreatorId ?? null : content.creatorId,
    nextVersion,
    nextEtag: result.etag,
  })

  return result
}

export type DueScheduledContentCandidate = Readonly<{
  contentId: string
  ownerUserId: string
  creatorId: string | null
  version: number
  scheduledAt: string
}>

export type ScheduledPublishAuthorization = Readonly<{
  decision: 'ALLOW'
  policyVersion: 'casl-l0-l8-v1'
  layer: 'L3' | 'L4'
  action: 'content.publish.own'
  resourceType: 'Content'
  ownerUserId: string
  creatorId: string
}>

export type AuthorizedScheduledPublishCandidate = Omit<DueScheduledContentCandidate, 'creatorId'> & Readonly<{
  expectedCreatorId: string | null
  creatorId: string
  authorization: ScheduledPublishAuthorization
}>

const scheduledPublishIdentifier = (value: unknown, maxLength = 128): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= maxLength &&
  /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)

export async function listDueScheduledContentCandidates(
  mutationStore: ContentMutationStore,
  now = new Date(),
  limit = 50,
): Promise<DueScheduledContentCandidate[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
  const nowIso = now.toISOString()
  return mutationStore.listDueScheduled(nowIso, limit)
}

/**
 * W03 remains the final content-state authority. Only a W08 ALLOW decision
 * derived from the current ACTIVE Creator/account/role facts is admitted, and
 * the final D1 update rechecks owner, creator, lifecycle, due time and version.
 */
/**
 * W03 remains the final content-state authority. Only a W08 ALLOW decision
 * derived from the current ACTIVE Creator/account/role facts is admitted, and
 * the existing Neon transaction rechecks owner, creator, lifecycle, due time and version.
 */
export async function publishAuthorizedScheduledContents(
  mutationStore: ContentMutationStore,
  candidatesValue: unknown,
  now = new Date(),
): Promise<{ scanned: number; authorized: number; published: number; rejected: number }> {
  if (!Array.isArray(candidatesValue) || candidatesValue.length > 50) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }

  const nowIso = now.toISOString()
  const authorizedCandidates: AuthorizedScheduledPublishCandidate[] = []
  let authorized = 0
  let rejected = 0

  for (const value of candidatesValue) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      rejected++
      continue
    }
    const candidate = value as Record<string, unknown>
    const authorization = candidate.authorization as Record<string, unknown> | null
    const contentId = candidate.contentId
    const ownerUserId = candidate.ownerUserId
    const creatorId = candidate.creatorId
    const version = candidate.version
    const scheduledAt = candidate.scheduledAt

    const candidateValid =
      Object.keys(candidate).every((key) => [
        'contentId', 'ownerUserId', 'expectedCreatorId', 'creatorId', 'version', 'scheduledAt', 'authorization',
      ].includes(key)) &&
      scheduledPublishIdentifier(contentId) &&
      scheduledPublishIdentifier(ownerUserId) &&
      (candidate.expectedCreatorId === null || scheduledPublishIdentifier(candidate.expectedCreatorId, 256)) &&
      scheduledPublishIdentifier(creatorId, 256) &&
      Number.isSafeInteger(version) &&
      Number(version) >= 1 &&
      typeof scheduledAt === 'string' &&
      Number.isFinite(Date.parse(scheduledAt)) &&
      Date.parse(scheduledAt) <= Date.parse(nowIso)

    const authorizationValid =
      authorization !== null &&
      typeof authorization === 'object' &&
      authorization.decision === 'ALLOW' &&
      authorization.policyVersion === 'casl-l0-l8-v1' &&
      (authorization.layer === 'L3' || authorization.layer === 'L4') &&
      authorization.action === 'content.publish.own' &&
      authorization.resourceType === 'Content' &&
      authorization.ownerUserId === ownerUserId &&
      authorization.creatorId === creatorId

    if (!candidateValid || !authorizationValid) {
      rejected++
      continue
    }

    authorized++
    authorizedCandidates.push({
      contentId: contentId as string,
      ownerUserId: ownerUserId as string,
      expectedCreatorId: candidate.expectedCreatorId as string | null,
      creatorId: creatorId as string,
      version: Number(version),
      scheduledAt: scheduledAt as string,
      authorization: authorization as unknown as ScheduledPublishAuthorization,
    })
  }

  if (authorizedCandidates.length === 0) {
    return { scanned: candidatesValue.length, authorized, published: 0, rejected }
  }

  const published = await mutationStore.publishScheduled(authorizedCandidates, nowIso)
  return { scanned: candidatesValue.length, authorized, published, rejected }
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
  mutationStore: ContentMutationStore,
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
  const { content, idempotency } = await mutationStore.loadMutation(
    'W06',
    input.contentId,
    operationId,
    input.idempotencyKey,
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

  await mutationStore.moderationTransition({
    idempotencyOwnerUserId: 'W06',
    operationId,
    idempotencyKey: input.idempotencyKey,
    requestHash: hash,
    responseJson: JSON.stringify(result),
    updatedAt,
    expiresAt,
    contentId: content.id,
    expectedVersion: content.version,
    expectedEtag: content.etag,
    nextState: input.outcome,
    nextVersion,
    nextEtag: result.etag,
  })

  return result
}
