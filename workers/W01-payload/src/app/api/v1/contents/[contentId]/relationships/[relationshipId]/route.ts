import {
  invalidatePublicContentRelationships,
} from '../../../../../../../lib/public-response-cache.js'
import {
  callW03Content,
  resolveCookieContentPrincipal,
  W03ContentClientError,
} from '../../../../../../../content/w03-content-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
  )

const requireIdempotency = (request: Request): Response | null => {
  const value = request.headers.get('Idempotency-Key')?.trim() ?? ''
  if (!value || value.length > 256) {
    return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key required')
  }
  return null
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ contentId: string; relationshipId: string }> },
): Promise<Response> {
  try {
    const { contentId, relationshipId } = await context.params
    const principal = await resolveCookieContentPrincipal(request)
    if (principal instanceof Response) return principal
    const mutationError = requireIdempotency(request)
    if (mutationError) return mutationError

    const response = await callW03Content({
      request,
      pathname: '/internal/content/contents/' + encodeURIComponent(contentId) +
        '/relationships/' + encodeURIComponent(relationshipId),
      method: 'DELETE',
      principal,
    })
    if (response.ok) {
      await invalidatePublicContentRelationships(request, contentId)
    }
    return response
  } catch (error) {
    if (error instanceof W03ContentClientError) return errorResponse(error.status, error.code, 'Content service unavailable')
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Content service unavailable')
  }
}
