import { proxyBetterAuth } from '../../../auth/w02-session-client.js'
import { enforceAuthRateLimit, TrafficLimitError, rateLimitResponse } from '../../../auth/traffic-limit.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} }, requestId: crypto.randomUUID() }, {
    status,
    headers: { 'cache-control': 'no-store' },
  })

export async function POST(request: Request): Promise<Response> {
  try {
    const clientIp = request.headers.get('cf-connecting-ip')?.trim() || 'unknown'
    await enforceAuthRateLimit(request, 'AUTH_LOGIN_LIMITER', ['ip:' + clientIp])
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable')
  }

  let body: unknown
  try { body = await request.json() } catch {
    return errorResponse(400, 'VALIDATION_FAILED', '请求数据格式无效，请重试。')
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return errorResponse(400, 'VALIDATION_FAILED', '请求数据格式无效，请重试。')
  }

  const loginRequest = body as { identity?: unknown; credential?: unknown }
  const identity = loginRequest.identity
  const credential = loginRequest.credential
  if (typeof identity !== 'string' || identity.trim().length === 0) {
    return errorResponse(400, 'EMAIL_REQUIRED', '请输入邮箱地址。')
  }
  const normalizedIdentity = identity.trim().toLowerCase()
  if (normalizedIdentity.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedIdentity)) {
    return errorResponse(400, 'EMAIL_INVALID', '邮箱格式不正确，请检查后重试。')
  }
  if (typeof credential !== 'string' || credential.length === 0) {
    return errorResponse(400, 'PASSWORD_REQUIRED', '请输入登录密码。')
  }

  try {
    return await proxyBetterAuth(request, '/sign-in/email', {
      body: {
        email: normalizedIdentity,
        password: credential,
        rememberMe: true,
      },
    })
  } catch {
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable')
  }
}
