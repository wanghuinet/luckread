import { getMfaStatus, W02AuthClientError } from '../../../auth/w02-session-client.js'
import { enforceAuthRateLimit, rateLimitResponse, TrafficLimitError } from '../../../auth/traffic-limit.js'

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
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'MFA status unavailable')
  }

  try {
    const status = await getMfaStatus(request)
    return Response.json(
      { data: status, requestId: 'req_' + crypto.randomUUID() },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    )
  } catch (error) {
    if (error instanceof W02AuthClientError && error.status === 401) {
      return errorResponse(401, 'UNAUTHENTICATED', 'A valid session is required')
    }
    if (error instanceof W02AuthClientError && error.status === 429) {
      return errorResponse(429, 'RATE_LIMITED', 'Too many requests')
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'MFA status unavailable')
  }
}
