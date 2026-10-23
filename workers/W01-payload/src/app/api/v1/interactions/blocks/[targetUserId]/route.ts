import {
  callW05Social,
  resolveSocialProfileIdentity,
  resolveCookieSocialPrincipal,
  W05SocialClientError,
} from '../../../../../../social/w05-social-client.js'
import { TrafficLimitError, enforceW01WriteRateLimit, rateLimitResponse } from '../../../../../../auth/traffic-limit.js'
import { invalidatePublicFollowListsForUsers } from '../../../../../../lib/public-response-cache.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
    { status: code === 'VALIDATION_FAILED' && status === 400 ? 422 : status, headers: { 'cache-control': 'no-store' } },
  )

export async function DELETE(
  request: Request,
  context: { params: Promise<{ targetUserId: string }> },
): Promise<Response> {
  try {
    await enforceW01WriteRateLimit(request)
    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal
    const { targetUserId } = await context.params
    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
    if (!idempotencyKey) return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key is required')
    if (idempotencyKey.length > 256) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid Idempotency-Key header')
    const socialTarget = await resolveSocialProfileIdentity(targetUserId)
    const socialPrincipal = await resolveSocialProfileIdentity(principal.userId)
    const response = await callW05Social({
      request,
      pathname: '/internal/social/interactions/blocks/' + encodeURIComponent(socialTarget.identityId),
      method: 'DELETE',
      principal,
    })
    if (response.ok) await invalidatePublicFollowListsForUsers(principal.userId, socialPrincipal.payloadProfileId, socialTarget.identityId, socialTarget.payloadProfileId)
    return response
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    if (error instanceof W05SocialClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Social service unavailable')
  }
}
