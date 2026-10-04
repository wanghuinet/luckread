import { proxyBetterAuth } from '../../../auth/better-auth-route'
import { enforceAuthRateLimit, TrafficLimitError, rateLimitResponse } from '../../../auth/traffic-limit.js'

export async function POST(request: Request): Promise<Response> {
  try {
    const clientIp = request.headers.get('cf-connecting-ip')?.trim() || 'unknown'
    await enforceAuthRateLimit(request, 'AUTH_REFRESH_LIMITER', ['ip:' + clientIp])
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return Response.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Authentication service unavailable' } },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }

  // Better Auth owns the stateful session cookie and refreshes its expiry
  // during normal get-session operations. There is no second refresh-token
  // implementation in W01 or W02.
  return proxyBetterAuth(request, '/get-session', 'GET')
}
