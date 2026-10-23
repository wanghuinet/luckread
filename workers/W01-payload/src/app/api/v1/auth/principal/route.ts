import { enforceAuthRateLimit, TrafficLimitError, rateLimitResponse } from '../../../../../auth/traffic-limit.js'
import { getBetterAuthPrincipal, W02AuthClientError } from '../../../../../auth/w02-session-client.js'

const errorResponse = (status: number, code: string, message: string): Response =>
  Response.json(
    { error: { code, message, details: {} }, requestId: 'req_' + crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
  )

export async function GET(request: Request): Promise<Response> {
  try {
    const clientIp = request.headers.get('cf-connecting-ip')?.trim() || 'unknown'
    await enforceAuthRateLimit(request, 'AUTH_REFRESH_LIMITER', ['ip:' + clientIp])
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable')
  }

  try {
    const principal = await getBetterAuthPrincipal(request)
    return Response.json({
      data: {
        active: principal.active,
        userId: principal.userId,
        email: principal.email,
        username: typeof principal.username === 'string' ? principal.username : null,
        layer: typeof principal.layer === 'string' ? principal.layer : null,
      },
      requestId: 'req_' + crypto.randomUUID(),
    }, { status: 200, headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    if (error instanceof W02AuthClientError && error.status === 401) {
      return errorResponse(401, 'UNAUTHENTICATED', 'A valid session is required')
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable')
  }
}
