/// <reference types="@cloudflare/workers-types" />

import {
  ContentRuntimeError,
  createContent,
  deleteContent,
  getContent,
  listContents,
  listOwnedContents,
  toErrorResponse,
  transitionContentState,
  updateContent,
  type ContentState,
  type ContentD1,
} from './content-runtime.js'

interface Env {
  D1_02: D1Database
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

const getPath = (pathname: string): {id?: string; state?: boolean} | null => {
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
  return null
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      requireTransport(request)
      const url = new URL(request.url)
      const path = getPath(url.pathname)

      if (request.method === 'GET' && url.pathname === '/internal/content/creator/contents') {
        const principal = requiredPrincipal(request)
        const cursor = url.searchParams.get('cursor')
        const limitParam = url.searchParams.get('limit')
        const limit = limitParam ? Number(limitParam) : 20
        const requestedState = url.searchParams.get('state')
        const requestedType = url.searchParams.get('contentType')
        const state = requestedState && requestedState !== 'ALL'
          ? requestedState as ContentState
          : null
        const contentType = requestedType && requestedType !== 'ALL'
          ? requestedType as 'article' | 'post' | 'video'
          : null

        if (cursor && cursor.length > 2048) throw new ContentRuntimeError('VALIDATION_FAILED', 400)
        if (state && !['DRAFT','PENDING_REVIEW','REJECTED','APPROVED','SCHEDULED','PUBLISHED','UNPUBLISHED','ARCHIVED','DELETED','RESTORED'].includes(state)) {
          throw new ContentRuntimeError('VALIDATION_FAILED', 400)
        }
        if (contentType && !['article','post','video'].includes(contentType)) {
          throw new ContentRuntimeError('VALIDATION_FAILED', 400)
        }

        const page = await listOwnedContents(
          env.D1_02,
          principal.userId,
          cursor,
          limit,
          state,
          contentType,
        )
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
              createdAt: item.createdAt,
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
        const limit = limitParam ? Number(limitParam) : 20
        if (cursor && cursor.length > 2048) throw new ContentRuntimeError('VALIDATION_FAILED', 400)
        const page = await listContents(env.D1_02, cursor, limit)
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

      if (request.method === 'POST' && path.id && path.state) {
        const principal = requiredPrincipal(request)
        const body = await parseBody(request)
        const to = body.to
        if (typeof to !== 'string') throw new ContentRuntimeError('VALIDATION_FAILED', 400)
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
        const principal = requiredPrincipal(request)
        const body = await parseBody(request)
        const content = await createContent(
          env.D1_02,
          principal.userId,
          body,
          requireIdempotency(request),
        )
        return json({
          id: content.id,
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
        const principalUserId = request.headers.get('X-LuckRead-Principal-User-Id')?.trim() || null
        const content = await getContent(env.D1_02, path.id, principalUserId)
        return json({
          id: content.id,
          state: content.state,
          version: content.version,
          etag: content.etag,
          title: content.title,
          bodyRef: content.bodyRef,
        })
      }

      if (request.method === 'PATCH' && path.id) {
        const principal = requiredPrincipal(request)
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
        const principal = requiredPrincipal(request)
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
