import {
  assertSocialTargetUserExists,
  callW05Social,
  resolveCookieSocialPrincipal,
  W05SocialClientError,
} from '../../../../../social/w05-social-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
    { status: code === 'VALIDATION_FAILED' && status === 400 ? 422 : status, headers: { 'cache-control': 'no-store' } },
  )

export async function POST(request: Request): Promise<Response> {
  try {
    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal
    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
    if (!idempotencyKey) return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key is required')
    if (idempotencyKey.length > 256) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid Idempotency-Key header')
    let body: unknown
    try { body = await request.json() } catch {
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid request body')
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid request body')
    }
    const targetUserId = (body as { targetUserId?: unknown }).targetUserId
    if (typeof targetUserId !== 'string' || !targetUserId.trim()) {
      return errorResponse(422, 'VALIDATION_FAILED', 'targetUserId is required')
    }
    await assertSocialTargetUserExists(targetUserId)
    return await callW05Social({
      request,
      pathname: '/internal/social/interactions/mutes',
      method: 'POST',
      principal,
      body: { targetUserId },
    })
  } catch (error) {
    if (error instanceof W05SocialClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Social service unavailable')
  }
}
