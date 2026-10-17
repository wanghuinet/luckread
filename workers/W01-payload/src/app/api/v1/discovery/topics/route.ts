import { cachedPublicGet } from '../../../../../lib/public-response-cache.js'
import { enforcePublicReadRateLimit, TrafficLimitError, rateLimitResponse } from '../../../../../auth/traffic-limit.js'
import { callW05SocialPublic, W05SocialClientError } from '../../../../../social/w05-social-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} }, requestId: crypto.randomUUID() }, { status })

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url)
    let invalidQueryKey = false
    url.searchParams.forEach((_value, key) => {
      if (key !== 'limit' && key !== 'cursor') invalidQueryKey = true
    })
    if (
      invalidQueryKey ||
      url.searchParams.getAll('limit').length > 1 ||
      url.searchParams.getAll('cursor').length > 1
    ) {
      return errorResponse(400, 'VALIDATION_FAILED', 'Invalid discovery topic query')
    }
    await enforcePublicReadRateLimit(request)
    return await cachedPublicGet(
      request,
      'social-discovery-topics',
      () => callW05SocialPublic({
        request,
        pathname: '/internal/social/discovery/topics' + (url.search ? url.search : ''),
        method: 'GET',
      }),
      30,
    )
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    if (error instanceof W05SocialClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Discovery service unavailable')
  }
}
