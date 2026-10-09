import {
  invalidatePublicContentComments,
  invalidatePublicContentDetail,
  invalidatePublicContentList,
  invalidatePublicContentVisibility,
  invalidatePublicContentRelationships,
} from '../../../../../../../lib/public-response-cache.js'

import {
  callW03Content,
  resolveCookieContentPrincipal,
  W03ContentClientError,
} from '../../../../../../../content/w03-content-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
    { status, headers: { 'cache-control': 'no-store' } },
  )

const requireStatePreconditions = (request: Request): Response | null => {
  const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
  const ifMatch = request.headers.get('If-Match')?.trim() ?? ''
  if (!idempotencyKey) return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key required')
  if (idempotencyKey.length > 256) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid Idempotency-Key header')
  if (!ifMatch) return errorResponse(428, 'PRECONDITION_REQUIRED', 'If-Match required')
  if (ifMatch.length > 256) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid If-Match header')
  if (ifMatch === '*') {
    return errorResponse(412, 'PRECONDITION_FAILED', 'If-Match precondition failed')
  }
  return null
}

export async function POST(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
): Promise<Response> {
  try {
    const { contentId } = await context.params
    const principal = await resolveCookieContentPrincipal(request)
    if (principal instanceof Response) return principal

    const preconditionError = requireStatePreconditions(request)
    if (preconditionError) return preconditionError

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid content state request')
    }

    const response = await callW03Content({
      request,
      pathname: `/internal/content/contents/${encodeURIComponent(contentId)}/state`,
      method: 'POST',
      body,
      principal,
    })

    if (response.ok) {
      await invalidatePublicContentComments(contentId)
      await invalidatePublicContentVisibility(contentId)
      await invalidatePublicContentRelationships(contentId)
      await invalidatePublicContentDetail(request, contentId)
      await invalidatePublicContentList(request)
    }

    return response
  } catch (error) {
    if (error instanceof W03ContentClientError) {
      return errorResponse(error.status, error.code, 'Content service unavailable')
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Content service unavailable')
  }
}
