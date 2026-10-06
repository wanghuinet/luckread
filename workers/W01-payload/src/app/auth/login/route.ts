import { callW02BetterAuth } from '../../../auth/w02-auth-client.js'
import { enforceAuthRateLimit, TrafficLimitError, rateLimitResponse } from '../../../auth/traffic-limit.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    {
      error: { code, message, details: {} },
      requestId: crypto.randomUUID(),
    },
    {
      status,
      headers: { 'cache-control': 'no-store' },
    },
  )

export async function POST(request: Request): Promise<Response> {
  try {
    const clientIp = request.headers.get('cf-connecting-ip')?.trim() || 'unknown'
    await enforceAuthRateLimit(request, 'AUTH_LOGIN_LIMITER', ['ip:' + clientIp])
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable')
  }

  let body: { identity?: unknown; credential?: unknown }
  try {
    body = await request.json() as { identity?: unknown; credential?: unknown }
  } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid request body')
  }

  if (
    typeof body.identity !== 'string' ||
    body.identity.trim().length === 0 ||
    typeof body.credential !== 'string' ||
    body.credential.length === 0
  ) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid authentication request')
  }

  try {
    return await callW02BetterAuth(
      request,
      '/api/auth/sign-in/email',
      {
        method: 'POST',
        body: {
          email: body.identity.trim().toLowerCase(),
          password: body.credential,
        },
      },
    )
  } catch {
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable')
  }
}
