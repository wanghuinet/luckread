import { proxyBetterAuth } from '../../../auth/w02-session-client.js'
import { enforceAuthRateLimit, TrafficLimitError, rateLimitResponse } from '../../../auth/traffic-limit.js'

export async function POST(request: Request): Promise<Response> {
  try {
    const clientIp = request.headers.get('cf-connecting-ip')?.trim() || 'unknown'
    await enforceAuthRateLimit(request, 'AUTH_REFRESH_LIMITER', ['ip:' + clientIp])
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return Response.json({
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Authentication service unavailable' },
      requestId: `req_${crypto.randomUUID()}`,
    }, { status: 503, headers: { 'cache-control': 'no-store' } })
  }

  try {
    return await proxyBetterAuth(request, '/get-session', { method: 'GET' })
  } catch {
    return Response.json({
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Authentication service unavailable' },
      requestId: `req_${crypto.randomUUID()}`,
    }, { status: 503, headers: { 'cache-control': 'no-store' } })
  }
}
