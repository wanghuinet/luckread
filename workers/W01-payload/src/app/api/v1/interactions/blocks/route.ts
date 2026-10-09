import {
  assertSocialTargetUserExists,
  callW05Social,
  resolveCookieSocialPrincipal,
  W05SocialClientError,
} from '../../../../../social/w05-social-client.js'
import { invalidatePublicFollowListsForUsers } from '../../../../../lib/public-response-cache.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
    { status, headers: { 'cache-control': 'no-store' } },
  )

export async function POST(request: Request): Promise<Response> {
  try {
    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal
    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
    if (!idempotencyKey || idempotencyKey.length > 256) {
      return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key is required')
    }
    let body: unknown
    try { body = await request.json() } catch {
      return errorResponse(400, 'VALIDATION_FAILED', 'Invalid request body')
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return errorResponse(400, 'VALIDATION_FAILED', 'Invalid request body')
    }
    const targetUserId = (body as { targetUserId?: unknown }).targetUserId
    if (typeof targetUserId !== 'string' || !targetUserId.trim()) {
      return errorResponse(400, 'VALIDATION_FAILED', 'targetUserId is required')
    }
    await assertSocialTargetUserExists(targetUserId)
    const response = await callW05Social({
      request,
      pathname: '/internal/social/interactions/blocks',
      method: 'POST',
      principal,
      body: { targetUserId },
    })
    if (response.ok) await invalidatePublicFollowListsForUsers(principal.userId, targetUserId)
    return response
  } catch (error) {
    if (error instanceof W05SocialClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Social service unavailable')
  }
}
