import { callW04TrendingSearches, W04FeedClientError } from '../../../../../feed/w04-feed-client.js'
import { TrafficLimitError, enforcePublicReadRateLimit, rateLimitResponse } from '../../../../../auth/traffic-limit.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: 'req_' + crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
  )

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url)
    const allowed = new Set(['limit'])
    let invalidQuery = url.search.length > 256
    url.searchParams.forEach((_value, key) => {
      if (!allowed.has(key)) invalidQuery = true
    })
    const limitValues = url.searchParams.getAll('limit')
    const limit = limitValues[0]?.trim() ?? '10'
    if (invalidQuery || limitValues.length > 1 || !/^(?:[1-9]|1[0-9]|20)$/.test(limit)) {
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid trending search limit')
    }

    await enforcePublicReadRateLimit(request)
    return await callW04TrendingSearches({
      request,
      pathname: '/internal/search/trending?' + new URLSearchParams({ limit }).toString(),
    })
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    if (error instanceof W04FeedClientError) {
      return errorResponse(error.status, error.code, error.message)
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Trending search service unavailable')
  }
}
