import {
  callW05Social,
  resolveCookieSocialPrincipal,
  resolveSocialMentionTargets,
  W05SocialClientError,
} from '../../../../../../social/w05-social-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
    {
      status: code === 'VALIDATION_FAILED' && status === 400 ? 422 : status,
      headers: { 'cache-control': 'no-store' },
    },
  )

const validContentId = (value: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)

export async function GET(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
): Promise<Response> {
  try {
    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal

    const { contentId } = await context.params
    if (!validContentId(contentId)) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid content id')

    return await callW05Social({
      request,
      pathname: '/internal/social/contents/' + encodeURIComponent(contentId) + '/reply-audience',
      method: 'GET',
      principal,
    })
  } catch (error) {
    if (error instanceof W05SocialClientError) {
      return errorResponse(error.status, error.code, error.message)
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Social service unavailable')
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
): Promise<Response> {
  try {
    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal

    const { contentId } = await context.params
    if (!validContentId(contentId)) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid content id')

    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
    if (!idempotencyKey) {
      return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key required')
    }
    if (idempotencyKey.length > 256) {
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid Idempotency-Key header')
    }

    let value: unknown
    try {
      const raw = await request.text()
      if (raw.length > 32768) return errorResponse(422, 'VALIDATION_FAILED', 'Reply audience request is too large')
      value = JSON.parse(raw)
    } catch {
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid reply audience request')
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid reply audience request')
    }
    const candidate = value as { replyAudience?: unknown; text?: unknown }
    if (
      typeof candidate.replyAudience !== 'string' ||
      !['everyone', 'verified', 'following', 'mentioned', 'followingNetwork'].includes(candidate.replyAudience) ||
      typeof candidate.text !== 'string' ||
      candidate.text.length > 10000
    ) {
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid reply audience request')
    }

    // Mention targets are resolved server-side from the post text; clients never
    // choose the IDs that receive permission to reply.
    const mentionTargets = await resolveSocialMentionTargets(candidate.text)

    return await callW05Social({
      request,
      pathname: '/internal/social/contents/' + encodeURIComponent(contentId) + '/reply-audience',
      method: 'PUT',
      principal,
      body: {
        replyAudience: candidate.replyAudience,
        mentionedUserIds: mentionTargets.map((target) => target.userId),
      },
    })
  } catch (error) {
    if (error instanceof W05SocialClientError) {
      return errorResponse(error.status, error.code, error.message)
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Social service unavailable')
  }
}
