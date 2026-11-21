import { TrafficLimitError, enforcePublicReadRateLimit, rateLimitResponse } from '../../../../../../auth/traffic-limit.js'
import {
  callW05SocialPublic,
  resolveOptionalCookieSocialPrincipal,
  resolveSocialProfileIdentityId,
  W05SocialClientError,
} from '../../../../../../social/w05-social-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
    { status: code === 'VALIDATION_FAILED' && status === 400 ? 422 : status, headers: { 'cache-control': 'no-store' } },
  )

export async function GET(
  request: Request,
  context: { params: Promise<{ userId: string }> },
): Promise<Response> {
  try {
    const { userId } = await context.params
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(userId)) {
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid user id')
    }

    const url = new URL(request.url)
    if (url.search.length > 4096) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid query')
    const query = new URLSearchParams()
    const cursors = url.searchParams.getAll('cursor')
    const limits = url.searchParams.getAll('limit')
    if (cursors.length > 1 || limits.length > 1) {
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid query')
    }
    if (cursors.length) {
      const cursor = cursors[0]?.trim() ?? ''
      if (!cursor || cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
        return errorResponse(422, 'VALIDATION_FAILED', 'Invalid cursor')
      }
      query.set('cursor', cursor)
    }
    if (limits.length) {
      const limit = limits[0]?.trim() ?? ''
      if (!/^(?:[1-9]|[1-4][0-9]|50)$/.test(limit)) {
        return errorResponse(422, 'VALIDATION_FAILED', 'Invalid limit')
      }
      query.set('limit', limit)
    }

    await enforcePublicReadRateLimit(request)
    const socialUserId = await resolveSocialProfileIdentityId(userId)
    const viewer = await resolveOptionalCookieSocialPrincipal(request)
    if (viewer instanceof Response) return viewer
    const suffix = query.toString() ? '?' + query.toString() : ''
    return await callW05SocialPublic({
      request,
      pathname: '/internal/social/users/' + encodeURIComponent(socialUserId) + '/replies' + suffix,
      method: 'GET',
      principal: viewer,
    })
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    if (error instanceof W05SocialClientError) {
      return errorResponse(error.status, error.code, error.message)
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Social service unavailable')
  }
}
