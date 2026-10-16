import {
  callW03Content,
  resolveContentPrincipal,
  resolveOptionalCookieContentPrincipal,
  W03ContentClientError,
} from '../../../../../../content/w03-content-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: 'req_' + crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
  )

const pollPath = (contentId: string) =>
  '/internal/content/contents/' + encodeURIComponent(contentId) + '/poll'

export async function GET(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
): Promise<Response> {
  try {
    const { contentId } = await context.params
    const principal = await resolveOptionalCookieContentPrincipal(request)
    if (principal instanceof Response) return principal
    return await callW03Content({
      request,
      pathname: pollPath(contentId),
      method: 'GET',
      principal,
    })
  } catch (error) {
    if (error instanceof W03ContentClientError) {
      return errorResponse(error.status, error.code, 'Poll service unavailable')
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Poll service unavailable')
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
): Promise<Response> {
  try {
    const { contentId } = await context.params
    const principal = await resolveContentPrincipal(request)
    if (principal instanceof Response) return principal
    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
    if (!idempotencyKey) return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key required')
    if (idempotencyKey.length > 256) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid Idempotency-Key header')
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid poll vote request')
    }
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      !Number.isSafeInteger((body as { optionIndex?: unknown }).optionIndex)
    ) {
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid poll vote request')
    }
    return await callW03Content({
      request,
      pathname: pollPath(contentId),
      method: 'POST',
      body,
      principal,
    })
  } catch (error) {
    if (error instanceof W03ContentClientError) {
      return errorResponse(error.status, error.code, 'Poll service unavailable')
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Poll service unavailable')
  }
}
