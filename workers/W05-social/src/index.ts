/// <reference types="@cloudflare/workers-types" />
import { getLikeStatus, like, LikeRuntimeError, unlike } from './like-runtime.js'
import { CommentRuntimeError, createComment, listComments, parseCommentLimit } from './comment-runtime.js'
import {
  FollowRuntimeError,
  follow,
  getFollowStatus,
  listFollowers,
  listFollowing,
  parseFollowListLimit,
  unfollow,
} from './follow-runtime.js'

interface Env { DB: D1Database }

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
    !request.headers.get('X-LuckRead-Correlation-Id')?.trim()
  ) {
    throw new FollowRuntimeError('PERMISSION_DENIED', 403)
  }
}

const requirePrincipal = (request: Request): string => {
  requireTransport(request)
  const id = request.headers.get('X-LuckRead-Principal-User-Id')?.trim() ?? ''
  if (!id) throw new FollowRuntimeError('UNAUTHENTICATED', 401)
  return id
}

const requireInteractionLayer = (request: Request): void => {
  const layer = request.headers.get('X-LuckRead-Principal-Layer')?.trim() ?? ''
  if (!/^L[0-8]$/.test(layer) || Number(layer.slice(1)) < 2) {
    throw new LikeRuntimeError('PERMISSION_DENIED', 403)
  }
}

const parseJsonTarget = async (request: Request) => {
  try {
    const value = await request.json()
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
    const targetType = (value as { targetType?: unknown }).targetType
    const targetId = (value as { targetId?: unknown }).targetId
    if (typeof targetType !== 'string' || typeof targetId !== 'string') throw new Error('invalid')
    return { targetType, targetId }
  } catch {
    throw new LikeRuntimeError('VALIDATION_FAILED', 400)
  }
}

const decodePathPart = (value: string): string | null => {
  try { return decodeURIComponent(value) } catch { return null }
}

const parseFollowPath = (pathname: string) => {
  const parts = pathname.split('/').filter(Boolean)
  if (
    parts.length === 4 &&
    parts[0] === 'internal' &&
    parts[1] === 'social' &&
    parts[2] === 'follows'
  ) {
    const userId = decodePathPart(parts[3])
    return userId === null ? null : { kind: 'follow' as const, userId }
  }

  if (
    parts.length === 5 &&
    parts[0] === 'internal' &&
    parts[1] === 'social' &&
    parts[2] === 'users' &&
    ['followers', 'following'].includes(parts[4])
  ) {
    const userId = decodePathPart(parts[3])
    if (userId === null) return null
    return {
      kind: parts[4] as 'followers' | 'following',
      userId,
    }
  }

  return null
}

const parseCommentPath = (pathname: string): string | null => {
  const parts = pathname.split('/').filter(Boolean)
  if (
    parts.length === 5 &&
    parts[0] === 'internal' &&
    parts[1] === 'social' &&
    parts[2] === 'contents' &&
    parts[4] === 'comments'
  ) {
    return decodePathPart(parts[3])
  }
  return null
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url)

      const commentContentId = parseCommentPath(url.pathname)
      if (commentContentId !== null) {
        if (request.method === 'GET') {
          requireTransport(request)
          const limit = parseCommentLimit(url.searchParams.get('limit'))
          const cursor = url.searchParams.get('cursor')
          if (cursor && cursor.length > 2048) {
            throw new CommentRuntimeError('INVALID_CURSOR', 400)
          }
          const page = await listComments(env.DB, commentContentId, cursor, limit)
          return json({ data: page, requestId: crypto.randomUUID() })
        }

        const viewerUserId = requirePrincipal(request)
        requireInteractionLayer(request)
        if (request.method !== 'POST') {
          return new Response(null, { status: 405, headers: { Allow: 'GET, POST' } })
        }

        const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
        if (!idempotencyKey || idempotencyKey.length > 256) {
          throw new CommentRuntimeError('PRECONDITION_REQUIRED', 428)
        }

        let body: unknown
        try { body = await request.json() } catch { throw new CommentRuntimeError('VALIDATION_FAILED', 400) }
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          throw new CommentRuntimeError('VALIDATION_FAILED', 400)
        }

        const bodyValue = (body as { body?: unknown }).body
        const parentId = (body as { parentId?: unknown }).parentId
        if (
          typeof bodyValue !== 'string' ||
          (parentId !== undefined && parentId !== null && typeof parentId !== 'string')
        ) {
          throw new CommentRuntimeError('VALIDATION_FAILED', 400)
        }

        const comment = await createComment(env.DB, viewerUserId, commentContentId, {
          body: bodyValue,
          parentId: parentId ?? null,
          idempotencyKey,
        })
        return json({ data: comment }, 201)
      }

      const viewerUserId = requirePrincipal(request)

      if (url.pathname === '/internal/social/interactions/likes') {
        if (request.method !== 'GET' && request.method !== 'POST' && request.method !== 'DELETE') {
          return new Response(null, { status: 405, headers: { Allow: 'GET, POST, DELETE' } })
        }
        requireInteractionLayer(request)
        const target = request.method === 'GET'
          ? {
              targetType: url.searchParams.get('targetType') ?? '',
              targetId: url.searchParams.get('targetId') ?? '',
            }
          : await parseJsonTarget(request)
        if (request.method === 'GET') {
          const result = await getLikeStatus(env.DB, viewerUserId, target)
          return json({ data: result, requestId: crypto.randomUUID() }, 200)
        }
        if (request.method === 'POST') {
          const result = await like(env.DB, viewerUserId, target)
          return json({ data: result, requestId: crypto.randomUUID() }, 200)
        }
        await unlike(env.DB, viewerUserId, target)
        return new Response(null, { status: 204 })
      }

      const path = parseFollowPath(url.pathname)
      if (!path) return new Response(null, { status: 404 })

      if (path.kind === 'follow') {
        if (request.method === 'POST') {
          const row = await follow(env.DB, viewerUserId, path.userId)
          return json({
            data: {
              following: true,
              relationshipId: row.relationship_id,
              targetUserId: row.target_user_id,
              createdAt: row.created_at,
            },
            requestId: crypto.randomUUID(),
          }, 201)
        }

        if (request.method === 'DELETE') {
          await unfollow(env.DB, viewerUserId, path.userId)
          return new Response(null, { status: 204 })
        }

        if (request.method === 'GET') {
          return json({
            data: await getFollowStatus(env.DB, viewerUserId, path.userId),
            requestId: crypto.randomUUID(),
          })
        }

        return new Response(null, {
          status: 405,
          headers: { Allow: 'GET, POST, DELETE' },
        })
      }

      if (request.method !== 'GET') {
        return new Response(null, {
          status: 405,
          headers: { Allow: 'GET' },
        })
      }

      const limit = parseFollowListLimit(url.searchParams.get('limit'))
      const cursor = url.searchParams.get('cursor')
      if (cursor && cursor.length > 2048) {
        throw new FollowRuntimeError('INVALID_CURSOR', 400)
      }

      const page = path.kind === 'followers'
        ? await listFollowers(env.DB, path.userId, cursor, limit)
        : await listFollowing(env.DB, path.userId, cursor, limit)

      return json({
        data: page,
        requestId: crypto.randomUUID(),
      })
    } catch (error) {
      if (
        error instanceof FollowRuntimeError ||
        error instanceof LikeRuntimeError ||
        error instanceof CommentRuntimeError
      ) {
        return json({
          error: {
            code: error.code,
            message: error.code,
            details: {},
          },
          requestId: crypto.randomUUID(),
        }, error.status)
      }

      return json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal error',
          details: {},
        },
        requestId: crypto.randomUUID(),
      }, 500)
    }
  },
}
