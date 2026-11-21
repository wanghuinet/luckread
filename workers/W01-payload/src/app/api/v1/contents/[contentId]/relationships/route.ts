import {
  cachedPublicGet,
  invalidatePublicContentRelationships,
} from '../../../../../../lib/public-response-cache.js'
import { TrafficLimitError, enforcePublicReadRateLimit, rateLimitResponse } from '../../../../../../auth/traffic-limit.js'
import { hasAuthenticatedSessionCredential } from '../../../../../../lib/content-list-cache-guard.js'
import {
  callW03Content,
  resolveCookieContentPrincipal,
  W03ContentClientError,
} from '../../../../../../content/w03-content-client.js'
import { callW05Social, W05SocialClientError } from '../../../../../../social/w05-social-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
    { status, headers: { 'cache-control': 'no-store' } },
  )

const relationshipPath = (contentId: string) =>
  '/internal/content/contents/' + encodeURIComponent(contentId) + '/relationships'

const requireIdempotency = (request: Request): Response | null => {
  const value = request.headers.get('Idempotency-Key')?.trim() ?? ''
  if (!value) return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key required')
  if (value.length > 256) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid Idempotency-Key header')
  return null
}

export async function GET(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
): Promise<Response> {
  try {
    const { contentId } = await context.params
    const url = new URL(request.url)
    if (url.searchParams.has('direction')) {
      const direction = url.searchParams.get('direction')?.trim() ?? ''
      if (!['out', 'in', 'both'].includes(direction)) {
        return errorResponse(422, 'VALIDATION_FAILED', 'Invalid relationship direction')
      }
    }
    const cursor = url.searchParams.get('cursor')
    if (cursor && cursor.length > 2048) {
      return errorResponse(400, 'INVALID_CURSOR', 'Invalid cursor')
    }

    await enforcePublicReadRateLimit(request)
    if (hasAuthenticatedSessionCredential(request)) {
      return await callW03Content({
        request,
        pathname: relationshipPath(contentId) + (url.search ? url.search : ''),
        method: 'GET',
      })
    }
    return await cachedPublicGet(
      request,
      'content-relationships',
      () => callW03Content({
        request,
        pathname: relationshipPath(contentId) + (url.search ? url.search : ''),
        method: 'GET',
      }),
      30,
    )
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    if (error instanceof W03ContentClientError) return errorResponse(error.status, error.code, 'Content service unavailable')
    if (error instanceof W05SocialClientError) return errorResponse(error.status, error.code, 'Social service unavailable')
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Content service unavailable')
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
): Promise<Response> {
  try {
    const { contentId } = await context.params
    const principal = await resolveCookieContentPrincipal(request)
    if (principal instanceof Response) return principal
    const mutationError = requireIdempotency(request)
    if (mutationError) return mutationError

    const body = await request.json()
    if (
      body && typeof body === 'object' && !Array.isArray(body) &&
      (body as { relationType?: unknown }).relationType === 'quote-post'
    ) {
      const targetContentId = (body as { targetContentId?: unknown }).targetContentId
      if (typeof targetContentId !== 'string' || !targetContentId.trim()) {
        return errorResponse(422, 'VALIDATION_FAILED', 'Invalid quote target')
      }
      const blockPreflight = await callW05Social({
        request,
        pathname: '/internal/social/content/' + encodeURIComponent(targetContentId.trim()) + '/quote-post-preflight',
        method: 'POST',
        principal,
        body: {},
      })
      if (!blockPreflight.ok) return blockPreflight
    }
    const response = await callW03Content({
      request,
      pathname: relationshipPath(contentId),
      method: 'POST',
      body,
      principal,
    })
    if (response.ok) {
      await invalidatePublicContentRelationships(contentId)
    }
    return response
  } catch (error) {
    if (error instanceof SyntaxError) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid relationship request')
    if (error instanceof W03ContentClientError) return errorResponse(error.status, error.code, 'Content service unavailable')
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Content service unavailable')
  }
}
