import {
  cachedPublicGet,
  invalidatePublicContentDetail,
  invalidatePublicContentList,
} from '../../../../../lib/public-response-cache.js'
import { TrafficLimitError, enforcePublicReadRateLimit, rateLimitResponse } from '../../../../../auth/traffic-limit.js'

import {
  callW03Content,
  resolveContentPrincipal,
  resolveOptionalCookieContentPrincipal,
  W03ContentClientError,
} from '../../../../../content/w03-content-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} }, requestId: crypto.randomUUID() }, { status })

const contentPath = (contentId: string) =>
  `/internal/content/contents/${encodeURIComponent(contentId)}`

const requireMutationHeaders = (request: Request): Response | null => {
  const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
  const ifMatch = request.headers.get('If-Match')?.trim() ?? ''

  if (!idempotencyKey || idempotencyKey.length > 256) {
    return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key required')
  }
  if (!ifMatch || ifMatch.length > 256) {
    return errorResponse(428, 'PRECONDITION_REQUIRED', 'If-Match required')
  }
  if (ifMatch === '*') {
    return errorResponse(412, 'PRECONDITION_FAILED', 'If-Match precondition failed')
  }
  return null
}

export async function GET(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
): Promise<Response> {
  try {
    await enforcePublicReadRateLimit(request)
    const { contentId } = await context.params
    const principal = await resolveOptionalCookieContentPrincipal(request)
    if (principal instanceof Response) return principal
    if (!principal) {
      return await cachedPublicGet(
        request,
        'content-detail',
        () => callW03Content({
          request,
          pathname: contentPath(contentId),
          method: 'GET',
        }),
        30,
      )
    }

    return await callW03Content({
      request,
      pathname: contentPath(contentId),
      method: 'GET',
      principal: principal ?? undefined,
    })
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    if (error instanceof W03ContentClientError) return errorResponse(error.status, error.code, 'Content service unavailable')
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Content service unavailable')
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
): Promise<Response> {
  try {
    const { contentId } = await context.params
    const principal = await resolveContentPrincipal(request)
    if (principal instanceof Response) return principal
    const mutationError = requireMutationHeaders(request)
    if (mutationError) return mutationError
    const response = await callW03Content({
      request,
      pathname: contentPath(contentId),
      method: 'PATCH',
      body: await request.json(),
      principal,
    })
    if (response.ok) {
      await invalidatePublicContentDetail(request, contentId)
      await invalidatePublicContentList(request)
    }
    return response
  } catch (error) {
    if (error instanceof SyntaxError) return errorResponse(400, 'VALIDATION_FAILED', 'Invalid content request')
    if (error instanceof W03ContentClientError) return errorResponse(error.status, error.code, 'Content service unavailable')
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Content service unavailable')
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
): Promise<Response> {
  try {
    const { contentId } = await context.params
    const principal = await resolveContentPrincipal(request)
    if (principal instanceof Response) return principal
    const mutationError = requireMutationHeaders(request)
    if (mutationError) return mutationError
    const response = await callW03Content({
      request,
      pathname: contentPath(contentId),
      method: 'DELETE',
      principal,
    })
    if (response.ok) {
      await invalidatePublicContentDetail(request, contentId)
      await invalidatePublicContentList(request)
    }
    return response
  } catch (error) {
    if (error instanceof W03ContentClientError) return errorResponse(error.status, error.code, 'Content service unavailable')
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Content service unavailable')
  }
}
