import { getPayload } from 'payload'

import config from '@payload-config'
import { enforcePublicReadRateLimit, TrafficLimitError, rateLimitResponse } from '../../../../../auth/traffic-limit.js'
import { cachedPublicGet } from '../../../../../lib/public-response-cache.js'

export async function GET(
  _request: Request,
  context: { params: Promise<{ userId: string }> },
): Promise<Response> {
  try {
    await enforcePublicReadRateLimit(_request)
    const { userId } = await context.params
    if (!userId || userId.length > 128) {
      return Response.json(
        { error: { code: 'VALIDATION_FAILED', message: 'Invalid user id', details: {} }, requestId: `req_${crypto.randomUUID()}` },
        { status: 422, headers: { 'cache-control': 'no-store' } },
      )
    }

    return await cachedPublicGet(
      _request,
      'user-profile',
      async () => {
        const payload = await getPayload({ config })
        const user = await payload.findByID({
          collection: 'users',
          id: userId,
          depth: 0,
          overrideAccess: true,
        })

        if (!user) {
          return Response.json(
            { error: { code: 'NOT_FOUND', message: 'User not found', details: {} }, requestId: `req_${crypto.randomUUID()}` },
            { status: 404, headers: { 'cache-control': 'no-store' } },
          )
        }

        const publicUser = user as unknown as Record<string, unknown>
        return Response.json({
          id: String(publicUser.id ?? ''),
          username: typeof publicUser.username === 'string' ? publicUser.username : '',
          displayName: typeof publicUser.displayName === 'string' ? publicUser.displayName : null,
          bio: typeof publicUser.bio === 'string' ? publicUser.bio : null,
          avatar: typeof publicUser.avatar === 'string' ? publicUser.avatar : null,
          requestId: `req_${crypto.randomUUID()}`,
        }, {
          headers: {
            'cache-control': 'public, max-age=30, stale-while-revalidate=120',
          },
        })
      },
      30,
    )
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(_request)
    return Response.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Profile service unavailable', details: {} }, requestId: `req_${crypto.randomUUID()}` },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }
}
