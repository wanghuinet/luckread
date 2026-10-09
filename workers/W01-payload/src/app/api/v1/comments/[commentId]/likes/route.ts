import {
  callW05Social,
  resolveCookieSocialPrincipal,
  W05SocialClientError,
} from '../../../../../../social/w05-social-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
    { status, headers: { 'cache-control': 'no-store' } },
  )

const resolveCommentId = async (
  context: { params: Promise<{ commentId: string }> },
): Promise<string> => {
  const { commentId } = await context.params
  if (!commentId.trim()) {
    throw new W05SocialClientError(400, 'VALIDATION_FAILED', 'Invalid comment id')
  }
  return commentId
}

const requireIdempotencyKey = (request: Request): string | Response => {
  const key = request.headers.get('Idempotency-Key')?.trim() ?? ''
  if (!key || key.length > 256) {
    return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key required')
  }
  return key
}

async function forward(
  request: Request,
  context: { params: Promise<{ commentId: string }> },
  method: 'POST' | 'DELETE',
): Promise<Response> {
  try {
    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal

    const commentId = await resolveCommentId(context)
    const idempotencyKey = requireIdempotencyKey(request)
    if (idempotencyKey instanceof Response) return idempotencyKey

    return await callW05Social({
      request,
      pathname: '/internal/social/interactions/likes',
      method,
      principal,
      body: { targetType: 'comment', targetId: commentId },
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
  context: { params: Promise<{ commentId: string }> },
): Promise<Response> {
  return forward(request, context, 'POST')
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ commentId: string }> },
): Promise<Response> {
  return forward(request, context, 'DELETE')
}
