import { TrafficLimitError, enforcePublicReadRateLimit, rateLimitResponse } from '../../../../../../auth/traffic-limit.js'
import { callW05SocialPublic, W05SocialClientError } from '../../../../../../social/w05-social-client.js'

const errorResponse = (status: number, code: string, message: string) => Response.json(
  { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
  { status: code === 'VALIDATION_FAILED' && status === 400 ? 422 : status, headers: { 'cache-control': 'no-store' } },
)

export async function GET(
  request: Request,
  context: { params: Promise<{ userId: string }> },
): Promise<Response> {
  try {
    const { userId } = await context.params
    if (!userId.trim()) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid user id')
    await enforcePublicReadRateLimit(request)
    return await callW05SocialPublic({
      request,
      pathname: '/internal/social/users/' + encodeURIComponent(userId) + '/pinned-content',
      method: 'GET',
    })
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    if (error instanceof W05SocialClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Social service unavailable')
  }
}
