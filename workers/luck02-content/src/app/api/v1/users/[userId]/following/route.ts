import { cachedPublicGet } from '../../../../../../lib/public-response-cache.js'

import {
  callW05SocialPublic,
  W05SocialClientError,
} from '../../../../../../social/w05-social-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: crypto.randomUUID() },
    { status },
  )

export async function GET(
  request: Request,
  context: { params: Promise<{ userId: string }> },
): Promise<Response> {
  try {
    const { userId } = await context.params
    if (!userId.trim()) return errorResponse(400, 'VALIDATION_FAILED', 'Invalid user id')

    const url = new URL(request.url)
    const query = new URLSearchParams()
    const cursor = url.searchParams.get('cursor')
    const limit = url.searchParams.get('limit')
    if (cursor) query.set('cursor', cursor)
    if (limit) query.set('limit', limit)

    const suffix = query.toString() ? `?${query.toString()}` : ''
    return await cachedPublicGet(
      request,
      'following',
      () => callW05SocialPublic({
        request,
        pathname: `/internal/social/users/${encodeURIComponent(userId)}/following${suffix}`,
        method: 'GET',
      }),
      15,
    )
  } catch (error) {
    if (error instanceof W05SocialClientError) {
      return errorResponse(error.status, error.code, error.message)
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Social service unavailable')
  }
}
