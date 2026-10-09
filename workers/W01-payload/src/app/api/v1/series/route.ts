import { callW03Content, resolveContentPrincipal, W03ContentClientError } from '../../../../content/w03-content-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` }, {
    status,
    headers: { 'cache-control': 'no-store' },
  })

const requireIdempotency = (request: Request): Response | null => {
  const value = request.headers.get('Idempotency-Key')?.trim() ?? ''
  if (!value || value.length > 256) {
    return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key required')
  }
  return null
}

export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await resolveContentPrincipal(request)
    if (principal instanceof Response) return principal
    const url = new URL(request.url)
    const cursor = url.searchParams.get('cursor')
    if (cursor && cursor.length > 2048) {
      return errorResponse(400, 'VALIDATION_FAILED', 'Invalid cursor')
    }
    const limit = url.searchParams.get('limit')
    if (limit && !/^(?:[1-9]|[1-4][0-9]|50)$/.test(limit.trim())) {
      return errorResponse(400, 'VALIDATION_FAILED', 'Invalid limit')
    }
    return await callW03Content({
      request,
      pathname: '/internal/content/series' + (url.search ? url.search : ''),
      method: 'GET',
      principal,
    })
  } catch (error) {
    if (error instanceof W03ContentClientError) return errorResponse(error.status, error.code, 'Content service unavailable')
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Content service unavailable')
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const principal = await resolveContentPrincipal(request)
    if (principal instanceof Response) return principal
    const mutationError = requireIdempotency(request)
    if (mutationError) return mutationError
    return await callW03Content({
      request,
      pathname: '/internal/content/series',
      method: 'POST',
      body: await request.json(),
      principal,
    })
  } catch (error) {
    if (error instanceof SyntaxError) return errorResponse(400, 'VALIDATION_FAILED', 'Invalid series request')
    if (error instanceof W03ContentClientError) return errorResponse(error.status, error.code, 'Content service unavailable')
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Content service unavailable')
  }
}
