import {
  callW05Social,
  resolveCookieSocialPrincipal,
  W05SocialClientError,
} from '../../../../../social/w05-social-client.js'
import { invalidatePublicContentComments } from '../../../../../lib/public-response-cache.js'

const finalizeCommentMutationResponse = async (response: Response): Promise<Response> => {
  const contentId = response.headers.get('X-LuckRead-Content-Id')?.trim() ?? ''
  if (response.ok && contentId) {
    await invalidatePublicContentComments(contentId)
  }
  if (!contentId) return response

  const headers = new Headers(response.headers)
  headers.delete('X-LuckRead-Content-Id')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
    { status: code === 'VALIDATION_FAILED' && status === 400 ? 422 : status, headers: { 'cache-control': 'no-store' } },
  )

export async function PATCH(
  request: Request,
  context: { params: Promise<{ commentId: string }> },
): Promise<Response> {
  try {
    const { commentId } = await context.params
    if (!commentId?.trim()) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid comment id')

    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal

    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
    if (!idempotencyKey || idempotencyKey.length > 256) {
      return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key required')
    }

    const ifMatch = request.headers.get('If-Match')?.trim() ?? ''
    if (!ifMatch || ifMatch.length > 256) {
      return errorResponse(428, 'PRECONDITION_REQUIRED', 'If-Match required')
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid JSON body')
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid request body')
    }

    const bodyValue = (body as { body?: unknown }).body
    if (typeof bodyValue !== 'string') {
      return errorResponse(422, 'VALIDATION_FAILED', 'Comment body is required')
    }

    return await finalizeCommentMutationResponse(await callW05Social({
      request,
      pathname: '/internal/social/comments/' + encodeURIComponent(commentId),
      method: 'PATCH',
      principal,
      body: { body: bodyValue },
    }))
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
    if (!commentId?.trim()) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid comment id')

    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal

    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
    if (!idempotencyKey || idempotencyKey.length > 256) {
      return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key required')
    }

    return await finalizeCommentMutationResponse(await callW05Social({
      request,
      pathname: '/internal/social/comments/' + encodeURIComponent(commentId),
      method: 'DELETE',
      principal,
    }))
  } catch (error) {
    if (error instanceof W05SocialClientError) {
      return errorResponse(error.status, error.code, error.message)
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Social service unavailable')
  }
}
