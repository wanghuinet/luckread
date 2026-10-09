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

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
    { status, headers: { 'cache-control': 'no-store' } },
  )

const relationshipPath = (contentId: string) =>
  '/internal/content/contents/' + encodeURIComponent(contentId) + '/relationships'

const requireIdempotency = (request: Request): Response | null => {
  const value = request.headers.get('Idempotency-Key')?.trim() ?? ''
  if (!value || value.length > 256) {
    return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key required')
  }
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
