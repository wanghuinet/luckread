import { proxyBetterAuth } from '../../../auth/better-auth-route'
import { enforceAuthRateLimit, TrafficLimitError, rateLimitResponse } from '../../../auth/traffic-limit.js'

const jsonError = (status: number, code: string, message: string) =>
  Response.json(
    {
      error: { code, message, details: {} },
      requestId: crypto.randomUUID(),
    },
    { status, headers: { 'cache-control': 'no-store' } },
  )

export async function POST(request: Request): Promise<Response> {
  try {
    const clientIp = request.headers.get('cf-connecting-ip')?.trim() || 'unknown'
    await enforceAuthRateLimit(request, 'AUTH_LOGIN_LIMITER', ['ip:' + clientIp])
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return jsonError(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable')
  }

  let body: { identity?: unknown; credential?: unknown }
  try {
    body = (await request.json()) as { identity?: unknown; credential?: unknown }
  } catch {
    return jsonError(400, 'VALIDATION_FAILED', 'Invalid request body')
  }

  if (
    typeof body.identity !== 'string' ||
    body.identity.trim().length === 0 ||
    typeof body.credential !== 'string' ||
    body.credential.length === 0
  ) {
    return jsonError(400, 'VALIDATION_FAILED', 'Invalid authentication request')
  }

  return proxyBetterAuth(request, '/sign-in/email', 'POST', {
    email: body.identity.trim().toLowerCase(),
    password: body.credential,
  })
}
