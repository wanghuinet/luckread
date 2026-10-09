import {
  callW03Content,
  resolveCookieContentPrincipal,
  W03ContentClientError,
} from '@/content/w03-content-client.js'
import {
  invalidatePublicContentComments,
  invalidatePublicContentDetail,
  invalidatePublicContentList,
  invalidatePublicContentVisibility,
} from '@/lib/public-response-cache.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
    { status, headers: { 'cache-control': 'no-store' } },
  )

const requireMutationHeaders = (request: Request): Response | null => {
  const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
  const ifMatch = request.headers.get('If-Match')?.trim() ?? ''
  if (!idempotencyKey || idempotencyKey.length > 256) return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key required')
  if (!ifMatch || ifMatch.length > 256) return errorResponse(428, 'PRECONDITION_REQUIRED', 'If-Match required')
  if (ifMatch === '*') return errorResponse(412, 'PRECONDITION_FAILED', 'If-Match precondition failed')
  return null
}

export async function POST(
  request: Request,
  context: { params: Promise<{ contentId: string; revisionId: string }> },
): Promise<Response> {
  try {
    const principal = await resolveCookieContentPrincipal(request)
    if (principal instanceof Response) return principal
    const { contentId, revisionId } = await context.params
    const mutationError = requireMutationHeaders(request)
    if (mutationError) return mutationError
    const response = await callW03Content({
      request,
      pathname: '/internal/content/contents/' + encodeURIComponent(contentId) + '/revisions/' + encodeURIComponent(revisionId) + '/rollback',
      method: 'POST',
      body: await request.json(),
      principal,
    })
    if (response.ok) {
      await invalidatePublicContentComments(contentId)
      await invalidatePublicContentVisibility(contentId)
      await invalidatePublicContentDetail(request, contentId)
      await invalidatePublicContentList(request)
    }
    return response
  } catch (error) {
    if (error instanceof SyntaxError) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid revision rollback request')
    if (error instanceof W03ContentClientError) return errorResponse(error.status, error.code, 'Content revision service unavailable')
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Content revision service unavailable')
  }
}
