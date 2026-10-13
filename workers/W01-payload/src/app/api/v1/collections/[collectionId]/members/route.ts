import { callW03Content, resolveContentPrincipal, W03ContentClientError } from '../../../../../../content/w03-content-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` }, {
    status,
    headers: { 'cache-control': 'no-store' },
  })

const requireMutationHeaders = (request: Request): Response | null => {
  const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
  const ifMatch = request.headers.get('If-Match')?.trim() ?? ''
  if (!idempotencyKey) return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key required')
  if (idempotencyKey.length > 256) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid Idempotency-Key header')
  if (!ifMatch) return errorResponse(428, 'PRECONDITION_REQUIRED', 'If-Match required')
  if (ifMatch === '*') return errorResponse(412, 'PRECONDITION_FAILED', 'If-Match precondition failed')
  if (ifMatch.length > 256) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid If-Match header')
  return null
}

export async function GET(
  request: Request,
  context: { params: Promise<{ collectionId: string }> },
): Promise<Response> {
  try {
    const { collectionId } = await context.params
    const principal = await resolveContentPrincipal(request)
    if (principal instanceof Response) return principal
    const url = new URL(request.url)
    const cursor = url.searchParams.get('cursor')
    if (cursor && cursor.length > 2048) {
      return errorResponse(400, 'INVALID_CURSOR', 'Invalid cursor')
    }
    return await callW03Content({
      request,
      pathname: '/internal/content/collections/' + encodeURIComponent(collectionId) + '/members' + (url.search ? url.search : ''),
      method: 'GET',
      principal,
    })
  } catch (error) {
    if (error instanceof W03ContentClientError) return errorResponse(error.status, error.code, 'Content service unavailable')
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Content service unavailable')
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ collectionId: string }> },
): Promise<Response> {
  try {
    const { collectionId } = await context.params
    const principal = await resolveContentPrincipal(request)
    if (principal instanceof Response) return principal
    const mutationError = requireMutationHeaders(request)
    if (mutationError) return mutationError
    return await callW03Content({
      request,
      pathname: '/internal/content/collections/' + encodeURIComponent(collectionId) + '/members',
      method: 'POST',
      body: await request.json(),
      principal,
    })
  } catch (error) {
    if (error instanceof SyntaxError) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid collection member request')
    if (error instanceof W03ContentClientError) return errorResponse(error.status, error.code, 'Content service unavailable')
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Content service unavailable')
  }
}
