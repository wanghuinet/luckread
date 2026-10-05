import { enforcePublicReadRateLimit, TrafficLimitError, rateLimitResponse } from '@/auth/traffic-limit'
import { callW02UserProfile, W02UserProfileClientError } from '@/auth/w02-user-profile-client'
import { cachedPublicGet } from '@/lib/public-response-cache'

const usernamePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

export async function GET(
  request: Request,
  context: { params: Promise<{ username: string }> },
): Promise<Response> {
  try {
    await enforcePublicReadRateLimit(request)
    const { username: rawUsername } = await context.params
    const username = rawUsername?.trim() ?? ''

    if (!username || !usernamePattern.test(username)) {
      return Response.json(
        { error: { code: 'VALIDATION_FAILED', message: 'Invalid username', details: {} }, requestId: crypto.randomUUID() },
        { status: 400, headers: { 'cache-control': 'no-store' } },
      )
    }

    return cachedPublicGet(
      request,
      'user-profile-by-username',
      async () => {
        try {
          return await callW02UserProfile(
            request,
            '/internal/account/profile/by-username?username=' + encodeURIComponent(username),
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
