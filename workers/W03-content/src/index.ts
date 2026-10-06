/// <reference types="@cloudflare/workers-types" />

import {
  ContentRuntimeError,
  createContent,
  deleteContent,
  getContent,
  listContents,
  listCreatorContents,
  validateListFilters,
  toErrorResponse,
  transitionContentState,
  applyModerationContentTransition,
  updateContent,
  type ContentState,
  type ContentD1,
} from './content-runtime.js'
import { normalizePreflightInput, preflightContent } from './publish-preflight.js'

type RateLimitBinding = { limit(input: { key: string }): Promise<{ success: boolean }> }

interface Env {
  D1_02: D1Database
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

const parsePrincipalRoles = (request: Request): string[] =>
  [...new Set(
    (request.headers.get('X-LuckRead-Principal-Roles') ?? '')
      .split(',')
      .map((role) => role.trim())
      .filter(Boolean),
  )]

const requiredPrincipal = (request: Request): { userId: string; layer: string; roles: string[] } => {
  const userId = request.headers.get('X-LuckRead-Principal-User-Id')?.trim() ?? ''
  const layer = request.headers.get('X-LuckRead-Principal-Layer')?.trim() ?? ''
  const roles = parsePrincipalRoles(request)
  if (!userId || !layer) throw new ContentRuntimeError('UNAUTHENTICATED', 401)
  return { userId, layer, roles }
}

export const hasCreatorContentPermission = (layer: string, roles: readonly string[] = []): boolean => {
  if (!/^L[0-8]$/.test(layer)) return false
  return Number(layer.slice(1)) >= 3 && roles.includes('creator')
}

const requiredCreatorPrincipal = (request: Request): { userId: string; layer: string; roles: string[] } => {
  const principal = requiredPrincipal(request)
  if (!hasCreatorContentPermission(principal.layer, principal.roles)) {
    throw new ContentRuntimeError('PERMISSION_DENIED', 403)
  }
  return principal
}

const requireIfMatch = (request: Request): string => {
  const value = request.headers.get('If-Match')?.trim() ?? ''
  if (!value) throw new ContentRuntimeError('PRECONDITION_REQUIRED', 428)
  return value
}

const requireIdempotency = (request: Request): string => {
  const value = request.headers.get('Idempotency-Key')?.trim() ?? ''
  if (!value || value.length > 256) throw new ContentRuntimeError('PRECONDITION_REQUIRED', 428)
  return value
}

export const parseListLimit = (value: string | null): number => {
  if (value === null || value.trim() === '') return 20
  if (!/^(?:[1-9]|[1-4][0-9]|50)$/.test(value.trim())) {
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

const getPath = (pathname: string): {id?: string; state?: boolean; preflight?: boolean} | null => {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length === 3 && parts[0] === 'internal' && parts[1] === 'content' && parts[2] === 'contents') {
    return {}
  }
  if (parts.length === 4 && parts[0] === 'internal' && parts[1] === 'content' && parts[2] === 'contents') {
    return { id: parts[3] }
  }
  if (parts.length === 5 && parts[0] === 'internal' && parts[1] === 'content' && parts[2] === 'contents' && parts[4] === 'state') {
    return { id: parts[3], state: true }
  }
  if (parts.length === 5 && parts[0] === 'internal' && parts[1] === 'content' && parts[2] === 'contents' && parts[4] === 'preflight') {
    return { id: parts[3], preflight: true }
  }
  return null
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url)
      const isRead = request.method === 'GET'
      await enforceRateLimits(request, env, isRead ? 'read' : 'write')
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
        return json(await applyModerationContentTransition(env.D1_02, {
          contentId: decodeURIComponent(parts[3]),
          decisionId,
          policyVersion,
          outcome: outcome as 'APPROVED' | 'REJECTED',
          ifMatch,
          idempotencyKey,
        }))
      }

      requireTransport(request)
      const path = getPath(url.pathname)

      if (request.method === 'GET' && url.pathname === '/internal/content/creator-contents') {
        const principal = requiredCreatorPrincipal(request)
        const cursor = url.searchParams.get('cursor')
        const limitParam = url.searchParams.get('limit')
        const limit = parseListLimit(limitParam)
        if (cursor && cursor.length > 2048) throw new ContentRuntimeError('VALIDATION_FAILED', 400)
        const filters = validateListFilters(url.searchParams.get('status'), url.searchParams.get('type'))
        const page = await listCreatorContents(env.D1_02, principal.userId, cursor, limit, filters)
        return json({
          data: {
            items: page.items.map(item => ({
              id: item.id,
              contentType: item.contentType,
              state: item.state,
              version: item.version,
              revision: item.revision,
              etag: item.etag,
              title: item.title,
              bodyRef: item.bodyRef,
              mediaRefs: item.mediaRefs,
              coverRef: item.coverRef,
              updatedAt: item.updatedAt,
            })),
            nextCursor: page.nextCursor,
            hasMore: page.hasMore,
          },
          requestId: crypto.randomUUID(),
        })
      }

      if (request.method === 'GET' && url.pathname === '/internal/content/contents') {
        const cursor = url.searchParams.get('cursor')
        const limitParam = url.searchParams.get('limit')
        const creatorId = url.searchParams.get('creatorId')?.trim() || null
        const contentType = url.searchParams.get('type')?.trim() || null
        const limit = parseListLimit(limitParam)
        if (cursor && cursor.length > 2048) throw new ContentRuntimeError('VALIDATION_FAILED', 400)
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
            items: page.items.map(item => ({
              id: item.id,
              contentType: item.contentType,
              state: item.state,
              version: item.version,
              etag: item.etag,
              title: item.title,
              bodyRef: item.bodyRef,
              mediaRefs: item.mediaRefs,
              coverRef: item.coverRef,
            })),
            nextCursor: page.nextCursor,
            hasMore: page.hasMore,
          },
          requestId: crypto.randomUUID(),
        })
      }

      if (!path) return new Response(null, { status: 404 })

      if (request.method === 'POST' && path.id && path.preflight) {
        requiredCreatorPrincipal(request)
        const body = await parseBody(request)
        try {
          return json(preflightContent(normalizePreflightInput(body)))
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
          if (report.verdict === 'RED') throw new ContentRuntimeError('PREFLIGHT_BLOCKED', 422)
        }
        const reason = typeof body.reason === 'string' ? body.reason : undefined
        const result = await transitionContentState(
          env.D1_02,
          principal.userId,
          principal.layer,
          path.id,
          to as ContentState,
          reason,
          requireIfMatch(request),
          requireIdempotency(request),
        )
        return json(result)
      }

      if (request.method === 'POST' && path.id === undefined) {
        const principal = requiredCreatorPrincipal(request)
        const body = await parseBody(request)
        const content = await createContent(
          env.D1_02,
          principal.userId,
          body,
          requireIdempotency(request),
        )
        return json({
          id: content.id,
          creatorId: content.creatorId,
          contentType: content.contentType,
          state: content.state,
          version: content.version,
          etag: content.etag,
          title: content.title,
          bodyRef: content.bodyRef,
          mediaRefs: content.mediaRefs,
          coverRef: content.coverRef,
        }, 201)
      }

      if (request.method === 'GET' && path.id) {
        // Published content is publicly readable; unpublished content remains owner-scoped in getContent().
        const principalUserId = request.headers.get('X-LuckRead-Principal-User-Id')?.trim() || null
        const content = await getContent(env.D1_02, path.id, principalUserId)
        return json({
          id: content.id,
          creatorId: content.creatorId,
          contentType: content.contentType,
          state: content.state,
          version: content.version,
          revision: content.revision,
          etag: content.etag,
          title: content.title,
          bodyRef: content.bodyRef,
          mediaRefs: content.mediaRefs,
          coverRef: content.coverRef,
          updatedAt: content.updatedAt,
        })
      }

      if (request.method === 'PATCH' && path.id) {
        const principal = requiredCreatorPrincipal(request)
        const body = await parseBody(request)
        const content = await updateContent(
          env.D1_02,
          principal.userId,
          path.id,
          body,
          requireIfMatch(request),
          requireIdempotency(request),
        )
        return json({
          id: content.id,
          state: content.state,
          version: content.version,
          etag: content.etag,
          title: content.title,
          bodyRef: content.bodyRef,
        })
      }

      if (request.method === 'DELETE' && path.id) {
        const principal = requiredCreatorPrincipal(request)
        await deleteContent(
          env.D1_02,
          principal.userId,
          path.id,
          requireIfMatch(request),
          requireIdempotency(request),
        )
        return new Response(null, { status: 204 })
      }

      return new Response(null, { status: 404 })
    } catch (error) {
      return toErrorResponse(error)
    }
  },
}
