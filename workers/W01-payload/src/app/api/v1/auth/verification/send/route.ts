import {
  enforceAuthRateLimit,
  TrafficLimitError,
  rateLimitResponse,
} from '../../../../../../auth/traffic-limit.js'
import { proxyBetterAuth } from '../../../../../../auth/w02-session-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json({
    error: { code, message, details: {} },
    requestId: crypto.randomUUID(),
  }, {
    status,
    headers: { 'cache-control': 'no-store' },
  })

/**
 * Public v1 resend entry. Better Auth stays behind W02 and the general auth
 * proxy blocks direct use of send-verification-email so this rate-limited edge
 * remains the only public resend path.
 */
export async function POST(request: Request): Promise<Response> {
  const clientIp = request.headers.get('cf-connecting-ip')?.trim() || 'unknown'
  try {
    await enforceAuthRateLimit(request, 'AUTH_REGISTER_LIMITER', ['ip:' + clientIp])
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', '验证邮件服务暂时不可用，请稍后重试。')
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse(422, 'VALIDATION_FAILED', '验证邮件请求格式无效，请检查邮箱地址。')
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return errorResponse(422, 'VALIDATION_FAILED', '验证邮件请求格式无效，请检查邮箱地址。')
  }

  const identity = (body as { identity?: unknown }).identity
  if (
    typeof identity !== 'string' ||
    identity.trim().length === 0 ||
    identity.trim().length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.trim())
  ) {
    return errorResponse(422, 'VALIDATION_FAILED', '验证邮件请求格式无效，请检查邮箱地址。')
  }

  try {
    const upstream = await proxyBetterAuth(request, '/send-verification-email', {
      body: {
        email: identity.trim().toLowerCase(),
        callbackURL: 'https://luckread.com/login?verified=1',
      },
    })

    if (upstream.status === 429) {
      return errorResponse(429, 'RATE_LIMITED', '验证邮件请求过于频繁，请稍后再试。')
    }
    if (upstream.status >= 500) {
      return errorResponse(503, 'SERVICE_UNAVAILABLE', '验证邮件服务暂时不可用，请稍后重试。')
    }

    // Do not reveal whether an email address has an account or is already
    // verified. The caller receives the same accepted response for all
    // non-server-error outcomes from Better Auth.
    return new Response(null, {
      status: 202,
      headers: { 'cache-control': 'no-store' },
    })
  } catch {
    return errorResponse(503, 'SERVICE_UNAVAILABLE', '验证邮件服务暂时不可用，请稍后重试。')
  }
}
