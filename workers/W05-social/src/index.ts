/// <reference types="@cloudflare/workers-types" />
import { getLikeStatus, like, LikeRuntimeError, unlike } from './like-runtime.js'
import { CommentRuntimeError, createComment, deleteComment, listComments, parseCommentLimit, updateComment } from './comment-runtime.js'
import {
  FavoriteRuntimeError,
  favorite,
  getFavoriteStatus,
  unfavorite,
} from './favorite-runtime.js'
import { ShareRuntimeError, createShare, resolveShare } from './share-runtime.js'
import { BlockMuteRuntimeError, removeRelation, setRelation } from './block-mute-runtime.js'
import { getRelationshipGraph, invalidateRelationshipGraph, RelationshipGraphRuntimeError } from './relationship-graph-runtime.js'
import {
  FollowRuntimeError,
  follow,
  invalidateFollowListCountCache,
  listFollowers,
  listFollowing,
  parseFollowListLimit,
  unfollow,
} from './follow-runtime.js'

type RateLimitBinding = { limit(input: { key: string }): Promise<{ success: boolean }> }

interface Env {
  DB: D1Database
  SOCIAL_READ_LIMITER?: RateLimitBinding
  SOCIAL_WRITE_LIMITER?: RateLimitBinding
  SOCIAL_ORIGIN_GLOBAL_LIMITER?: RateLimitBinding
}

const getRateKey = (request: Request): string => {
  const supplied = request.headers.get('X-LuckRead-Rate-Key')?.trim()
  if (supplied) return supplied
  const principal = request.headers.get('X-LuckRead-Principal-User-Id')?.trim()
  if (principal) return 'user:' + principal
  const clientIp = request.headers.get('X-LuckRead-Client-IP')?.trim()
  return clientIp ? 'ip:' + clientIp : 'transport:W01'
}

const enforceRateLimit = async (request: Request, env: Env, operation: string): Promise<void> => {
  const actorLimiter = request.method === 'GET' ? env.SOCIAL_READ_LIMITER : env.SOCIAL_WRITE_LIMITER
  if (env.SOCIAL_ORIGIN_GLOBAL_LIMITER) {
    const globalResult = await env.SOCIAL_ORIGIN_GLOBAL_LIMITER.limit({ key: 'origin:' + operation })
    if (!globalResult.success) throw new FollowRuntimeError('RATE_LIMITED', 429)
  }
  if (actorLimiter) {
    const result = await actorLimiter.limit({ key: operation + ':' + getRateKey(request) })
    if (!result.success) throw new FollowRuntimeError('RATE_LIMITED', 429)
  }
}

const createRequestId = (): string => 'req_' + crypto.randomUUID()

const json = (body: unknown, status = 200) => {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  if (status === 429) headers.set('retry-after', '60')
  return Response.json(body, { status, headers })
}

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
      await enforceRateLimit(request, env, request.method === 'GET' ? 'read:' + url.pathname.split('/').slice(0, 4).join('/') : 'write:' + url.pathname.split('/').slice(0, 4).join('/'))

      if (url.pathname.startsWith('/internal/social/shares/')) {
        const parts = url.pathname.split('/').filter(Boolean)
        if (parts.length !== 4 || parts[2] !== 'shares') throw new ShareRuntimeError('NOT_FOUND', 404)
        if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } })
        requireTransport(request)
        const shareId = decodePathPart(parts[3])
        if (shareId === null) throw new ShareRuntimeError('VALIDATION_FAILED', 400)
        return json({ data: await resolveShare(env.DB, shareId), requestId: createRequestId() })
      }

      if (url.pathname.startsWith('/internal/social/content/')) {
        const parts = url.pathname.split('/').filter(Boolean)
        if (parts.length !== 5 || parts[2] !== 'content' || parts[4] !== 'shares') throw new ShareRuntimeError('NOT_FOUND', 404)
        if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } })
        const actorUserId = requirePrincipal(request)
        requireInteractionLayer(request)
        const contentId = decodePathPart(parts[3])
        if (contentId === null) throw new ShareRuntimeError('VALIDATION_FAILED', 400)
        const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
        return json({
          data: await createShare(env.DB, actorUserId, contentId, idempotencyKey),
          requestId: createRequestId(),
        }, 201)
      }

      const blockMuteMatch = url.pathname.match(/^\/internal\/social\/interactions\/(blocks|mutes)(?:\/([^/]+))?$/)
      if (blockMuteMatch) {
        const relationType = blockMuteMatch[1] === 'blocks' ? 'block' as const : 'mute' as const
        const targetFromPath = blockMuteMatch[2] ? decodePathPart(blockMuteMatch[2]) : null
        if (request.method === 'POST') {
          if (targetFromPath !== null) return new Response(null, { status: 405, headers: { Allow: 'POST' } })
          const actorUserId = requirePrincipal(request)
          requireInteractionLayer(request)
          const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
          if (!idempotencyKey || idempotencyKey.length > 256) {
            throw new BlockMuteRuntimeError('PRECONDITION_REQUIRED', 428)
          }
          let body: unknown
          try { body = await request.json() } catch { throw new BlockMuteRuntimeError('VALIDATION_FAILED', 400) }
          if (!body || typeof body !== 'object' || Array.isArray(body)) {
            throw new BlockMuteRuntimeError('VALIDATION_FAILED', 400)
          }
          const targetUserId = (body as { targetUserId?: unknown }).targetUserId
          if (typeof targetUserId !== 'string' || !targetUserId.trim()) {
            throw new BlockMuteRuntimeError('VALIDATION_FAILED', 400)
          }
          const relation = await setRelation(env.DB, actorUserId, targetUserId, relationType)
          await invalidateRelationshipGraph(actorUserId, targetUserId)
          if (relationType === 'block') {
            await invalidateFollowListCountCache(actorUserId, targetUserId)
          }
          return json({
            data: relation,
            requestId: createRequestId(),
          })
        }

        if (request.method === 'DELETE' && targetFromPath !== null) {
          const actorUserId = requirePrincipal(request)
          requireInteractionLayer(request)
          const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
          if (!idempotencyKey || idempotencyKey.length > 256) {
            throw new BlockMuteRuntimeError('PRECONDITION_REQUIRED', 428)
          }
          await removeRelation(env.DB, actorUserId, targetFromPath, relationType)
          await invalidateRelationshipGraph(actorUserId, targetFromPath)
          if (relationType === 'block') {
            await invalidateFollowListCountCache(actorUserId, targetFromPath)
          }
          return new Response(null, { status: 204 })
        }

        return new Response(null, { status: 405, headers: { Allow: 'POST, DELETE' } })
      }

      const commentIdParts = url.pathname.split('/').filter(Boolean)
      if (
        commentIdParts.length === 4 &&
        commentIdParts[0] === 'internal' &&
        commentIdParts[1] === 'social' &&
        commentIdParts[2] === 'comments'
      ) {
        const actorUserId = requirePrincipal(request)
        requireInteractionLayer(request)
        const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
        if (!idempotencyKey || idempotencyKey.length > 256) {
          throw new CommentRuntimeError('PRECONDITION_REQUIRED', 428)
        }
        const commentId = decodePathPart(commentIdParts[3])
        if (commentId === null) throw new CommentRuntimeError('VALIDATION_FAILED', 400)

        if (request.method === 'PATCH') {
          const ifMatch = request.headers.get('If-Match')?.trim() ?? ''
          if (!ifMatch || ifMatch.length > 256) {
            throw new CommentRuntimeError('PRECONDITION_REQUIRED', 428)
          }

          let body: unknown
          try { body = await request.json() } catch {
            throw new CommentRuntimeError('VALIDATION_FAILED', 400)
          }
          if (!body || typeof body !== 'object' || Array.isArray(body)) {
            throw new CommentRuntimeError('VALIDATION_FAILED', 400)
          }
          const bodyValue = (body as { body?: unknown }).body
          if (typeof bodyValue !== 'string') {
            throw new CommentRuntimeError('VALIDATION_FAILED', 400)
          }

          const result = await updateComment(env.DB, actorUserId, commentId, {
            body: bodyValue,
            ifMatch,
          })
          return Response.json(
            { data: result.item, requestId: createRequestId() },
            {
              status: 200,
              headers: {
                'content-type': 'application/json; charset=utf-8',
                'cache-control': 'no-store',
                ETag: result.etag,
                'X-LuckRead-Content-Id': result.item.contentId,
              },
            },
          )
        }

        if (request.method === 'DELETE') {
          const contentId = await deleteComment(env.DB, actorUserId, commentId)
          return new Response(null, {
            status: 204,
            headers: { 'X-LuckRead-Content-Id': contentId },
          })
        }

        return new Response(null, {
          status: 405,
          headers: { Allow: 'PATCH, DELETE' },
        })
      }

      const commentContentId = parseCommentPath(url.pathname)
      if (commentContentId !== null) {
        if (request.method === 'GET') {
          requireTransport(request)
          const limit = parseCommentLimit(url.searchParams.get('limit'))
          const cursor = url.searchParams.get('cursor')
          if (cursor && cursor.length > 2048) {
            throw new CommentRuntimeError('INVALID_CURSOR', 400)
          }
          const viewerUserId = request.headers.get('X-LuckRead-Principal-User-Id')?.trim() || null
          const page = await listComments(env.DB, commentContentId, cursor, limit, viewerUserId)
          return json({ data: page, requestId: createRequestId() })
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
        return json({ data: comment, requestId: createRequestId() }, 201)
      }

      if (url.pathname === '/internal/social/interactions/bookmarks') {
        const viewerUserId = requirePrincipal(request)
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

        if (request.method !== 'GET') {
          const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
          if (!idempotencyKey || idempotencyKey.length > 256) {
            throw new FavoriteRuntimeError('PRECONDITION_REQUIRED', 428)
          }
        }

        if (request.method === 'GET') {
          return json({
            data: await getFavoriteStatus(env.DB, viewerUserId, target),
            requestId: createRequestId(),
          })
        }

        if (request.method === 'POST') {
          return json({
            data: await favorite(env.DB, viewerUserId, target),
            requestId: createRequestId(),
          })
        }

        await unfavorite(env.DB, viewerUserId, target)
        return new Response(null, { status: 204 })
      }

      if (url.pathname === '/internal/social/interactions/likes') {
        const viewerUserId = requirePrincipal(request)
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
          return json({ data: result, requestId: createRequestId() }, 200)
        }

        const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
        if (!idempotencyKey || idempotencyKey.length > 256) {
          throw new LikeRuntimeError('PRECONDITION_REQUIRED', 428)
        }

        if (request.method === 'POST') {
          const result = await like(env.DB, viewerUserId, target)
          return json({ data: result, requestId: createRequestId() }, 200)
        }
        await unlike(env.DB, viewerUserId, target)
        return new Response(null, { status: 204 })
      }

      const path = parseFollowPath(url.pathname)
      if (!path) throw new FollowRuntimeError('NOT_FOUND', 404)

      if (path.kind === 'follow') {
        const viewerUserId = requirePrincipal(request)
        if (request.method === 'POST') {
          requireInteractionLayer(request)
          const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
          if (!idempotencyKey || idempotencyKey.length > 256) {
            throw new FollowRuntimeError('PRECONDITION_REQUIRED', 428)
          }
          const row = await follow(env.DB, viewerUserId, path.userId)
          await invalidateRelationshipGraph(viewerUserId, path.userId)
          return json({
            data: {
              following: true,
              relationshipId: row.relationship_id,
              targetUserId: row.target_user_id,
              createdAt: row.created_at,
            },
            requestId: createRequestId(),
          }, 201)
        }

        if (request.method === 'DELETE') {
          requireInteractionLayer(request)
          const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
          if (!idempotencyKey || idempotencyKey.length > 256) {
            throw new FollowRuntimeError('PRECONDITION_REQUIRED', 428)
          }
          await unfollow(env.DB, viewerUserId, path.userId)
          await invalidateRelationshipGraph(viewerUserId, path.userId)
          return new Response(null, { status: 204 })
        }

        if (request.method === 'GET') {
          requireInteractionLayer(request)
          const relationship = await getRelationshipGraph(env.DB, viewerUserId, path.userId)
          return json({
            data: {
              following: relationship.following,
              relationshipId: relationship.relationshipId,
              targetUserId: path.userId,
              createdAt: relationship.createdAt,
              relationship,
            },
            requestId: createRequestId(),
          })
        }

        return new Response(null, {
          status: 405,
          headers: { Allow: 'GET, POST, DELETE' },
        })
      }

      if (request.method === 'GET') {
        requireTransport(request)
      } else {
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
        requestId: createRequestId(),
      })
    } catch (error) {
      if (
        error instanceof FollowRuntimeError ||
        error instanceof LikeRuntimeError ||
        error instanceof CommentRuntimeError ||
        error instanceof FavoriteRuntimeError ||
        error instanceof ShareRuntimeError ||
        error instanceof BlockMuteRuntimeError ||
        error instanceof RelationshipGraphRuntimeError
      ) {
        return json({
          error: {
            code: error.code,
            message: error.code,
            details: {},
          },
          requestId: createRequestId(),
        }, error.code === 'VALIDATION_FAILED' && error.status === 400 ? 422 : error.status)
      }

      return json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal error',
          details: {},
        },
        requestId: createRequestId(),
      }, 500)
    }
  },
}
