import {
  cachedPublicGet,
  invalidatePublicContentThreads,
} from '../../../../../../lib/public-response-cache.js'
import { TrafficLimitError, enforcePublicReadRateLimit, rateLimitResponse } from '../../../../../../auth/traffic-limit.js'
import { hasAuthenticatedSessionCredential } from '../../../../../../lib/content-list-cache-guard.js'
import {
  callW03Content,
  resolveCookieContentPrincipal,
  W03ContentClientError,
} from '../../../../../../content/w03-content-client.js'

const errorResponse = (status: number, code: string, message: string) => Response.json(
  { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
  { status, headers: { 'cache-control': 'no-store' } },
)

const threadPath = (contentId: string) =>
  '/internal/content/contents/' + encodeURIComponent(contentId) + '/thread'

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
    await enforcePublicReadRateLimit(request)
    if (hasAuthenticatedSessionCredential(request)) {
      const principal = await resolveCookieContentPrincipal(request)
      if (principal instanceof Response) return principal
      return await callW03Content({
        request,
        pathname: threadPath(contentId),
        method: 'GET',
        principal,
      })
    }
    return await cachedPublicGet(
      request,
      'content-threads',
      () => callW03Content({
        request,
        pathname: threadPath(contentId),
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

    let body: unknown
    try { body = await request.json() } catch {
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid thread request')
    }
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        typeof (body as { nextContentId?: unknown }).nextContentId !== 'string') {
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid thread request')
    }
    const nextContentId = (body as { nextContentId: string }).nextContentId.trim()
    const response = await callW03Content({
      request,
      pathname: threadPath(contentId),
      method: 'POST',
      body: { nextContentId },
      principal,
    })
    if (response.ok) await invalidatePublicContentThreads()
    return response
  } catch (error) {
    if (error instanceof W03ContentClientError) return errorResponse(error.status, error.code, 'Content service unavailable')
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Content service unavailable')
  }
}
