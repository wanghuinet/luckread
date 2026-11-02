import { TrafficLimitError, rateLimitResponse } from '../../../../../auth/traffic-limit.js'
import { getPublicUserProfileResponse } from '../../../../../users/public-user-profile-reader.js'

export async function GET(
  request: Request,
  context: { params: Promise<{ userId: string }> },
): Promise<Response> {
  try {
    const { userId } = await context.params
    return await getPublicUserProfileResponse(request, userId)
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return Response.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Profile service unavailable', details: {} }, requestId: `req_${crypto.randomUUID()}` },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }
}
