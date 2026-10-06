import { enforceAuthRateLimit, TrafficLimitError, rateLimitResponse } from '../../../auth/traffic-limit.js'

export async function POST(request: Request): Promise<Response> {
  try {
    const clientIp = request.headers.get('cf-connecting-ip')?.trim() || 'unknown'
    await enforceAuthRateLimit(request, 'AUTH_REFRESH_LIMITER', ['ip:' + clientIp])
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return Response.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Authentication service unavailable' }, requestId: crypto.randomUUID() },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }

  return Response.json(
    {
      error: {
        code: 'AUTH_REFRESH_RETIRED',
        message: 'Better Auth manages session renewal automatically; use GET /api/auth/get-session.',
        details: {},
      },
      requestId: crypto.randomUUID(),
    },
    {
      status: 410,
      headers: {
        'cache-control': 'no-store',
        Allow: 'GET',
      },
    },
  )
}
