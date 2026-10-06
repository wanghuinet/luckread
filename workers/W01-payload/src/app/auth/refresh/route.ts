import { refreshSession, W02AuthClientError } from '../../../auth/w02-session-client.js'
import { enforceAuthRateLimit, TrafficLimitError, rateLimitResponse } from '../../../auth/traffic-limit.js'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })

const errorResponse = (status: number, code: string, message: string) =>
  json(
    {
      error: {
        code,
        message,
        details: {},
      },
      requestId: crypto.randomUUID(),
    },
    status,
  )

export async function POST(request: Request): Promise<Response> {
  try {
    const clientIp = request.headers.get('cf-connecting-ip')?.trim() || 'unknown'
    await enforceAuthRateLimit(request, 'AUTH_REFRESH_LIMITER', ['ip:' + clientIp])
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable')
  }
  let body: { refreshToken?: unknown; deviceId?: unknown }

  try {
    body = (await request.json()) as { refreshToken?: unknown; deviceId?: unknown }
  } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid request body')
  }

  if (
    typeof body.refreshToken !== 'string' ||
    body.refreshToken.length < 1 ||
    typeof body.deviceId !== 'string' ||
    body.deviceId.length < 1 ||
    body.deviceId.length > 128
  ) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid refresh request')
  }

  let session
  try {
    session = await refreshSession({
      refreshToken: body.refreshToken,
      deviceId: body.deviceId,
    })
  } catch (error) {
    if (error instanceof W02AuthClientError) {
      return errorResponse(
        error.status,
        error.status === 401 ? 'UNAUTHENTICATED' : error.status === 400 ? 'VALIDATION_FAILED' : 'SERVICE_UNAVAILABLE',
        error.status === 401 ? 'Authentication denied' : 'Authentication service unavailable',
      )
    }

    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable')
  }

  return new Response(
      JSON.stringify({
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresIn: session.expiresIn,
        layer: session.layer,
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        },
      },
    )
}
