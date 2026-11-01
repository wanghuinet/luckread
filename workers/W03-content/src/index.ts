/// <reference types="@cloudflare/workers-types" />

import {
  ContentRuntimeError,
  MEMBERS_ONLY_CONTENT_PREVIEW_TITLE,
  createContent,
  createRequestId,
  deleteContent,
  getContent,
  getOwnedPostContext,
  getPublishedOwnerPostContext,
  getPublishedContentSocialContext,
  getPublishedContentSocialContexts,
  resolvePublishedMediaReferenceAccess,
  listContents,
  searchPublishedContents,
  listFollowingOwnerContents,
  listPublishedContentsByIds,
  listCreatorContents,
  validateListFilters,
  toErrorResponse,
  transitionContentState,
  applyModerationContentTransition,
  listContentRevisions,
  getContentRevision,
  rollbackContentRevision,
  publishDueScheduledContent,
  updateContent,
  type ContentState,
  type ContentD1,
} from './content-runtime.js'
import { normalizePreflightInput, preflightContent } from './publish-preflight.js'
import {
  createContentRelationship,
  listContentRelationships,
  revokeContentRelationship,
  type ContentRelationshipDirection,
} from './content-relationships.js'
import {
  createSeries,
  deleteSeries,
  getSeries,
  listCreatorSeries,
  updateSeries,
} from './content-series.js'
import {
  createCollection,
  deleteCollection,
  getCollection,
  listCreatorCollections,
  updateCollection,
} from './content-collections.js'
import {
  attachSeriesMember,
  listSeriesMembers,
  removeSeriesMember,
  reorderSeriesMember,
} from './content-series-members.js'
import {
  attachCollectionMember,
  listCollectionMembers,
  removeCollectionMember,
  reorderCollectionMember,
} from './content-collection-members.js'

type RateLimitBinding = { limit(input: { key: string }): Promise<{ success: boolean }> }

interface Env {
  D1_02: D1Database
  W07_SUBSCRIPTION?: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> }
  CONTENT_PUBLIC_READ_LIMITER?: RateLimitBinding
  CONTENT_MUTATION_LIMITER?: RateLimitBinding
  CONTENT_ORIGIN_GLOBAL_LIMITER?: RateLimitBinding
}

const getRateKey = (request: Request): string => {
  const supplied = request.headers.get('X-LuckRead-Rate-Key')?.trim()
  if (supplied) return supplied
  const principal = request.headers.get('X-LuckRead-Principal-User-Id')?.trim()
  if (principal) return 'user:' + principal
  const clientIp = request.headers.get('X-LuckRead-Client-IP')?.trim()
  return clientIp ? 'ip:' + clientIp : 'transport:W01'
}

const enforceRateLimits = async (request: Request, env: Env, operation: string): Promise<void> => {
  const actorLimiter = operation === 'read' ? env.CONTENT_PUBLIC_READ_LIMITER : env.CONTENT_MUTATION_LIMITER
  const globalLimiter = env.CONTENT_ORIGIN_GLOBAL_LIMITER
  if (globalLimiter) {
    const globalResult = await globalLimiter.limit({ key: 'origin:' + operation })
    if (!globalResult.success) throw new ContentRuntimeError('RATE_LIMITED', 429)
  }
  if (actorLimiter) {
    const actorResult = await actorLimiter.limit({ key: operation + ':' + getRateKey(request) })
    if (!actorResult.success) throw new ContentRuntimeError('RATE_LIMITED', 429)
  }
}

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })

const requireTransport = (request: Request): void => {
  if (
    request.headers.get('X-LuckRead-Caller') !== 'W01' ||
    request.headers.get('X-LuckRead-Transport-Version') !== '1.0' ||
    !(request.headers.get('X-LuckRead-Correlation-Id')?.trim())
  ) {
    throw new ContentRuntimeError('PERMISSION_DENIED', 403)
  }
}

const requiredPrincipal = (request: Request): { userId: string; layer: string } => {
  const userId = request.headers.get('X-LuckRead-Principal-User-Id')?.trim() ?? ''
  const layer = request.headers.get('X-LuckRead-Principal-Layer')?.trim() ?? ''
  if (!userId || !layer) throw new ContentRuntimeError('UNAUTHENTICATED', 401)
  return { userId, layer }
}

export const hasCreatorContentPermission = (layer: string): boolean =>
  /^L[3-4]$/.test(layer)

export const hasSocialPostPermission = (layer: string): boolean =>
  /^L[2-8]$/.test(layer)

const requiredSocialPostPrincipal = (request: Request): { userId: string; layer: string } => {
  const principal = requiredPrincipal(request)
  if (!hasSocialPostPermission(principal.layer)) {
    throw new ContentRuntimeError('PERMISSION_DENIED', 403)
  }
  return principal
}

const requiredCreatorPrincipal = (request: Request): { userId: string; layer: string } => {
  const principal = requiredPrincipal(request)
  if (!hasCreatorContentPermission(principal.layer)) {
    throw new ContentRuntimeError('PERMISSION_DENIED', 403)
  }
  return principal
}

const requireVerifiedCreatorId = (request: Request): string => {
  const creatorId = request.headers.get('X-LuckRead-Verified-Creator-Id')?.trim() ?? ''
  if (!creatorId || creatorId.length > 256 || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/.test(creatorId)) {
    throw new ContentRuntimeError('PERMISSION_DENIED', 403)
  }
  return creatorId
}

const requireIfMatch = (request: Request): string => {
  const value = request.headers.get('If-Match')?.trim() ?? ''
  if (!value) throw new ContentRuntimeError('PRECONDITION_REQUIRED', 428)
  if (value.length > 256) throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  if (value === '*') throw new ContentRuntimeError('PRECONDITION_FAILED', 412)
  return value
}

const requireIdempotency = (request: Request): string => {
  const value = request.headers.get('Idempotency-Key')?.trim() ?? ''
  if (!value) throw new ContentRuntimeError('PRECONDITION_REQUIRED', 428)
  if (value.length > 256) throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  return value
}

export const parseListLimit = (value: string | null): number => {
  if (value === null || value.trim() === '') return 20
  if (!/^(?:[1-9]|[1-4][0-9]|50)$/.test(value.trim())) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
  return Number(value)
}

const parseRevisionListLimit = (value: string | null): number => {
  if (value === null || value.trim() === '') return 20
  if (!/^(?:[1-9]|[1-9][0-9]|100)$/.test(value.trim())) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
  return Number(value)
}

const parseBody = async (request: Request): Promise<Record<string, unknown>> => {
  try {
    const body = await request.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('INVALID')
    }
    return body as Record<string, unknown>
  } catch {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
}

const decodePathSegment = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
}

const resolveCreatorMembershipAccess = async (
  request: Request,
  env: Env,
  subscriberId: string,
  creatorId: string,
): Promise<boolean> => {
  const service = env.W07_SUBSCRIPTION
  if (!service) throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
  const correlationId = request.headers.get('X-LuckRead-Correlation-Id')?.trim() ?? ''
  const layer = request.headers.get('X-LuckRead-Principal-Layer')?.trim() ?? ''
  if (!correlationId || !layer) throw new ContentRuntimeError('UNAUTHENTICATED', 401)
  let response: Response
  try {
    response = await service.fetch(new Request('https://luckread-w07.internal/internal/entitlements/check-creator-membership', {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'X-LuckRead-Caller': 'W03',
        'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Correlation-Id': correlationId,
        'X-LuckRead-Principal-User-Id': subscriberId,
        'X-LuckRead-Principal-Layer': layer,
      },
      body: JSON.stringify({ creatorId }),
    }))
  } catch {
    throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  if (!response.ok) throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
  let payload: unknown
  try { payload = await response.json() } catch {
    throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  const data = (payload as { data?: unknown }).data
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      typeof (data as { allowed?: unknown }).allowed !== 'boolean' ||
      !['ACTIVE_CREATOR_MEMBERSHIP', 'MEMBERSHIP_REQUIRED'].includes(String((data as { reason?: unknown }).reason))) {
    throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  const decision = data as { allowed: boolean; reason: string }
  // Reject internally contradictory policy DTOs rather than accepting a boolean
  // that disagrees with W07's auditable reason code.
  if ((decision.allowed && decision.reason !== 'ACTIVE_CREATOR_MEMBERSHIP') ||
      (!decision.allowed && decision.reason !== 'MEMBERSHIP_REQUIRED')) {
    throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  return decision.allowed
}

const getPath = (pathname: string): {id?: string; state?: boolean; preflight?: boolean; revisions?: boolean; relationships?: boolean; relationshipId?: string; revisionId?: string; rollback?: boolean; series?: boolean; seriesMembers?: boolean; seriesMemberContentId?: string; collections?: boolean; collectionMembers?: boolean; collectionMemberContentId?: string} | null => {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length === 3 && parts[0] === 'internal' && parts[1] === 'content' && parts[2] === 'contents') {
    return {}
  }
  if (parts.length === 4 && parts[0] === 'internal' && parts[1] === 'content' && parts[2] === 'contents') {
    return { id: decodePathSegment(parts[3]) }
  }
  if (parts.length === 5 && parts[0] === 'internal' && parts[1] === 'content' && parts[2] === 'contents' && parts[4] === 'state') {
    return { id: decodePathSegment(parts[3]), state: true }
  }
  if (parts.length === 5 && parts[0] === 'internal' && parts[1] === 'content' && parts[2] === 'contents' && parts[4] === 'preflight') {
    return { id: decodePathSegment(parts[3]), preflight: true }
  }
  if (parts.length === 5 && parts[0] === 'internal' && parts[1] === 'content' && parts[2] === 'contents' && parts[4] === 'revisions') {
    return { id: decodePathSegment(parts[3]), revisions: true }
  }
  if (parts.length === 5 && parts[0] === 'internal' && parts[1] === 'content' && parts[2] === 'contents' && parts[4] === 'relationships') {
    return { id: decodePathSegment(parts[3]), relationships: true }
  }
  if (parts.length === 6 && parts[0] === 'internal' && parts[1] === 'content' && parts[2] === 'contents' && parts[4] === 'relationships') {
    return { id: decodePathSegment(parts[3]), relationships: true, relationshipId: decodePathSegment(parts[5]) }
  }
  if (parts.length === 4 && parts[0] === 'internal' && parts[1] === 'content' && parts[2] === 'series') {
    return { id: decodePathSegment(parts[3]), series: true }
  }
  if (parts.length === 3 && parts[0] === 'internal' && parts[1] === 'content' && parts[2] === 'series') {
    return { series: true }
  }
  if (parts.length === 4 && parts[0] === 'internal' && parts[1] === 'content' && parts[2] === 'collections') {
    return { id: decodePathSegment(parts[3]), collections: true }
  }
  if (parts.length === 3 && parts[0] === 'internal' && parts[1] === 'content' && parts[2] === 'collections') {
    return { collections: true }
  }
  if (parts.length === 5 && parts[0] === 'internal' && parts[1] === 'content' && parts[2] === 'collections' && parts[4] === 'members') {
    return { id: decodePathSegment(parts[3]), collectionMembers: true }
  }
  if (parts.length === 6 && parts[0] === 'internal' && parts[1] === 'content' && parts[2] === 'collections' && parts[4] === 'members') {
    return { id: decodePathSegment(parts[3]), collectionMembers: true, collectionMemberContentId: decodePathSegment(parts[5]) }
  }
  if (parts.length === 5 && parts[0] === 'internal' && parts[1] === 'content' && parts[2] === 'series' && parts[4] === 'members') {
    return { id: decodePathSegment(parts[3]), seriesMembers: true }
  }
  if (parts.length === 6 && parts[0] === 'internal' && parts[1] === 'content' && parts[2] === 'series' && parts[4] === 'members') {
    return { id: decodePathSegment(parts[3]), seriesMembers: true, seriesMemberContentId: decodePathSegment(parts[5]) }
  }
  if (parts.length === 6 && parts[0] === 'internal' && parts[1] === 'content' && parts[2] === 'contents' && parts[4] === 'revisions') {
    return { id: decodePathSegment(parts[3]), revisions: true, revisionId: decodePathSegment(parts[5]) }
  }
  if (parts.length === 7 && parts[0] === 'internal' && parts[1] === 'content' && parts[2] === 'contents' && parts[4] === 'revisions' && parts[6] === 'rollback') {
    return { id: decodePathSegment(parts[3]), revisions: true, revisionId: decodePathSegment(parts[5]), rollback: true }
  }
  return null
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url)
      const isRead = request.method === 'GET' || (request.method === 'POST' && ['/internal/content/following-feed', '/internal/content/search', '/internal/content/published-social-context-batch'].includes(url.pathname))
      await enforceRateLimits(request, env, isRead ? 'read' : 'write')

      if (url.pathname === '/internal/content/published-social-context-batch') {
        if (request.method !== 'POST') {
          return new Response(null, { status: 405, headers: { Allow: 'POST' } })
        }
        if (
          request.headers.get('X-LuckRead-Caller') !== 'W05' ||
          request.headers.get('X-LuckRead-Transport-Version') !== '1.0' ||
          !request.headers.get('X-LuckRead-Correlation-Id')?.trim() ||
          request.headers.has('Authorization') ||
          request.headers.has('Cookie')
        ) {
          throw new ContentRuntimeError('PERMISSION_DENIED', 403)
        }
        if (url.search !== '') throw new ContentRuntimeError('VALIDATION_FAILED', 400)
        let body: unknown
        try { body = await request.json() } catch { throw new ContentRuntimeError('VALIDATION_FAILED', 400) }
        if (
          !body || typeof body !== 'object' || Array.isArray(body) ||
          !Array.isArray((body as { contentIds?: unknown }).contentIds) ||
          ((body as { contentIds: unknown[] }).contentIds).length > 50 ||
          !((body as { contentIds: unknown[] }).contentIds).every(value => typeof value === 'string')
        ) {
          throw new ContentRuntimeError('VALIDATION_FAILED', 400)
        }
        const items = await getPublishedContentSocialContexts(
          env.D1_02,
          (body as { contentIds: string[] }).contentIds,
        )
        return json({ data: { items }, requestId: createRequestId() })
      }

      const publishedSocialContextMatch = /^\/internal\/content\/contents\/([^/]+)\/published-social-context$/.exec(url.pathname)
      if (publishedSocialContextMatch) {
        if (request.method !== 'GET') {
          return new Response(null, { status: 405, headers: { Allow: 'GET' } })
        }
        if (
          request.headers.get('X-LuckRead-Caller') !== 'W05' ||
          request.headers.get('X-LuckRead-Transport-Version') !== '1.0' ||
          !request.headers.get('X-LuckRead-Correlation-Id')?.trim() ||
          request.headers.has('Authorization') ||
          request.headers.has('Cookie')
        ) {
          throw new ContentRuntimeError('PERMISSION_DENIED', 403)
        }
        if (url.search !== '') throw new ContentRuntimeError('VALIDATION_FAILED', 400)
        const contentId = decodePathSegment(publishedSocialContextMatch[1] ?? '')
        const context = await getPublishedContentSocialContext(env.D1_02, contentId)
        return json({ data: context, requestId: createRequestId() })
      }

      const publicPostContextMatch = /^\/internal\/content\/contents\/([^/]+)\/public-post-context\/([^/]+)$/.exec(url.pathname)
      if (publicPostContextMatch) {
        if (request.method !== 'GET') {
          return new Response(null, { status: 405, headers: { Allow: 'GET' } })
        }
        if (
          request.headers.get('X-LuckRead-Caller') !== 'W05' ||
          request.headers.get('X-LuckRead-Transport-Version') !== '1.0' ||
          !request.headers.get('X-LuckRead-Correlation-Id')?.trim() ||
          request.headers.has('Authorization') ||
          request.headers.has('Cookie')
        ) {
          throw new ContentRuntimeError('PERMISSION_DENIED', 403)
        }
        if (url.search !== '') throw new ContentRuntimeError('VALIDATION_FAILED', 400)
        const contentId = decodePathSegment(publicPostContextMatch[1] ?? '')
        const ownerUserId = decodePathSegment(publicPostContextMatch[2] ?? '')
        const context = await getPublishedOwnerPostContext(env.D1_02, contentId, ownerUserId)
        return json({ data: context, requestId: createRequestId() })
      }

      const ownedPostContextMatch = /^\/internal\/content\/contents\/([^/]+)\/owned-post-context$/.exec(url.pathname)
      if (ownedPostContextMatch) {
        if (request.method !== 'GET') {
          return new Response(null, { status: 405, headers: { Allow: 'GET' } })
        }
        if (
          request.headers.get('X-LuckRead-Caller') !== 'W05' ||
          request.headers.get('X-LuckRead-Transport-Version') !== '1.0' ||
          !request.headers.get('X-LuckRead-Correlation-Id')?.trim() ||
          request.headers.has('Authorization') ||
          request.headers.has('Cookie')
        ) {
          throw new ContentRuntimeError('PERMISSION_DENIED', 403)
        }
        if (url.search !== '') throw new ContentRuntimeError('VALIDATION_FAILED', 400)
        const principal = requiredPrincipal(request)
        if (!hasSocialPostPermission(principal.layer)) {
          throw new ContentRuntimeError('PERMISSION_DENIED', 403)
        }
        const contentId = decodePathSegment(ownedPostContextMatch[1] ?? '')
        const context = await getOwnedPostContext(env.D1_02, contentId, principal.userId)
        return json({ data: context, requestId: createRequestId() })
      }

      if (request.method === 'POST' && url.pathname === '/internal/content/following-feed') {
        if (
          request.headers.get('X-LuckRead-Caller') !== 'W04' ||
          request.headers.get('X-LuckRead-Transport-Version') !== '1.0' ||
          !request.headers.get('X-LuckRead-Correlation-Id')?.trim() ||
          request.headers.has('Authorization') ||
          request.headers.has('Cookie')
        ) {
          throw new ContentRuntimeError('PERMISSION_DENIED', 403)
        }
        if (url.search !== '') {
          throw new ContentRuntimeError('VALIDATION_FAILED', 400)
        }
        const viewerUserId = request.headers.get('X-LuckRead-Principal-User-Id')?.trim() ?? ''
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(viewerUserId)) {
          throw new ContentRuntimeError('UNAUTHENTICATED', 401)
        }
        const rawBody = await request.text()
        if (rawBody.length > 70000) throw new ContentRuntimeError('VALIDATION_FAILED', 400)
        let parsedBody: unknown
        try { parsedBody = JSON.parse(rawBody) } catch {
          throw new ContentRuntimeError('VALIDATION_FAILED', 400)
        }
        if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
          throw new ContentRuntimeError('VALIDATION_FAILED', 400)
        }
        const body = parsedBody as Record<string, unknown>
        if (Object.keys(body).some((key) => !['ownerUserIds', 'cursor', 'limit'].includes(key))) {
          throw new ContentRuntimeError('VALIDATION_FAILED', 400)
        }
        const ownerUserIds = body.ownerUserIds
        if (
          !Array.isArray(ownerUserIds) ||
          ownerUserIds.length < 1 ||
          ownerUserIds.length > 500 ||
          ownerUserIds.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id))
        ) {
          throw new ContentRuntimeError('VALIDATION_FAILED', 400)
        }
        const cursor = body.cursor === null || body.cursor === undefined
          ? null
          : typeof body.cursor === 'string'
            ? body.cursor.trim() || null
            : (() => { throw new ContentRuntimeError('VALIDATION_FAILED', 400) })()
        if (cursor && cursor.length > 2048) throw new ContentRuntimeError('INVALID_CURSOR', 400)
        if (body.limit !== undefined && typeof body.limit !== 'number' && typeof body.limit !== 'string') {
          throw new ContentRuntimeError('VALIDATION_FAILED', 400)
        }
        const page = await listFollowingOwnerContents(
          env.D1_02,
          viewerUserId,
          ownerUserIds as string[],
          cursor,
          parseListLimit(body.limit === undefined ? null : String(body.limit)),
        )
        return json({
          data: {
            items: page.items.map((item) => ({
              id: item.id,
              slug: item.slug,
              ownerUserId: item.ownerUserId,
              creatorId: item.creatorId ?? item.ownerUserId,
              createdAt: item.createdAt,
              contentType: item.contentType,
              title: item.accessMode === 'MEMBERS_ONLY' ? MEMBERS_ONLY_CONTENT_PREVIEW_TITLE : item.title,
              accessMode: item.accessMode ?? 'PUBLIC',
              // Feed remains metadata-only: a member must open the canonical
              // detail route for the W07 entitlement check before refs are returned.
              updatedAt: item.updatedAt,
            })),
            nextCursor: page.nextCursor,
            hasMore: page.hasMore,
          },
          requestId: createRequestId(),
        })
      }


      if (request.method === 'POST' && url.pathname === '/internal/content/search') {
        if (
          request.headers.get('X-LuckRead-Caller') !== 'W04' ||
          request.headers.get('X-LuckRead-Transport-Version') !== '1.0' ||
          !request.headers.get('X-LuckRead-Correlation-Id')?.trim() ||
          request.headers.has('Authorization') ||
          request.headers.has('Cookie')
        ) {
          throw new ContentRuntimeError('PERMISSION_DENIED', 403)
        }
        if (url.search !== '') throw new ContentRuntimeError('VALIDATION_FAILED', 400)

        const rawBody = await request.text()
        if (rawBody.length > 10000) throw new ContentRuntimeError('VALIDATION_FAILED', 400)
        let parsedBody: unknown
        try { parsedBody = JSON.parse(rawBody) } catch {
          throw new ContentRuntimeError('VALIDATION_FAILED', 400)
        }
        if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
          throw new ContentRuntimeError('VALIDATION_FAILED', 400)
        }
        const body = parsedBody as Record<string, unknown>
        if (Object.keys(body).some((key) => !['q', 'cursor', 'limit'].includes(key))) {
          throw new ContentRuntimeError('VALIDATION_FAILED', 400)
        }
        if (typeof body.q !== 'string') throw new ContentRuntimeError('VALIDATION_FAILED', 400)
        const query = body.q.normalize('NFKC').trim()
        if (!query || query.length > 256) throw new ContentRuntimeError('VALIDATION_FAILED', 400)
        const cursor = body.cursor === null || body.cursor === undefined
          ? null
          : typeof body.cursor === 'string'
            ? body.cursor.trim() || null
            : (() => { throw new ContentRuntimeError('VALIDATION_FAILED', 400) })()
        if (cursor && cursor.length > 2048) throw new ContentRuntimeError('INVALID_CURSOR', 400)
        if (body.limit !== undefined && typeof body.limit !== 'number' && typeof body.limit !== 'string') {
          throw new ContentRuntimeError('VALIDATION_FAILED', 400)
        }

        const page = await searchPublishedContents(
          env.D1_02,
          query,
          cursor,
          parseListLimit(body.limit === undefined ? null : String(body.limit)),
        )
        return json({
          data: {
            items: page.items.map((item) => ({
              id: item.id,
              slug: item.slug,
              ownerUserId: item.ownerUserId,
              creatorId: item.creatorId ?? item.ownerUserId,
              createdAt: item.createdAt,
              contentType: item.contentType,
              title: item.accessMode === 'MEMBERS_ONLY' ? MEMBERS_ONLY_CONTENT_PREVIEW_TITLE : item.title,
              accessMode: item.accessMode ?? 'PUBLIC',
              // Search is metadata-only: a member must open the canonical
              // detail route for the W07 entitlement check before refs are returned.
              updatedAt: item.updatedAt,
            })),
            nextCursor: page.nextCursor,
            hasMore: page.hasMore,
          },
          requestId: createRequestId(),
        })
      }

      const isModerationTransition =
        request.method === 'POST' &&
        /^\/internal\/content\/contents\/[^/]+\/state$/.test(url.pathname) &&
        request.headers.get('X-LuckRead-Caller') === 'W06'

      if (isModerationTransition) {
        if (
          request.headers.get('X-LuckRead-Transport-Version') !== '1.0' ||
          !request.headers.get('X-LuckRead-Correlation-Id')?.trim() ||
          request.headers.has('Authorization')
        ) {
          throw new ContentRuntimeError('PERMISSION_DENIED', 403)
        }
        const principal = requiredPrincipal(request)
        if (!/^L[0-8]$/.test(principal.layer) || Number(principal.layer.slice(1)) < 6) {
          throw new ContentRuntimeError('PERMISSION_DENIED', 403)
        }
        const decisionId = request.headers.get('X-LuckRead-Moderation-Decision-Id')?.trim() ?? ''
        const policyVersion = request.headers.get('X-LuckRead-Moderation-Policy-Version')?.trim() ?? ''
        const outcome = request.headers.get('X-LuckRead-Moderation-Outcome')?.trim() ?? ''
        if (!decisionId || !policyVersion || !['APPROVED', 'REJECTED'].includes(outcome)) {
          throw new ContentRuntimeError('PERMISSION_DENIED', 403)
        }
        const ifMatch = requireIfMatch(request)
        const idempotencyKey = requireIdempotency(request)
        const body = await parseBody(request)
        if (
          body.decisionId !== decisionId ||
          body.policyVersion !== policyVersion ||
          body.to !== outcome ||
          body.targetContentState !== 'PENDING_REVIEW'
        ) {
          throw new ContentRuntimeError('VALIDATION_FAILED', 400)
        }
        const parts = url.pathname.split('/').filter(Boolean)
        return json({
          ...await applyModerationContentTransition(env.D1_02, {
            contentId: decodeURIComponent(parts[3]),
            decisionId,
            policyVersion,
            outcome: outcome as 'APPROVED' | 'REJECTED',
            ifMatch,
            idempotencyKey,
          }),
          requestId: createRequestId(),
        })
      }


      requireTransport(request)
      if (url.pathname === '/internal/content/public-media-reference') {
        if (request.method !== 'GET') {
          return new Response(null, { status: 405, headers: { Allow: 'GET' } })
        }
        if (
          request.headers.has('Authorization') ||
          request.headers.has('Cookie') ||
          url.search.slice(1).split('&').length !== 1 ||
          !url.search.slice(1).startsWith('url=') ||
          !url.searchParams.has('url')
        ) {
          throw new ContentRuntimeError('PERMISSION_DENIED', 403)
        }
        const mediaUrl = url.searchParams.get('url') ?? ''
        if (!mediaUrl || mediaUrl.length > 2048) {
          throw new ContentRuntimeError('VALIDATION_FAILED', 400)
        }
        const viewerUserId = request.headers.get('X-LuckRead-Principal-User-Id')?.trim() || null
        const access = await resolvePublishedMediaReferenceAccess(
          env.D1_02,
          mediaUrl,
          viewerUserId,
          viewerUserId
            ? (creatorId) => resolveCreatorMembershipAccess(request, env, viewerUserId, creatorId)
            : undefined,
        )
        return json({ data: access, requestId: createRequestId() })
      }

      if (url.pathname === '/internal/content/bookmarked-items') {
        if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } })
        requiredPrincipal(request)
        const body = await parseBody(request)
        const ids = body.ids
        if (
          !Array.isArray(ids) ||
          ids.length > 50 ||
          ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id))
        ) {
          throw new ContentRuntimeError('VALIDATION_FAILED', 400)
        }
        const items = await listPublishedContentsByIds(env.D1_02, ids)
        return json({
          data: {
            items: items.map(item => {
              const membersOnly = item.accessMode === 'MEMBERS_ONLY'
              return {
                id: item.id,
                slug: item.slug,
                ownerUserId: item.ownerUserId,
                creatorId: item.creatorId,
                contentType: item.contentType,
                title: item.accessMode === 'MEMBERS_ONLY' ? MEMBERS_ONLY_CONTENT_PREVIEW_TITLE : item.title,
                accessMode: item.accessMode ?? 'PUBLIC',
                // Bookmark projections are not an authorization boundary.
                // Always omit protected references here; detail checks W07.
                bodyRef: membersOnly ? '' : item.bodyRef,
                mediaRefs: membersOnly ? [] : item.mediaRefs,
                coverRef: membersOnly ? null : item.coverRef,
                createdAt: item.createdAt,
                updatedAt: item.updatedAt,
              }
            }),
          },
          requestId: createRequestId(),
        })
      }
      const path = getPath(url.pathname)

      if (path && path.collectionMembers && path.id && request.method === 'GET') {
        const principal = requiredCreatorPrincipal(request)
        const cursor = url.searchParams.get('cursor')
        if (cursor && cursor.length > 2048) throw new ContentRuntimeError('INVALID_CURSOR', 400)
        const page = await listCollectionMembers(
          env.D1_02,
          principal.userId,
          path.id,
          cursor,
          parseListLimit(url.searchParams.get('limit')),
        )
        return json({ data: page, schemaVersion: '1.0', requestId: createRequestId() })
      }

      if (path && path.collectionMembers && path.id && request.method === 'POST' && !path.collectionMemberContentId) {
        const principal = requiredCreatorPrincipal(request)
        return json({
          data: await attachCollectionMember(
            env.D1_02,
            principal.userId,
            path.id,
            await parseBody(request),
            requireIfMatch(request),
            requireIdempotency(request),
          ),
          schemaVersion: '1.0',
          requestId: createRequestId(),
        }, 201)
      }

      if (path && path.collectionMembers && path.id && path.collectionMemberContentId && request.method === 'DELETE') {
        const principal = requiredCreatorPrincipal(request)
        return json({
          data: await removeCollectionMember(
            env.D1_02,
            principal.userId,
            path.id,
            path.collectionMemberContentId,
            requireIfMatch(request),
            requireIdempotency(request),
          ),
          schemaVersion: '1.0',
          requestId: createRequestId(),
        })
      }

      if (path && path.collectionMembers && path.id && path.collectionMemberContentId && request.method === 'PATCH') {
        const principal = requiredCreatorPrincipal(request)
        const body = await parseBody(request)
        if (!Number.isSafeInteger(body.position)) throw new ContentRuntimeError('VALIDATION_FAILED', 400)
        return json({
          data: await reorderCollectionMember(
            env.D1_02,
            principal.userId,
            path.id,
            path.collectionMemberContentId,
            Number(body.position),
            requireIfMatch(request),
            requireIdempotency(request),
          ),
          schemaVersion: '1.0',
          requestId: createRequestId(),
        })
      }

      if (path && path.collections && request.method === 'POST' && path.id === undefined) {
        const principal = requiredCreatorPrincipal(request)
        const collection = await createCollection(
          env.D1_02,
          principal.userId,
          await parseBody(request),
          requireIdempotency(request),
        )
        return json({ data: collection, schemaVersion: '1.0', requestId: createRequestId() }, 201)
      }

      if (path && path.collections && request.method === 'GET' && path.id === undefined) {
        const principal = requiredCreatorPrincipal(request)
        const cursor = url.searchParams.get('cursor')
        if (cursor && cursor.length > 2048) throw new ContentRuntimeError('INVALID_CURSOR', 400)
        const page = await listCreatorCollections(
          env.D1_02,
          principal.userId,
          cursor,
          parseListLimit(url.searchParams.get('limit')),
        )
        return json({ data: page, schemaVersion: '1.0', requestId: createRequestId() })
      }

      if (path && path.collections && path.id && request.method === 'GET') {
        const principal = requiredCreatorPrincipal(request)
        return json({ data: await getCollection(env.D1_02, principal.userId, path.id), schemaVersion: '1.0', requestId: createRequestId() })
      }

      if (path && path.collections && path.id && request.method === 'PATCH') {
        const principal = requiredCreatorPrincipal(request)
        return json({
          data: await updateCollection(
            env.D1_02,
            principal.userId,
            path.id,
            await parseBody(request),
            requireIfMatch(request),
            requireIdempotency(request),
          ),
          schemaVersion: '1.0',
          requestId: createRequestId(),
        })
      }

      if (path && path.collections && path.id && request.method === 'DELETE') {
        const principal = requiredCreatorPrincipal(request)
        await deleteCollection(
          env.D1_02,
          principal.userId,
          path.id,
          requireIfMatch(request),
          requireIdempotency(request),
        )
        return new Response(null, { status: 204 })
      }

      if (path && path.series && request.method === 'POST' && path.id === undefined) {
        const principal = requiredCreatorPrincipal(request)
        const series = await createSeries(
          env.D1_02,
          principal.userId,
          await parseBody(request),
          requireIdempotency(request),
        )
        return json({ data: series, schemaVersion: '1.0', requestId: createRequestId() }, 201)
      }

      if (path && path.seriesMembers && path.id && request.method === 'GET') {
        const principal = requiredCreatorPrincipal(request)
        const cursor = url.searchParams.get('cursor')
        if (cursor && cursor.length > 2048) throw new ContentRuntimeError('INVALID_CURSOR', 400)
        const page = await listSeriesMembers(
          env.D1_02,
          principal.userId,
          path.id,
          cursor,
          parseListLimit(url.searchParams.get('limit')),
        )
        return json({ data: page, schemaVersion: '1.0', requestId: createRequestId() })
      }

      if (path && path.seriesMembers && path.id && request.method === 'POST' && !path.seriesMemberContentId) {
        const principal = requiredCreatorPrincipal(request)
        return json({
          data: await attachSeriesMember(
            env.D1_02,
            principal.userId,
            path.id,
            await parseBody(request),
            requireIfMatch(request),
            requireIdempotency(request),
          ),
          schemaVersion: '1.0',
          requestId: createRequestId(),
        }, 201)
      }

      if (path && path.seriesMembers && path.id && path.seriesMemberContentId && request.method === 'DELETE') {
        const principal = requiredCreatorPrincipal(request)
        return json({
          data: await removeSeriesMember(
            env.D1_02,
            principal.userId,
            path.id,
            path.seriesMemberContentId,
            requireIfMatch(request),
            requireIdempotency(request),
          ),
          schemaVersion: '1.0',
          requestId: createRequestId(),
        })
      }

      if (path && path.seriesMembers && path.id && path.seriesMemberContentId && request.method === 'PATCH') {
        const principal = requiredCreatorPrincipal(request)
        const body = await parseBody(request)
        if (!Number.isSafeInteger(body.position)) {
          throw new ContentRuntimeError('VALIDATION_FAILED', 400)
        }
        return json({
          data: await reorderSeriesMember(
            env.D1_02,
            principal.userId,
            path.id,
            path.seriesMemberContentId,
            Number(body.position),
            requireIfMatch(request),
            requireIdempotency(request),
          ),
          schemaVersion: '1.0',
          requestId: createRequestId(),
        })
      }

      if (path && path.series && request.method === 'GET' && path.id === undefined) {
        const principal = requiredCreatorPrincipal(request)
        const cursor = url.searchParams.get('cursor')
        if (cursor && cursor.length > 2048) throw new ContentRuntimeError('INVALID_CURSOR', 400)
        const page = await listCreatorSeries(
          env.D1_02,
          principal.userId,
          cursor,
          parseListLimit(url.searchParams.get('limit')),
        )
        return json({ data: page, schemaVersion: '1.0', requestId: createRequestId() })
      }

      if (path && path.series && path.id && request.method === 'GET') {
        const principal = requiredCreatorPrincipal(request)
        return json({ data: await getSeries(env.D1_02, principal.userId, path.id), schemaVersion: '1.0', requestId: createRequestId() })
      }

      if (path && path.series && path.id && request.method === 'PATCH') {
        const principal = requiredCreatorPrincipal(request)
        return json({
          data: await updateSeries(
            env.D1_02,
            principal.userId,
            path.id,
            await parseBody(request),
            requireIfMatch(request),
            requireIdempotency(request),
          ),
          schemaVersion: '1.0',
          requestId: createRequestId(),
        })
      }

      if (path && path.series && path.id && request.method === 'DELETE') {
        const principal = requiredCreatorPrincipal(request)
        await deleteSeries(
          env.D1_02,
          principal.userId,
          path.id,
          requireIfMatch(request),
          requireIdempotency(request),
        )
        return new Response(null, { status: 204 })
      }

      if (path && path.relationships && path.id && request.method === 'GET' && !path.relationshipId) {
        const directionParam = url.searchParams.get('direction')?.trim() || 'out'
        if (!['out', 'in', 'both'].includes(directionParam)) {
          throw new ContentRuntimeError('VALIDATION_FAILED', 400)
        }
        const cursor = url.searchParams.get('cursor')
        if (cursor && cursor.length > 2048) throw new ContentRuntimeError('INVALID_CURSOR', 400)
        const page = await listContentRelationships(
          env.D1_02,
          path.id,
          directionParam as ContentRelationshipDirection,
          cursor,
          parseListLimit(url.searchParams.get('limit')),
        )
        return json({
          data: {
            items: page.items,
            nextCursor: page.nextCursor,
            hasMore: page.hasMore,
          },
          requestId: createRequestId(),
        })
      }

      if (path && path.relationships && path.id && request.method === 'POST' && !path.relationshipId) {
        const principal = requiredCreatorPrincipal(request)
        const body = await parseBody(request)
        const relationship = await createContentRelationship(
          env.D1_02,
          principal.userId,
          path.id,
          body,
          requireIdempotency(request),
        )
        return json({ data: relationship, requestId: createRequestId() }, 201)
      }

      if (path && path.relationships && path.id && path.relationshipId && request.method === 'DELETE') {
        const principal = requiredCreatorPrincipal(request)
        const relationshipId = path.relationshipId
        const relationship = await revokeContentRelationship(
          env.D1_02,
          principal.userId,
          path.id,
          relationshipId,
          requireIdempotency(request),
        )
        return json({ data: relationship, requestId: createRequestId() })
      }

      if (path && path.revisions && path.id && request.method === 'GET' && !path.revisionId) {
        const principal = requiredCreatorPrincipal(request)
        const cursor = url.searchParams.get('cursor')
        const limit = parseRevisionListLimit(url.searchParams.get('limit'))
        if (cursor && cursor.length > 2048) throw new ContentRuntimeError('INVALID_CURSOR', 400)
        const page = await listContentRevisions(env.D1_02, principal.userId, path.id, cursor, limit)
        return json({
          data: {
            items: page.items,
            nextCursor: page.nextCursor,
            hasMore: page.hasMore,
          },
          requestId: createRequestId(),
        })
      }

      if (path && path.revisions && path.id && path.revisionId && request.method === 'GET' && !path.rollback) {
        const principal = requiredCreatorPrincipal(request)
        return json({
          data: await getContentRevision(env.D1_02, principal.userId, path.id, path.revisionId),
          requestId: createRequestId(),
        })
      }

      if (path && path.revisions && path.id && path.revisionId && path.rollback && request.method === 'POST') {
        const principal = requiredCreatorPrincipal(request)
        const body = await parseBody(request)
        const result = await rollbackContentRevision(
          env.D1_02,
          principal.userId,
          path.id,
          path.revisionId,
          requireIfMatch(request),
          requireIdempotency(request),
          typeof body.reason === 'string' ? body.reason : undefined,
          request.headers.get('X-LuckRead-Correlation-Id')?.trim() || 'runtime',
          new Date(),
          request.headers.get('X-LuckRead-Verified-Creator-Id')?.trim() || undefined,
        )
        return json({
          ...result,
          requestId: createRequestId(),
        })
      }

      if (request.method === 'GET' && url.pathname === '/internal/content/creator-contents') {
        const principal = requiredCreatorPrincipal(request)
        const cursor = url.searchParams.get('cursor')
        const limitParam = url.searchParams.get('limit')
        const limit = parseListLimit(limitParam)
        if (cursor && cursor.length > 2048) throw new ContentRuntimeError('INVALID_CURSOR', 400)
        const filters = validateListFilters(url.searchParams.get('status'), url.searchParams.get('type'))
        const page = await listCreatorContents(env.D1_02, principal.userId, cursor, limit, filters)
        return json({
          data: {
            items: page.items.map(item => ({
              id: item.id,
              slug: item.slug,
              contentType: item.contentType,
              state: item.state,
              version: item.version,
              revision: item.revision,
              etag: item.etag,
              title: item.title,
              accessMode: item.accessMode ?? 'PUBLIC',
              // Creator-owned views are owner-scoped; keep the current body/media.
              bodyRef: item.bodyRef,
              mediaRefs: item.mediaRefs,
              coverRef: item.coverRef,
              scheduledAt: item.scheduledAt,
              updatedAt: item.updatedAt,
            })),
            nextCursor: page.nextCursor,
            hasMore: page.hasMore,
          },
          requestId: createRequestId(),
        })
      }

      if (request.method === 'GET' && url.pathname === '/internal/content/contents') {
        const cursor = url.searchParams.get('cursor')
        const limitParam = url.searchParams.get('limit')
        const creatorId = url.searchParams.get('creatorId')?.trim() || null
        const contentType = url.searchParams.get('type')?.trim() || null
        const limit = parseListLimit(limitParam)
        if (cursor && cursor.length > 2048) throw new ContentRuntimeError('INVALID_CURSOR', 400)
        if (creatorId && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(creatorId)) {
          throw new ContentRuntimeError('VALIDATION_FAILED', 400)
        }
        if (contentType && !['article', 'post', 'video'].includes(contentType)) {
          throw new ContentRuntimeError('VALIDATION_FAILED', 400)
        }
        const page = await listContents(
          env.D1_02,
          cursor,
          limit,
          creatorId,
          contentType as 'article' | 'post' | 'video' | null,
        )
        return json({
          data: {
            items: page.items.map(item => {
              const membersOnly = item.accessMode === 'MEMBERS_ONLY'
              return {
                id: item.id,
                slug: item.slug,
                ownerUserId: item.ownerUserId,
                creatorId: item.creatorId ?? item.ownerUserId,
                contentType: item.contentType,
                state: item.state,
                version: item.version,
                etag: item.etag,
                title: item.accessMode === 'MEMBERS_ONLY' ? MEMBERS_ONLY_CONTENT_PREVIEW_TITLE : item.title,
                accessMode: item.accessMode ?? 'PUBLIC',
                // General list responses deliberately omit protected references.
                // The detail endpoint is the single request-time entitlement gate.
                bodyRef: membersOnly ? '' : item.bodyRef,
                mediaRefs: membersOnly ? [] : item.mediaRefs,
                coverRef: membersOnly ? null : item.coverRef,
                scheduledAt: item.scheduledAt,
              }
            }),
            nextCursor: page.nextCursor,
            hasMore: page.hasMore,
          },
          requestId: createRequestId(),
        })
      }

      if (!path) throw new ContentRuntimeError('NOT_FOUND', 404)

      if (request.method === 'POST' && path.id && path.preflight) {
        const body = await parseBody(request)
        if (body.contentType === 'post') requiredSocialPostPrincipal(request)
        else requiredCreatorPrincipal(request)
        try {
          return json({ ...preflightContent(normalizePreflightInput(body)), requestId: createRequestId() })
        } catch {
          throw new ContentRuntimeError('VALIDATION_FAILED', 400)
        }
      }

      if (request.method === 'POST' && path.id && path.state) {
        const principal = requiredPrincipal(request)
        const body = await parseBody(request)
        const to = body.to
        if (typeof to !== 'string') throw new ContentRuntimeError('VALIDATION_FAILED', 400)
        if (to === 'PENDING_REVIEW') {
          if (!body.preflight || typeof body.preflight !== 'object' || Array.isArray(body.preflight)) {
            throw new ContentRuntimeError('VALIDATION_FAILED', 400)
          }
          let report
          try {
            report = preflightContent(body.preflight)
          } catch {
            throw new ContentRuntimeError('VALIDATION_FAILED', 400)
          }
          if (report.verdict === 'RED') throw new ContentRuntimeError('VALIDATION_FAILED', 422)
        }
        const reason = typeof body.reason === 'string' ? body.reason : undefined
        const requestedScheduledAt =
          body.scheduledAt === undefined
            ? undefined
            : body.scheduledAt === null
              ? null
              : typeof body.scheduledAt === 'string'
                ? body.scheduledAt
                : (() => { throw new ContentRuntimeError('VALIDATION_FAILED', 400) })()
        const result = await transitionContentState(
          env.D1_02,
          principal.userId,
          principal.layer,
          path.id,
          to as ContentState,
          reason,
          requireIfMatch(request),
          requireIdempotency(request),
          new Date(),
          { scheduledAt: requestedScheduledAt, preflight: body.preflight },
        )
        return json({ ...result, requestId: createRequestId() })
      }

      if (request.method === 'POST' && path.id === undefined) {
        const body = await parseBody(request)
        const membersOnly = body.accessMode === 'MEMBERS_ONLY'
        const principal = membersOnly
          ? requiredCreatorPrincipal(request)
          : body.contentType === 'post'
            ? requiredSocialPostPrincipal(request)
            : requiredCreatorPrincipal(request)
        const verifiedCreatorId = membersOnly ? requireVerifiedCreatorId(request) : undefined
        const content = await createContent(
          env.D1_02,
          principal.userId,
          body,
          requireIdempotency(request),
          new Date(),
          request.headers.get('X-LuckRead-Correlation-Id')?.trim() || 'runtime',
          verifiedCreatorId,
        )
        return json({
          id: content.id,
          slug: content.slug,
          ownerUserId: content.ownerUserId,
          creatorId: content.creatorId,
          contentType: content.contentType,
          state: content.state,
          accessMode: content.accessMode ?? 'PUBLIC',
          accessGranted: true,
          version: content.version,
          etag: content.etag,
          title: content.title,
          bodyRef: content.bodyRef,
          mediaRefs: content.mediaRefs,
          coverRef: content.coverRef,
          requestId: createRequestId(),
        }, 201)
      }

      if (request.method === 'GET' && path.id) {
        // Published content is publicly readable; unpublished content remains owner-scoped in getContent().
        const principalUserId = request.headers.get('X-LuckRead-Principal-User-Id')?.trim() || null
        const membershipCheckCache = new Map<string, Promise<boolean>>()
        const resolveMembership = principalUserId
          ? (creatorId: string): Promise<boolean> => {
            let pending = membershipCheckCache.get(creatorId)
            if (!pending) {
              pending = resolveCreatorMembershipAccess(request, env, principalUserId, creatorId)
              membershipCheckCache.set(creatorId, pending)
            }
            return pending
          }
          : undefined
        const content = await getContent(
          env.D1_02,
          path.id,
          principalUserId,
          resolveMembership,
        )
        if (url.searchParams.get('bodyContext') === '1') {
          // A body object can be referenced by more than one content record.
          // Apply the strictest current membership policy across every record
          // that references these bytes, rather than letting a second PUBLIC
          // record become a side door around a MEMBERS_ONLY article.
          let bodyReferenceAllowed = true
          if (content.bodyRef) {
            const protectedReferences = await env.D1_02.prepare(
              "SELECT owner_user_id, creator_id FROM contents WHERE body_ref = ? AND state = 'PUBLISHED' AND access_mode = 'MEMBERS_ONLY' LIMIT 51",
            ).bind(content.bodyRef).all<{ owner_user_id: string; creator_id: string | null }>()
            const rows = protectedReferences.results ?? []
            if (rows.length > 50) throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
            for (const row of rows) {
              if (principalUserId && principalUserId === row.owner_user_id) continue
              if (!principalUserId || !row.creator_id || !resolveMembership ||
                  !(await resolveMembership(row.creator_id))) {
                bodyReferenceAllowed = false
                break
              }
            }
          }
          const accessGranted = (content.accessGranted ?? (content.accessMode !== 'MEMBERS_ONLY')) &&
            bodyReferenceAllowed
          return json({
            contentId: content.id,
            ownerUserId: content.ownerUserId,
            accessMode: content.accessMode ?? 'PUBLIC',
            accessGranted,
            bodyRef: accessGranted ? content.bodyRef : '',
          })
        }
        return json({
          id: content.id,
          slug: content.slug,
          creatorId: content.creatorId,
          contentType: content.contentType,
          state: content.state,
          accessMode: content.accessMode ?? 'PUBLIC',
          accessGranted: content.accessGranted ?? (content.accessMode !== 'MEMBERS_ONLY'),
          version: content.version,
          revision: content.revision,
          etag: content.etag,
          title: content.title,
          bodyRef: content.bodyRef,
          mediaRefs: content.mediaRefs,
          coverRef: content.coverRef,
          scheduledAt: content.scheduledAt,
          updatedAt: content.updatedAt,
          requestId: createRequestId(),
        })
      }

      if (request.method === 'PATCH' && path.id) {
        const body = await parseBody(request)
        const explicitlyChangesAccessMode = Object.hasOwn(body, 'accessMode')
        const principal = explicitlyChangesAccessMode
          ? requiredCreatorPrincipal(request)
          : body.contentType === 'post'
            ? requiredSocialPostPrincipal(request)
            : requiredCreatorPrincipal(request)
        const verifiedCreatorId = explicitlyChangesAccessMode ? requireVerifiedCreatorId(request) : undefined
        const content = await updateContent(
          env.D1_02,
          principal.userId,
          path.id,
          body,
          requireIfMatch(request),
          requireIdempotency(request),
          new Date(),
          request.headers.get('X-LuckRead-Correlation-Id')?.trim() || 'runtime',
          principal.layer,
          verifiedCreatorId,
        )
        return json({
          id: content.id,
          slug: content.slug,
          ownerUserId: content.ownerUserId,
          creatorId: content.creatorId,
          state: content.state,
          accessMode: content.accessMode ?? 'PUBLIC',
          accessGranted: true,
          version: content.version,
          etag: content.etag,
          title: content.title,
          bodyRef: content.bodyRef,
          scheduledAt: content.scheduledAt,
          requestId: createRequestId(),
        })
      }

      if (request.method === 'DELETE' && path.id) {
        const principal = requiredSocialPostPrincipal(request)
        await deleteContent(
          env.D1_02,
          principal.userId,
          path.id,
          requireIfMatch(request),
          requireIdempotency(request),
          new Date(),
          principal.layer,
        )
        return new Response(null, { status: 204 })
      }

      throw new ContentRuntimeError('NOT_FOUND', 404)
    } catch (error) {
      return toErrorResponse(error)
    }
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    if (controller.cron !== '* * * * *') return
    const result = await publishDueScheduledContent(env.D1_02, new Date(controller.scheduledTime), 50)
    console.log(JSON.stringify({
      event: 'content.scheduled-publish',
      cron: controller.cron,
      scheduledTime: new Date(controller.scheduledTime).toISOString(),
      ...result,
    }))
  },
}
export default worker
