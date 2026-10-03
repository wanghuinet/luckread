import {
  callW05Social,
  callW05SocialPublic,
  resolveCookieSocialPrincipal,
  resolveOptionalCookieSocialPrincipal,
  W05SocialClientError,
} from '../../../../../../social/w05-social-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
  )

const resolveContentId = async (
  context: { params: Promise<{ contentId: string }> },
): Promise<string> => {
  const { contentId } = await context.params
  if (!contentId.trim()) throw new W05SocialClientError(400, 'VALIDATION_FAILED', 'Invalid content id')
  return contentId
}

export async function GET(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
): Promise<Response> {
  try {
    const contentId = await resolveContentId(context)
    const url = new URL(request.url)
    const query = new URLSearchParams()
    const cursor = url.searchParams.get('cursor')
    const limit = url.searchParams.get('limit')
    if (cursor) query.set('cursor', cursor)
    if (limit) query.set('limit', limit)
    const suffix = query.toString() ? '?' + query.toString() : ''

    const viewer = await resolveOptionalCookieSocialPrincipal(request)
    if (viewer instanceof Response) return viewer

    return await callW05SocialPublic({
      request,
      pathname: '/internal/social/contents/' + encodeURIComponent(contentId) + '/comments' + suffix,
      method: 'GET',
      principal: viewer,
    })
  } catch (error) {
    if (error instanceof W05SocialClientError) {
      return errorResponse(error.status, error.code, error.message)
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Social service unavailable')
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
): Promise<Response> {
  try {
    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal

    const contentId = await resolveContentId(context)
    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
    if (!idempotencyKey || idempotencyKey.length > 256) {
      return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key required')
    }

    let value: unknown
    try {
      value = await request.json()
    } catch {
      return errorResponse(400, 'VALIDATION_FAILED', 'Invalid comment request')
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return errorResponse(400, 'VALIDATION_FAILED', 'Invalid comment request')
    }

    const body = (value as { body?: unknown }).body
    const parentId = (value as { parentId?: unknown }).parentId
    if (
      typeof body !== 'string' ||
      (parentId !== undefined && parentId !== null && typeof parentId !== 'string')
    ) {
      return errorResponse(400, 'VALIDATION_FAILED', 'Invalid comment request')
    }

    return await callW05Social({
      request,
      pathname: '/internal/social/contents/' + encodeURIComponent(contentId) + '/comments',
      method: 'POST',
      principal,
      body: { body, parentId: parentId ?? null },
    })
  } catch (error) {
    if (error instanceof W05SocialClientError) {
      return errorResponse(error.status, error.code, error.message)
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Social service unavailable')
  }
}
