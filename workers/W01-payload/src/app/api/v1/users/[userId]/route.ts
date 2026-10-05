import { enforcePublicReadRateLimit, TrafficLimitError, rateLimitResponse } from '@/auth/traffic-limit'
import { callW02UserProfile, W02UserProfileClientError } from '@/auth/w02-user-profile-client'
import { cachedPublicGet } from '@/lib/public-response-cache'

export async function GET(
  request: Request,
  context: { params: Promise<{ userId: string }> },
): Promise<Response> {
  try {
    await enforcePublicReadRateLimit(request)
    const { userId } = await context.params
    if (!userId || userId.length > 128) {
      return Response.json(
        { error: { code: 'VALIDATION_FAILED', message: 'Invalid user id', details: {} }, requestId: crypto.randomUUID() },
        { status: 400, headers: { 'cache-control': 'no-store' } },
      )
    }

    return cachedPublicGet(
      request,
      'user-profile',
      async () => {
        try {
          return await callW02UserProfile(
            request,
            '/internal/account/profile/by-id?id=' + encodeURIComponent(userId),
            'GET',
          )
        } catch (error) {
          if (error instanceof W02UserProfileClientError) {
            return Response.json(
              { error: { code: 'SERVICE_UNAVAILABLE', message: 'Profile service unavailable', details: {} }, requestId: crypto.randomUUID() },
              { status: error.status, headers: { 'cache-control': 'no-store' } },
            )
          }
          return Response.json(
            { error: { code: 'SERVICE_UNAVAILABLE', message: 'Profile service unavailable', details: {} }, requestId: crypto.randomUUID() },
            { status: 503, headers: { 'cache-control': 'no-store' } },
          )
        }
      },
      30,
    )
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return Response.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Profile service unavailable', details: {} }, requestId: crypto.randomUUID() },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }
}
