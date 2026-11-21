import { callW04ContentSearch, W04FeedClientError } from '../../../../feed/w04-feed-client.js'
import { TrafficLimitError, enforcePublicReadRateLimit, rateLimitResponse } from '../../../../auth/traffic-limit.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: 'req_' + crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
  )

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url)
    const allowed = new Set(['q', 'cursor', 'limit'])
    let invalidQuery = url.search.length > 4096
    url.searchParams.forEach((_value, key) => {
      if (!allowed.has(key)) invalidQuery = true
    })

    const qValues = url.searchParams.getAll('q')
    const cursorValues = url.searchParams.getAll('cursor')
    const limitValues = url.searchParams.getAll('limit')
    const query = qValues[0]?.normalize('NFKC').trim() ?? ''
    const cursor = cursorValues[0]?.trim() ?? ''
    const limit = limitValues[0]?.trim() ?? '20'

    if (
      invalidQuery ||
      qValues.length !== 1 ||
      cursorValues.length > 1 ||
      limitValues.length > 1 ||
      !query ||
      query.length > 256 ||
      (cursor && (cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(cursor))) ||
      !/^(?:[1-9]|[1-4][0-9]|50)$/.test(limit)
    ) {
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid search query')
    }

    // Search is public-only for this first native slice. Private or gated
    // content is never queried by a client-supplied identity or returned here.
    await enforcePublicReadRateLimit(request)

    const params = new URLSearchParams({ q: query, limit })
    if (cursor) params.set('cursor', cursor)
    return await callW04ContentSearch({
      request,
      pathname: '/internal/search/contents?' + params.toString(),
    })
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    if (error instanceof W04FeedClientError) {
      return errorResponse(error.status, error.code, error.message)
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Search service unavailable')
  }
}
