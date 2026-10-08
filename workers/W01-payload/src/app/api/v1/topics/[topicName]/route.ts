import { cachedPublicGet } from '../../../../../../lib/public-response-cache.js'
import { enforcePublicReadRateLimit, TrafficLimitError, rateLimitResponse } from '../../../../../../auth/traffic-limit.js'
import { callW05SocialPublic, W05SocialClientError } from '../../../../../../social/w05-social-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} }, requestId: crypto.randomUUID() }, { status })

export async function GET(
  request: Request,
  context: { params: Promise<{ topicName: string }> },
): Promise<Response> {
  try {
    const { topicName } = await context.params
    if (!topicName?.trim()) return errorResponse(400, 'VALIDATION_FAILED', 'Invalid topic')
    const url = new URL(request.url)
    await enforcePublicReadRateLimit(request)
    return await cachedPublicGet(
      request,
      'social-topic',
      () => callW05SocialPublic({
        request,
        pathname: '/internal/social/topics/' + encodeURIComponent(topicName) + (url.search ? url.search : ''),
        method: 'GET',
      }),
      10,
    )
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    if (error instanceof W05SocialClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Social service unavailable')
  }
}
