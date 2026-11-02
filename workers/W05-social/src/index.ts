/// <reference types="@cloudflare/workers-types" />
import { listContentLikers } from './like-list-runtime.js'
import { getLikeStatus, like, LikeRuntimeError, unlike } from './like-runtime.js'
import { CommentRuntimeError, createComment, deleteComment, listComments, parseCommentLimit, parseCommentSort, updateComment } from './comment-runtime.js'
import { listProfileLikedContents, listProfileReplies, ProfileChannelRuntimeError } from './profile-channel-runtime.js'
import { getContentReplyAudience, ReplyAudienceRuntimeError, setContentReplyAudience } from './reply-audience-runtime.js'
import { fetchOwnedPostContext, fetchPublishedContentSocialContext, fetchPublishedOwnerPostContext, type W03ContentBinding } from './w03-content-context-client.js'
import {
  FavoriteRuntimeError,
  favorite,
  getFavoriteStatus,
  listFavorites,
  unfavorite,
} from './favorite-runtime.js'
import { ShareRuntimeError, createShare, resolveShare } from './share-runtime.js'
import { RepostRuntimeError, createRepost, removeRepost } from './repost-runtime.js'
import { ProfilePinRuntimeError, getProfilePinReference, pinProfileContent, unpinProfileContent } from './profile-pin-runtime.js'
import { BlockMuteRuntimeError, listRelations, parseBlockMuteListLimit, removeRelation, setRelation } from './block-mute-runtime.js'
import { getRelationshipGraph, invalidateRelationshipGraph, RelationshipGraphRuntimeError } from './relationship-graph-runtime.js'
import {
  SocialClosureRuntimeError,
  enqueueNotification,
  getContentSocialSummary,
  getNotificationPreferences,
  getSocialTargets,
  getTopicPage,
  listDiscoveryTopics,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  setNotificationPreferences,
  syncSocialTokens,
} from './social-closure-runtime.js'
import { castContentPollVote, configureContentPoll, deleteContentPoll, getContentPoll, SocialPollError } from './poll-runtime.js'
import {
  FollowRuntimeError,
  follow,
  invalidateFollowListCountCache,
  listFollowers,
  listFollowing,
  listFollowingAuthorIds,
  parseFollowListLimit,
  unfollow,
} from './follow-runtime.js'

type RateLimitBinding = { limit(input: { key: string }): Promise<{ success: boolean }> }

interface Env {
  DB: D1Database
  W03_CONTENT?: W03ContentBinding
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

const requireFollowingFeedPrincipal = (request: Request): string => {
  if (
    request.headers.get('X-LuckRead-Caller') !== 'W04' ||
    request.headers.get('X-LuckRead-Transport-Version') !== '1.0' ||
    !request.headers.get('X-LuckRead-Correlation-Id')?.trim() ||
    request.headers.has('Authorization') ||
    request.headers.has('Cookie')
  ) {
    throw new FollowRuntimeError('PERMISSION_DENIED', 403)
  }
  const id = request.headers.get('X-LuckRead-Principal-User-Id')?.trim() ?? ''
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) {
    throw new FollowRuntimeError('UNAUTHENTICATED', 401)
  }
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


const getPublishedContentOwnerUserId = async (
  binding: W03ContentBinding | undefined,
  contentId: string,
  correlationId: string,
): Promise<string | null> => {
  try {
    const context = await fetchPublishedContentSocialContext(binding, { contentId, correlationId })
    return context.ownerUserId
  } catch (error) {
    if (error instanceof ReplyAudienceRuntimeError && error.status === 404) return null
    throw error
  }
}

const getInteractionRecipient = async (
  db: D1Database,
  targetType: string,
  targetId: string,
  w03Content: W03ContentBinding | undefined,
  correlationId: string,
): Promise<string | null> => {
  if (targetType === 'content') {
    return getPublishedContentOwnerUserId(w03Content, targetId, correlationId)
  }
  if (targetType === 'comment') {
    const row = await db.prepare(
      'SELECT author_user_id FROM social_comments WHERE id = ? AND state = \'PUBLISHED\' LIMIT 1',
    ).bind(targetId).first<{ author_user_id: string | null }>()
    return row?.author_user_id ?? null
  }
  return null
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

const parseProfileChannelPath = (pathname: string): { userId: string; kind: 'replies' | 'likes' } | null => {
  const parts = pathname.split('/').filter(Boolean)
  if (
    parts.length !== 5 ||
    parts[0] !== 'internal' ||
    parts[1] !== 'social' ||
    parts[2] !== 'users' ||
    (parts[4] !== 'replies' && parts[4] !== 'likes')
  ) return null
  const userId = decodePathPart(parts[3])
  if (userId === null || !userId.trim()) return null
  return { userId, kind: parts[4] }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url)
      await enforceRateLimit(request, env, request.method === 'GET' ? 'read:' + url.pathname.split('/').slice(0, 4).join('/') : 'write:' + url.pathname.split('/').slice(0, 4).join('/'))

      const repostMatch = /^\/internal\/social\/content\/([^/]+)\/reposts$/.exec(url.pathname)
      if (repostMatch) {
        const contentId = decodePathPart(repostMatch[1] ?? '')
        if (contentId === null) throw new RepostRuntimeError('VALIDATION_FAILED', 400)
        if (request.method !== 'POST' && request.method !== 'DELETE') {
          return new Response(null, { status: 405, headers: { Allow: 'POST, DELETE' } })
        }
        const actorUserId = requirePrincipal(request)
        requireInteractionLayer(request)
        const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
        if (!idempotencyKey) throw new RepostRuntimeError('PRECONDITION_REQUIRED', 428)
        if (idempotencyKey.length > 256) throw new RepostRuntimeError('VALIDATION_FAILED', 400)
        if (request.method === 'POST') {
          return json({
            data: await createRepost(env.DB, env.W03_CONTENT, actorUserId, contentId, request.headers.get('X-LuckRead-Correlation-Id')?.trim() ?? ''),
            requestId: createRequestId(),
          }, 201)
        }
        await removeRepost(env.DB, actorUserId, contentId)
        return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
      }

      const pinMatch = /^\/internal\/social\/content\/([^/]+)\/pin$/.exec(url.pathname)
      if (pinMatch) {
        const contentId = decodePathPart(pinMatch[1] ?? '')
        if (contentId === null) throw new ProfilePinRuntimeError('VALIDATION_FAILED', 400)
        if (request.method !== 'POST' && request.method !== 'DELETE') {
          return new Response(null, { status: 405, headers: { Allow: 'POST, DELETE' } })
        }
        const actorUserId = requirePrincipal(request)
        requireInteractionLayer(request)
        const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
        if (!idempotencyKey) throw new ProfilePinRuntimeError('PRECONDITION_REQUIRED', 428)
        if (idempotencyKey.length > 256) throw new ProfilePinRuntimeError('VALIDATION_FAILED', 400)
        if (request.method === 'POST') {
          const context = await fetchOwnedPostContext(env.W03_CONTENT, {
            principalUserId: actorUserId,
            principalLayer: request.headers.get('X-LuckRead-Principal-Layer')?.trim() ?? '',
            contentId,
            correlationId: request.headers.get('X-LuckRead-Correlation-Id')?.trim() ?? '',
          })
          return json({
            data: await pinProfileContent(env.DB, actorUserId, contentId, context),
            requestId: createRequestId(),
          })
        }
        await unpinProfileContent(env.DB, actorUserId, contentId)
        return new Response(null, { status: 204 })
      }

      const pinnedContentMatch = /^\/internal\/social\/users\/([^/]+)\/pinned-content$/.exec(url.pathname)
      if (pinnedContentMatch) {
        if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } })
        requireTransport(request)
        const userId = decodePathPart(pinnedContentMatch[1] ?? '')
        if (userId === null) throw new ProfilePinRuntimeError('VALIDATION_FAILED', 400)
        const pin = await getProfilePinReference(env.DB, userId)
        if (!pin) return json({ data: null, requestId: createRequestId() })
        try {
          await fetchPublishedOwnerPostContext(env.W03_CONTENT, {
            ownerUserId: userId,
            contentId: pin.contentId,
            correlationId: request.headers.get('X-LuckRead-Correlation-Id')?.trim() ?? '',
          })
        } catch (error) {
          if (error instanceof ReplyAudienceRuntimeError && error.code === 'NOT_FOUND') {
            return json({ data: null, requestId: createRequestId() })
          }
          throw error
        }
        return json({ data: pin, requestId: createRequestId() })
      }

      if (url.pathname.startsWith('/internal/social/shares/')) {
        const parts = url.pathname.split('/').filter(Boolean)
        if (parts.length !== 4 || parts[2] !== 'shares') throw new ShareRuntimeError('NOT_FOUND', 404)
        if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } })
        requireTransport(request)
        const shareId = decodePathPart(parts[3])
        if (shareId === null) throw new ShareRuntimeError('VALIDATION_FAILED', 400)
        return json({ data: await resolveShare(env.DB, env.W03_CONTENT, shareId, request.headers.get('X-LuckRead-Correlation-Id') ?? ''), requestId: createRequestId() })
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
          data: await createShare(env.DB, env.W03_CONTENT, actorUserId, contentId, idempotencyKey, request.headers.get('X-LuckRead-Correlation-Id') ?? ''),
          requestId: createRequestId(),
        }, 201)
      }

      const blockMuteMatch = url.pathname.match(/^\/internal\/social\/interactions\/(blocks|mutes)(?:\/([^/]+))?$/)
      if (blockMuteMatch) {
        const relationType = blockMuteMatch[1] === 'blocks' ? 'block' as const : 'mute' as const
        const targetFromPath = blockMuteMatch[2] ? decodePathPart(blockMuteMatch[2]) : null
        if (request.method === 'GET' && targetFromPath === null) {
          const actorUserId = requirePrincipal(request)
          requireInteractionLayer(request)
          const cursorValues = url.searchParams.getAll('cursor')
          const limitValues = url.searchParams.getAll('limit')
          let invalidQuery = false
          url.searchParams.forEach((_value, key) => {
            if (key !== 'cursor' && key !== 'limit') invalidQuery = true
          })
          if (invalidQuery || cursorValues.length > 1 || limitValues.length > 1) {
            throw new BlockMuteRuntimeError('VALIDATION_FAILED', 400)
          }
          const limit = parseBlockMuteListLimit(limitValues[0] ?? null)
          return json({
            data: await listRelations(env.DB, actorUserId, relationType, cursorValues[0] ?? null, limit),
            requestId: createRequestId(),
          })
        }

        if (request.method === 'POST') {
          if (targetFromPath !== null) return new Response(null, { status: 405, headers: { Allow: 'POST' } })
          const actorUserId = requirePrincipal(request)
          requireInteractionLayer(request)
          const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
          if (!idempotencyKey) throw new BlockMuteRuntimeError('PRECONDITION_REQUIRED', 428)
          if (idempotencyKey.length > 256) throw new BlockMuteRuntimeError('VALIDATION_FAILED', 400)
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
          if (!idempotencyKey) throw new BlockMuteRuntimeError('PRECONDITION_REQUIRED', 428)
          if (idempotencyKey.length > 256) throw new BlockMuteRuntimeError('VALIDATION_FAILED', 400)
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
        if (!idempotencyKey) throw new CommentRuntimeError('PRECONDITION_REQUIRED', 428)
          if (idempotencyKey.length > 256) throw new CommentRuntimeError('VALIDATION_FAILED', 400)
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
          const rawMentions = (body as { mentions?: unknown }).mentions
          if (
            typeof bodyValue !== 'string' ||
            (rawMentions !== undefined &&
              (!Array.isArray(rawMentions) ||
                rawMentions.length > 20 ||
                rawMentions.some((value) =>
                  !value ||
                  typeof value !== 'object' ||
                  Array.isArray(value) ||
                  typeof (value as { userId?: unknown }).userId !== 'string' ||
                  typeof (value as { handle?: unknown }).handle !== 'string'
                )))
          ) {
            throw new CommentRuntimeError('VALIDATION_FAILED', 400)
          }

          const result = await updateComment(env.DB, env.W03_CONTENT, actorUserId, commentId, {
            body: bodyValue,
            ifMatch,
          }, request.headers.get('X-LuckRead-Correlation-Id')?.trim() ?? '')
          const mentionTargets = rawMentions === undefined ? [] : rawMentions as Array<{ userId: string; handle: string }>
          await syncSocialTokens(env.DB, actorUserId, 'comment', commentId, bodyValue, mentionTargets)
          const persistedMentions = await getSocialTargets(env.DB, 'comment', commentId)
          const item = { ...result.item, mentions: persistedMentions.mentions }
          return Response.json(
            { data: item, requestId: createRequestId() },
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
          const contentId = await deleteComment(
            env.DB,
            env.W03_CONTENT,
            actorUserId,
            commentId,
            request.headers.get('X-LuckRead-Correlation-Id')?.trim() ?? '',
          )
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

      if (url.pathname.match(/^\/internal\/social\/contents\/[^/]+\/summary$/)) {
        const parts = url.pathname.split('/').filter(Boolean)
        if (parts.length !== 5 || parts[0] !== 'internal' || parts[1] !== 'social' || parts[2] !== 'contents' || parts[4] !== 'summary') {
          return new Response(null, { status: 404 })
        }
        if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } })
        requireTransport(request)
        const contentId = decodePathPart(parts[3])
        if (contentId === null) throw new SocialClosureRuntimeError('VALIDATION_FAILED', 400)
        const viewerUserId = request.headers.get('X-LuckRead-Principal-User-Id')?.trim() || null
        const contentContext = await fetchPublishedContentSocialContext(env.W03_CONTENT, {
          contentId,
          correlationId: request.headers.get('X-LuckRead-Correlation-Id') ?? '',
        })
        return json({ data: await getContentSocialSummary(env.DB, contentId, contentContext, viewerUserId), requestId: crypto.randomUUID() })
      }

      if (url.pathname.match(/^\/internal\/social\/contents\/[^/]+\/tokens$/)) {
        const parts = url.pathname.split('/').filter(Boolean)
        if (parts.length !== 5 || parts[0] !== 'internal' || parts[1] !== 'social' || parts[2] !== 'contents' || parts[4] !== 'tokens') {
          return new Response(null, { status: 404 })
        }
        const contentId = decodePathPart(parts[3])
        if (contentId === null) throw new SocialClosureRuntimeError('VALIDATION_FAILED', 400)
        if (request.method === 'GET') {
          requireTransport(request)
          await fetchPublishedContentSocialContext(env.W03_CONTENT, {
            contentId,
            correlationId: request.headers.get('X-LuckRead-Correlation-Id') ?? '',
          })
          return json({ data: await getSocialTargets(env.DB, 'content', contentId), requestId: crypto.randomUUID() })
        }
        if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'GET, POST' } })
        const actorUserId = requirePrincipal(request)
        requireInteractionLayer(request)
        let body: unknown
        try { body = await request.json() } catch { throw new SocialClosureRuntimeError('VALIDATION_FAILED', 400) }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SocialClosureRuntimeError('VALIDATION_FAILED', 400)
        const rawText = (body as { text?: unknown }).text
        const rawMentions = (body as { mentions?: unknown }).mentions
        if (typeof rawText !== 'string' || rawText.length > 10000) throw new SocialClosureRuntimeError('VALIDATION_FAILED', 400)
        const mentions = rawMentions === undefined
          ? []
          : Array.isArray(rawMentions) && rawMentions.every((value) => value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { userId?: unknown }).userId === 'string' && typeof (value as { handle?: unknown }).handle === 'string')
            ? rawMentions as Array<{ userId: string; handle: string }>
            : (() => { throw new SocialClosureRuntimeError('VALIDATION_FAILED', 400) })()
        const contentContext = await fetchPublishedContentSocialContext(env.W03_CONTENT, {
          contentId,
          correlationId: request.headers.get('X-LuckRead-Correlation-Id') ?? '',
        })
        const result = await syncSocialTokens(env.DB, actorUserId, 'content', contentId, rawText, mentions, contentContext)
        return json({ data: result, requestId: crypto.randomUUID() })
      }

      if (url.pathname === '/internal/social/discovery/topics') {
        if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } })
        requireTransport(request)
        const discoveryUrl = new URL(request.url)
        let invalidQueryKey = false
        discoveryUrl.searchParams.forEach((_value, key) => {
          if (key !== 'limit' && key !== 'cursor') invalidQueryKey = true
        })
        if (invalidQueryKey || discoveryUrl.searchParams.getAll('limit').length > 1 || discoveryUrl.searchParams.getAll('cursor').length > 1) {
          throw new SocialClosureRuntimeError('VALIDATION_FAILED', 400)
        }
        return json({
          data: await listDiscoveryTopics(env.DB, env.W03_CONTENT, request.headers.get('X-LuckRead-Correlation-Id') ?? '', discoveryUrl.searchParams.get('limit'), discoveryUrl.searchParams.get('cursor')),
          requestId: createRequestId(),
        })
      }

      if (url.pathname.startsWith('/internal/social/topics/')) {
        const parts = url.pathname.split('/').filter(Boolean)
        if (parts.length !== 4 || parts[0] !== 'internal' || parts[1] !== 'social' || parts[2] !== 'topics') return new Response(null, { status: 404 })
        if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } })
        requireTransport(request)
        const topicName = decodePathPart(parts[3])
        if (topicName === null) throw new SocialClosureRuntimeError('VALIDATION_FAILED', 400)
        const topicUrl = new URL(request.url)
        return json({
          data: await getTopicPage(
            env.DB,
            env.W03_CONTENT,
            topicName,
            topicUrl.searchParams.get('limit'),
            topicUrl.searchParams.get('cursor'),
            request.headers.get('X-LuckRead-Correlation-Id')?.trim() ?? '',
          ),
          requestId: crypto.randomUUID(),
        })
      }

      if (url.pathname === '/internal/social/notifications') {
        if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } })
        const actorUserId = requirePrincipal(request)
        requireInteractionLayer(request)
        const url = new URL(request.url)
        return json({
          data: await listNotifications(env.DB, actorUserId, url.searchParams.get('cursor'), url.searchParams.get('limit'), url.searchParams.get('type')),
          requestId: crypto.randomUUID(),
        })
      }

      const notificationReadMatch = /^\/internal\/social\/notifications\/([^/]+)\/read$/.exec(url.pathname)
      if (notificationReadMatch) {
        if (request.method !== 'PATCH' && request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'PATCH, POST' } })
        const actorUserId = requirePrincipal(request)
        requireInteractionLayer(request)
        const notificationId = decodePathPart(notificationReadMatch[1])
        if (notificationId === null) throw new SocialClosureRuntimeError('VALIDATION_FAILED', 400)
        await markNotificationRead(env.DB, actorUserId, notificationId)
        return new Response(null, { status: 204 })
      }

      if (url.pathname === '/internal/social/notifications/read-all') {
        if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } })
        const actorUserId = requirePrincipal(request)
        requireInteractionLayer(request)
        await markAllNotificationsRead(env.DB, actorUserId)
        return new Response(null, { status: 204 })
      }

      if (url.pathname === '/internal/social/notification-preferences') {
        const actorUserId = requirePrincipal(request)
        requireInteractionLayer(request)
        if (request.method === 'GET') {
          return json({ data: await getNotificationPreferences(env.DB, actorUserId), requestId: crypto.randomUUID() })
        }
        if (request.method !== 'PATCH') return new Response(null, { status: 405, headers: { Allow: 'GET, PATCH' } })
        let body: unknown
        try { body = await request.json() } catch { throw new SocialClosureRuntimeError('VALIDATION_FAILED', 400) }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SocialClosureRuntimeError('VALIDATION_FAILED', 400)
        const raw = body as Record<string, unknown>
        const input: Partial<{ follow: boolean; like: boolean; comment: boolean; mention: boolean }> = {}
        for (const key of ['follow', 'like', 'comment', 'mention'] as const) {
          if (raw[key] === undefined) continue
          if (typeof raw[key] !== 'boolean') throw new SocialClosureRuntimeError('VALIDATION_FAILED', 400)
          input[key] = raw[key]
        }
        return json({ data: await setNotificationPreferences(env.DB, actorUserId, input), requestId: crypto.randomUUID() })
      }

      const pollVoteMatch = /^\/internal\/social\/contents\/([^/]+)\/poll\/votes$/.exec(url.pathname)
      if (pollVoteMatch) {
        if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } })
        const actorUserId = requirePrincipal(request)
        requireInteractionLayer(request)
        const contentId = decodePathPart(pollVoteMatch[1])
        if (contentId === null) throw new SocialPollError('VALIDATION_FAILED', 400)
        const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
        if (!idempotencyKey) throw new SocialPollError('PRECONDITION_REQUIRED', 428)
        if (idempotencyKey.length > 256) throw new SocialPollError('VALIDATION_FAILED', 400)
        let body: unknown
        try { body = await request.json() } catch { throw new SocialPollError('VALIDATION_FAILED', 400) }
        if (!body || typeof body !== 'object' || Array.isArray(body) || typeof (body as { optionId?: unknown }).optionId !== 'string') {
          throw new SocialPollError('VALIDATION_FAILED', 400)
        }
        const poll = await castContentPollVote(env.DB, env.W03_CONTENT, actorUserId, contentId, (body as { optionId: string }).optionId, request.headers.get('X-LuckRead-Correlation-Id')?.trim() ?? '')
        return json({ data: { poll }, requestId: createRequestId() }, 200)
      }

      const contentPollMatch = /^\/internal\/social\/contents\/([^/]+)\/poll$/.exec(url.pathname)
      if (contentPollMatch) {
        const contentId = decodePathPart(contentPollMatch[1])
        if (contentId === null) throw new SocialPollError('VALIDATION_FAILED', 400)
        if (request.method === 'GET') {
          requireTransport(request)
          const viewerUserId = request.headers.get('X-LuckRead-Principal-User-Id')?.trim() || null
          let contentContext: Awaited<ReturnType<typeof fetchPublishedContentSocialContext>> | Awaited<ReturnType<typeof fetchOwnedPostContext>>
          try {
            contentContext = await fetchPublishedContentSocialContext(env.W03_CONTENT, {
              contentId,
              correlationId: request.headers.get('X-LuckRead-Correlation-Id')?.trim() ?? '',
            })
          } catch (error) {
            if (!(error instanceof ReplyAudienceRuntimeError) || error.status !== 404 || !viewerUserId) throw error
            contentContext = await fetchOwnedPostContext(env.W03_CONTENT, {
              principalUserId: viewerUserId,
              principalLayer: request.headers.get('X-LuckRead-Principal-Layer')?.trim() ?? '',
              contentId,
              correlationId: request.headers.get('X-LuckRead-Correlation-Id')?.trim() ?? '',
            })
          }
          const poll = await getContentPoll(env.DB, contentId, viewerUserId, contentContext)
          return json({ data: { poll }, requestId: createRequestId() })
        }
        if (request.method === 'POST') {
          const actorUserId = requirePrincipal(request)
          requireInteractionLayer(request)
          const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
          if (!idempotencyKey) throw new SocialPollError('PRECONDITION_REQUIRED', 428)
          if (idempotencyKey.length > 256) throw new SocialPollError('VALIDATION_FAILED', 400)
          let body: unknown
          try { body = await request.json() } catch { throw new SocialPollError('VALIDATION_FAILED', 400) }
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SocialPollError('VALIDATION_FAILED', 400)
          const raw = body as Record<string, unknown>
          const contentContext = await fetchOwnedPostContext(env.W03_CONTENT, {
            principalUserId: actorUserId,
            principalLayer: request.headers.get('X-LuckRead-Principal-Layer')?.trim() ?? '',
            contentId,
            correlationId: request.headers.get('X-LuckRead-Correlation-Id')?.trim() ?? '',
          })
          const poll = await configureContentPoll(env.DB, actorUserId, contentId, raw.options, raw.durationHours, contentContext)
          return json({ data: { poll }, requestId: createRequestId() }, 200)
        }
        if (request.method === 'DELETE') {
          const actorUserId = requirePrincipal(request)
          requireInteractionLayer(request)
          const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
          if (!idempotencyKey) throw new SocialPollError('PRECONDITION_REQUIRED', 428)
          if (idempotencyKey.length > 256) throw new SocialPollError('VALIDATION_FAILED', 400)
          const contentContext = await fetchOwnedPostContext(env.W03_CONTENT, {
            principalUserId: actorUserId,
            principalLayer: request.headers.get('X-LuckRead-Principal-Layer')?.trim() ?? '',
            contentId,
            correlationId: request.headers.get('X-LuckRead-Correlation-Id')?.trim() ?? '',
          })
          await deleteContentPoll(env.DB, actorUserId, contentId, contentContext)
          return new Response(null, { status: 204 })
        }
        return new Response(null, { status: 405, headers: { Allow: 'GET, POST, DELETE' } })
      }

      const replyAudienceMatch = /^\/internal\/social\/contents\/([^/]+)\/reply-audience$/.exec(url.pathname)
      if (replyAudienceMatch) {
        const contentId = decodePathPart(replyAudienceMatch[1] ?? '')
        if (contentId === null) throw new ReplyAudienceRuntimeError('VALIDATION_FAILED', 400)
        if (request.method !== 'GET' && request.method !== 'PUT') {
          return new Response(null, { status: 405, headers: { Allow: 'GET, PUT' } })
        }
        const actorUserId = requirePrincipal(request)
        requireInteractionLayer(request)
        if (request.method === 'GET') {
          const context = await fetchOwnedPostContext(env.W03_CONTENT, {
            principalUserId: actorUserId,
            principalLayer: request.headers.get('X-LuckRead-Principal-Layer')?.trim() ?? '',
            contentId,
            correlationId: request.headers.get('X-LuckRead-Correlation-Id')?.trim() ?? '',
          })
          return json({
            data: await getContentReplyAudience(env.DB, actorUserId, contentId, context),
            requestId: createRequestId(),
          })
        }

        const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
        if (!idempotencyKey) throw new ReplyAudienceRuntimeError('PRECONDITION_REQUIRED', 428)
        if (idempotencyKey.length > 256) throw new ReplyAudienceRuntimeError('VALIDATION_FAILED', 400)
        let body: unknown
        try { body = await request.json() } catch { throw new ReplyAudienceRuntimeError('VALIDATION_FAILED', 400) }
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          throw new ReplyAudienceRuntimeError('VALIDATION_FAILED', 400)
        }
        const raw = body as Record<string, unknown>
        if (Object.keys(raw).some((key) => key !== 'replyAudience' && key !== 'mentionedUserIds')) {
          throw new ReplyAudienceRuntimeError('VALIDATION_FAILED', 400)
        }
        const context = await fetchOwnedPostContext(env.W03_CONTENT, {
          principalUserId: actorUserId,
          principalLayer: request.headers.get('X-LuckRead-Principal-Layer')?.trim() ?? '',
          contentId,
          correlationId: request.headers.get('X-LuckRead-Correlation-Id')?.trim() ?? '',
        })
        const policy = await setContentReplyAudience(
          env.DB,
          actorUserId,
          contentId,
          raw.replyAudience,
          raw.mentionedUserIds,
          context,
        )
        return json({ data: policy, requestId: createRequestId() })
      }

      const commentContentId = parseCommentPath(url.pathname)
      if (commentContentId !== null) {
        if (request.method === 'GET') {
          requireTransport(request)
          const limit = parseCommentLimit(url.searchParams.get('limit'))
          const cursor = url.searchParams.get('cursor')
          const sortValues = url.searchParams.getAll('sort')
          if (sortValues.length > 1) throw new CommentRuntimeError('VALIDATION_FAILED', 400)
          const sort = parseCommentSort(sortValues[0] ?? null)
          if (cursor && cursor.length > 2048) {
            throw new CommentRuntimeError('INVALID_CURSOR', 400)
          }
          const viewerUserId = request.headers.get('X-LuckRead-Principal-User-Id')?.trim() || null
          const contentContext = await fetchPublishedContentSocialContext(env.W03_CONTENT, {
            contentId: commentContentId,
            correlationId: request.headers.get('X-LuckRead-Correlation-Id')?.trim() ?? '',
          })
          const page = await listComments(env.DB, commentContentId, cursor, limit, contentContext, viewerUserId, sort)
          return json({ data: page, requestId: createRequestId() })
        }

        const viewerUserId = requirePrincipal(request)
        requireInteractionLayer(request)
        if (request.method !== 'POST') {
          return new Response(null, { status: 405, headers: { Allow: 'GET, POST' } })
        }

        const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
        if (!idempotencyKey) throw new CommentRuntimeError('PRECONDITION_REQUIRED', 428)
          if (idempotencyKey.length > 256) throw new CommentRuntimeError('VALIDATION_FAILED', 400)

        let body: unknown
        try { body = await request.json() } catch { throw new CommentRuntimeError('VALIDATION_FAILED', 400) }
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          throw new CommentRuntimeError('VALIDATION_FAILED', 400)
        }

        const bodyValue = (body as { body?: unknown }).body
        const parentId = (body as { parentId?: unknown }).parentId
        const rawMentions = (body as { mentions?: unknown }).mentions
        if (
          typeof bodyValue !== 'string' ||
          (parentId !== undefined && parentId !== null && typeof parentId !== 'string') ||
          (rawMentions !== undefined &&
            (!Array.isArray(rawMentions) ||
              rawMentions.length > 20 ||
              rawMentions.some((value) =>
                !value ||
                typeof value !== 'object' ||
                Array.isArray(value) ||
                typeof (value as { userId?: unknown }).userId !== 'string' ||
                typeof (value as { handle?: unknown }).handle !== 'string'
              )))
        ) {
          throw new CommentRuntimeError('VALIDATION_FAILED', 400)
        }

        const actorVerified = request.headers.get('X-LuckRead-Principal-Verified') === 'true'
        const comment = await createComment(env.DB, viewerUserId, commentContentId, {
          body: bodyValue,
          parentId: parentId ?? null,
          idempotencyKey,
        }, actorVerified)
        const mentionTargets = rawMentions === undefined ? [] : rawMentions as Array<{ userId: string; handle: string }>
        await syncSocialTokens(env.DB, viewerUserId, 'comment', comment.id, bodyValue, mentionTargets)
        const persistedMentions = await getSocialTargets(env.DB, 'comment', comment.id)
        if (parentId) {
          const parent = await env.DB.prepare(
            'SELECT author_user_id FROM social_comments WHERE id = ? AND state = \'PUBLISHED\' LIMIT 1',
          ).bind(parentId).first<{ author_user_id: string | null }>()
          if (parent?.author_user_id) {
            await enqueueNotification(env.DB, {
              recipientUserId: parent.author_user_id,
              actorUserId: viewerUserId,
              type: 'REPLY',
              targetType: 'comment',
              targetId: comment.id,
              payload: { contentId: commentContentId },
            })
          }
        } else {
          const contentOwnerUserId = await getPublishedContentOwnerUserId(
            env.W03_CONTENT,
            commentContentId,
            request.headers.get('X-LuckRead-Correlation-Id')?.trim() ?? '',
          )
          if (contentOwnerUserId) {
            await enqueueNotification(env.DB, {
              recipientUserId: contentOwnerUserId,
              actorUserId: viewerUserId,
              type: 'COMMENT',
              targetType: 'content',
              targetId: commentContentId,
            })
          }
        }
        return json({ data: { ...comment, mentions: persistedMentions.mentions }, requestId: createRequestId() }, 201)
      }


      if (url.pathname === '/internal/social/interactions/bookmarks/list') {
        const viewerUserId = requirePrincipal(request)
        if (request.method !== 'GET') {
          return new Response(null, { status: 405, headers: { Allow: 'GET' } })
        }
        requireInteractionLayer(request)
        const allowed = new Set(['limit', 'cursor'])
        let invalidQuery = false
        url.searchParams.forEach((_value, key) => {
          if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) invalidQuery = true
        })
        if (invalidQuery) throw new FavoriteRuntimeError('VALIDATION_FAILED', 400)
        const rawLimit = url.searchParams.get('limit')
        const limitText = rawLimit?.trim() ?? ''
        if (limitText && !/^(?:[1-9]|[1-4][0-9]|50)$/.test(limitText)) {
          throw new FavoriteRuntimeError('VALIDATION_FAILED', 400)
        }
        const cursor = url.searchParams.get('cursor')
        if (cursor && cursor.length > 2048) throw new FavoriteRuntimeError('INVALID_CURSOR', 400)
        return json({
          data: await listFavorites(env.DB, viewerUserId, cursor, limitText ? Number(limitText) : 20),
          requestId: createRequestId(),
        })
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
          if (!idempotencyKey) throw new FavoriteRuntimeError('PRECONDITION_REQUIRED', 428)
          if (idempotencyKey.length > 256) throw new FavoriteRuntimeError('VALIDATION_FAILED', 400)
        }

        if (request.method === 'GET') {
          return json({
            data: await getFavoriteStatus(env.DB, env.W03_CONTENT, viewerUserId, target, request.headers.get('X-LuckRead-Correlation-Id')?.trim() ?? ''),
            requestId: createRequestId(),
          })
        }

        if (request.method === 'POST') {
          return json({
            data: await favorite(env.DB, env.W03_CONTENT, viewerUserId, target, request.headers.get('X-LuckRead-Correlation-Id')?.trim() ?? ''),
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
          const result = await getLikeStatus(env.DB, env.W03_CONTENT, viewerUserId, target, request.headers.get('X-LuckRead-Correlation-Id')?.trim() ?? '')
          return json({ data: result, requestId: createRequestId() }, 200)
        }

        const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
        if (!idempotencyKey) throw new LikeRuntimeError('PRECONDITION_REQUIRED', 428)
          if (idempotencyKey.length > 256) throw new LikeRuntimeError('VALIDATION_FAILED', 400)

        if (request.method === 'POST') {
          const correlationId = request.headers.get('X-LuckRead-Correlation-Id')?.trim() ?? ''
          const publishedContentContext = target.targetType === 'content'
            ? await fetchPublishedContentSocialContext(env.W03_CONTENT, { contentId: target.targetId, correlationId })
            : undefined
          const result = await like(env.DB, env.W03_CONTENT, viewerUserId, target, correlationId, publishedContentContext)
          const recipientUserId = publishedContentContext
            ? publishedContentContext.ownerUserId
            : await getInteractionRecipient(env.DB, target.targetType, target.targetId, env.W03_CONTENT, correlationId)
          const relatedContent = target.targetType === 'comment'
            ? await env.DB.prepare(
                'SELECT content_id FROM social_comments WHERE id = ? LIMIT 1',
              ).bind(target.targetId).first<{ content_id: string }>()
            : null
          if (recipientUserId) {
            await enqueueNotification(env.DB, {
              recipientUserId,
              actorUserId: viewerUserId,
              type: 'LIKE',
              targetType: target.targetType as 'content' | 'comment',
              targetId: target.targetId,
              payload: relatedContent?.content_id ? { contentId: relatedContent.content_id } : undefined,
            })
          }
          return json({ data: result, requestId: createRequestId() }, 200)
        }
        await unlike(env.DB, viewerUserId, target)
        return new Response(null, { status: 204 })
      }

      if (url.pathname === '/internal/social/feed/following-authors') {
        if (request.method !== 'GET') {
          return new Response(null, { status: 405, headers: { Allow: 'GET' } })
        }
        if (url.search !== '') {
          throw new FollowRuntimeError('VALIDATION_FAILED', 400)
        }
        const viewerUserId = requireFollowingFeedPrincipal(request)
        const candidates = await listFollowingAuthorIds(env.DB, viewerUserId)
        return json({ data: candidates, requestId: createRequestId() })
      }

      const contentLikersMatch = /^\/internal\/social\/content\/([^/]+)\/likes$/.exec(url.pathname)
      if (contentLikersMatch) {
        if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } })
        requireTransport(request)
        const contentId = decodePathPart(contentLikersMatch[1] ?? '')
        if (contentId === null) throw new LikeRuntimeError('VALIDATION_FAILED', 400)
        const limits = url.searchParams.getAll('limit')
        const cursors = url.searchParams.getAll('cursor')
        let hasUnsupportedQueryKey = false
        url.searchParams.forEach((_value, key) => {
          if (key !== 'limit' && key !== 'cursor') hasUnsupportedQueryKey = true
        })
        if (limits.length > 1 || cursors.length > 1 || hasUnsupportedQueryKey) {
          throw new LikeRuntimeError('VALIDATION_FAILED', 400)
        }
        const limit = parseCommentLimit(limits[0] ?? null)
        const cursor = cursors[0] ?? null
        if (cursors.length && (!cursor?.trim() || cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(cursor))) {
          throw new LikeRuntimeError('INVALID_CURSOR', 400)
        }
        const viewerUserId = request.headers.get('X-LuckRead-Principal-User-Id')?.trim() || null
        const contentContext = await fetchPublishedContentSocialContext(env.W03_CONTENT, {
          contentId,
          correlationId: request.headers.get('X-LuckRead-Correlation-Id')?.trim() ?? '',
        })
        const data = await listContentLikers(env.DB, contentId, cursor, limit, viewerUserId, contentContext)
        return json({ data, requestId: createRequestId() })
      }

      const profileChannel = parseProfileChannelPath(url.pathname)
      if (profileChannel) {
        if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } })
        requireTransport(request)
        const limit = parseCommentLimit(url.searchParams.get('limit'))
        const cursor = url.searchParams.get('cursor')
        if (cursor && cursor.length > 2048) throw new ProfileChannelRuntimeError('INVALID_CURSOR', 400)
        const viewerUserId = request.headers.get('X-LuckRead-Principal-User-Id')?.trim() || null
        const data = profileChannel.kind === 'replies'
          ? await listProfileReplies(env.DB, env.W03_CONTENT, profileChannel.userId, cursor, limit, viewerUserId, request.headers.get('X-LuckRead-Correlation-Id')?.trim() ?? '')
          : await listProfileLikedContents(env.DB, env.W03_CONTENT, profileChannel.userId, cursor, limit, viewerUserId, request.headers.get('X-LuckRead-Correlation-Id')?.trim() ?? '')
        return json({ data, requestId: createRequestId() })
      }

      const path = parseFollowPath(url.pathname)
      if (!path) throw new FollowRuntimeError('NOT_FOUND', 404)

      if (path.kind === 'follow') {
        const viewerUserId = requirePrincipal(request)
        if (request.method === 'POST') {
          requireInteractionLayer(request)
          const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
          if (!idempotencyKey) throw new FollowRuntimeError('PRECONDITION_REQUIRED', 428)
          if (idempotencyKey.length > 256) throw new FollowRuntimeError('VALIDATION_FAILED', 400)
          const row = await follow(env.DB, viewerUserId, path.userId)
          await invalidateRelationshipGraph(viewerUserId, path.userId)
          await enqueueNotification(env.DB, {
            recipientUserId: path.userId,
            actorUserId: viewerUserId,
            type: 'FOLLOW',
            targetType: 'user',
            targetId: path.userId,
          })
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
          if (!idempotencyKey) throw new FollowRuntimeError('PRECONDITION_REQUIRED', 428)
          if (idempotencyKey.length > 256) throw new FollowRuntimeError('VALIDATION_FAILED', 400)
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
        error instanceof SocialPollError ||
        error instanceof FollowRuntimeError ||
        error instanceof LikeRuntimeError ||
        error instanceof CommentRuntimeError ||
        error instanceof FavoriteRuntimeError ||
        error instanceof ShareRuntimeError ||
        error instanceof RepostRuntimeError ||
        error instanceof ProfilePinRuntimeError ||
        error instanceof BlockMuteRuntimeError ||
        error instanceof RelationshipGraphRuntimeError ||
        error instanceof SocialClosureRuntimeError ||
        error instanceof ProfileChannelRuntimeError ||
        error instanceof ReplyAudienceRuntimeError
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
