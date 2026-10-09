import { callW03Content, resolveContentPrincipal, W03ContentClientError } from '../../../../../../../content/w03-content-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` }, {
    status,
    headers: { 'cache-control': 'no-store' },
  })

const requireMutationHeaders = (request: Request): Response | null => {
  const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
  const ifMatch = request.headers.get('If-Match')?.trim() ?? ''
  if (!idempotencyKey || idempotencyKey.length > 256) {
    return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key required')
  }
  if (!ifMatch) return errorResponse(428, 'PRECONDITION_REQUIRED', 'If-Match required')
  if (ifMatch === '*') return errorResponse(412, 'PRECONDITION_FAILED', 'If-Match precondition failed')
  if (ifMatch.length > 256) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid If-Match header')
  return null
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ seriesId: string; contentId: string }> },
): Promise<Response> {
  try {
    const { seriesId, contentId } = await context.params
    const principal = await resolveContentPrincipal(request)
    if (principal instanceof Response) return principal
    const mutationError = requireMutationHeaders(request)
    if (mutationError) return mutationError
    return await callW03Content({
      request,
      pathname: '/internal/content/series/' + encodeURIComponent(seriesId) + '/members/' + encodeURIComponent(contentId),
      method: 'PATCH',
      body: await request.json(),
      principal,
    })
  } catch (error) {
    if (error instanceof SyntaxError) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid series ordering request')
    if (error instanceof W03ContentClientError) return errorResponse(error.status, error.code, 'Content service unavailable')
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Content service unavailable')
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ seriesId: string; contentId: string }> },
): Promise<Response> {
  try {
    const { seriesId, contentId } = await context.params
    const principal = await resolveContentPrincipal(request)
    if (principal instanceof Response) return principal
    const mutationError = requireMutationHeaders(request)
    if (mutationError) return mutationError
    return await callW03Content({
      request,
      pathname: '/internal/content/series/' + encodeURIComponent(seriesId) + '/members/' + encodeURIComponent(contentId),
      method: 'DELETE',
      principal,
    })
  } catch (error) {
    if (error instanceof W03ContentClientError) return errorResponse(error.status, error.code, 'Content service unavailable')
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Content service unavailable')
  }
}
