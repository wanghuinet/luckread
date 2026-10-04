import { proxyBetterAuth } from '../../../auth/better-auth-route'
import { TrafficLimitError, enforceW01WriteRateLimit, rateLimitResponse } from '@/auth/traffic-limit'

export async function POST(request: Request): Promise<Response> {
  try {
    await enforceW01WriteRateLimit(request)
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return Response.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Authentication service unavailable' } },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }

  return proxyBetterAuth(request, '/sign-out', 'POST', {})
}
