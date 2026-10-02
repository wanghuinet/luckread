import {
  callW05Social,
  resolveCookieSocialPrincipal,
  W05SocialClientError,
} from '../../../../../social/w05-social-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
  )

export async function PATCH(
  request: Request,
  context: { params: Promise<{ commentId: string }> },
): Promise<Response> {
  try {
    const { commentId } = await context.params
    if (!commentId?.trim()) return errorResponse(400, 'VALIDATION_FAILED', 'Invalid comment id')

    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal

    const ifMatch = request.headers.get('If-Match')?.trim() ?? ''
    if (!ifMatch || ifMatch.length > 256) {
      return errorResponse(428, 'PRECONDITION_REQUIRED', 'If-Match required')
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return errorResponse(400, 'VALIDATION_FAILED', 'Invalid JSON body')
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return errorResponse(400, 'VALIDATION_FAILED', 'Invalid request body')
    }

    const bodyValue = (body as { body?: unknown }).body
    if (typeof bodyValue !== 'string') {
      return errorResponse(400, 'VALIDATION_FAILED', 'Comment body is required')
    }

    return await callW05Social({
      request,
      pathname: '/internal/social/comments/' + encodeURIComponent(commentId),
      method: 'PATCH',
      principal,
      body: { body: bodyValue },
    })
  } catch (error) {
    if (error instanceof W05SocialClientError) {
      return errorResponse(error.status, error.code, error.message)
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Social service unavailable')
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ commentId: string }> },
): Promise<Response> {
  try {
    const { commentId } = await context.params
    if (!commentId?.trim()) return errorResponse(400, 'VALIDATION_FAILED', 'Invalid comment id')

    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal

    return await callW05Social({
      request,
      pathname: '/internal/social/comments/' + encodeURIComponent(commentId),
      method: 'DELETE',
      principal,
    })
  } catch (error) {
    if (error instanceof W05SocialClientError) {
      return errorResponse(error.status, error.code, error.message)
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Social service unavailable')
  }
}
