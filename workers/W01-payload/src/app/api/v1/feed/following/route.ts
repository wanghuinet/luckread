import { callW04FollowingFeed, W04FeedClientError } from '../../../../../feed/w04-feed-client.js'
import { resolveSocialPrincipal } from '../../../../../social/w05-social-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: 'req_' + crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
  )

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url)
    const allowed = new Set(['cursor', 'limit'])
    for (const key of url.searchParams.keys()) {
      if (!allowed.has(key)) {
        return errorResponse(422, 'VALIDATION_FAILED', 'Invalid following feed query')
      }
    }

    const cursorValues = url.searchParams.getAll('cursor')
    const limitValues = url.searchParams.getAll('limit')
    if (cursorValues.length > 1 || limitValues.length > 1) {
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid following feed query')
    }

    const cursor = cursorValues[0]?.trim() ?? ''
    const limit = limitValues[0]?.trim() ?? '20'
    if (
      (cursor && (cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(cursor))) ||
      !/^(?:[1-9]|[1-4][0-9]|50)$/.test(limit)
    ) {
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid following feed query')
    }

    const principal = await resolveSocialPrincipal(request)
    if (principal instanceof Response) return principal

    const query = new URLSearchParams({ limit })
    if (cursor) query.set('cursor', cursor)
    return await callW04FollowingFeed({
      request,
      pathname: '/internal/feed/following?' + query.toString(),
      principal,
    })
  } catch (error) {
    if (error instanceof W04FeedClientError) {
      return errorResponse(error.status, error.code, error.message)
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Feed service unavailable')
  }
}
