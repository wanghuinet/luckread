import { proxyBetterAuth } from '../../../auth/w02-session-client.js'
import { enforceAuthRateLimit, TrafficLimitError, rateLimitResponse } from '../../../auth/traffic-limit.js'

type PublicUser = {
  id: string
  email: string
  name: string | null
  emailVerified: boolean
  image: string | null
}

const errorResponse = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} }, requestId: crypto.randomUUID() }, {
    status,
    headers: { 'cache-control': 'no-store' },
  })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const publicUser = (value: unknown): PublicUser | null => {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.email !== 'string') return null
  if (typeof value.emailVerified !== 'boolean') return null
  return {
    id: value.id,
    email: value.email,
    name: typeof value.name === 'string' ? value.name : null,
    emailVerified: value.emailVerified,
    image: typeof value.image === 'string' ? value.image : null,
  }
}

const upstreamErrorCode = (value: unknown): string | null => {
  if (!isRecord(value)) return null
  if (typeof value.code === 'string') return value.code.toUpperCase()
  if (isRecord(value.error) && typeof value.error.code === 'string') return value.error.code.toUpperCase()
  return null
}

async function normalizeUpstreamError(response: Response): Promise<Response> {
  let payload: unknown = null
  try { payload = await response.clone().json() } catch {}
  const code = upstreamErrorCode(payload)

  if (response.status === 429) {
    return errorResponse(429, 'RATE_LIMITED', '登录尝试过于频繁，请稍后再试。')
  }
  if (response.status === 401) {
    return errorResponse(401, 'UNAUTHENTICATED', '邮箱或密码不正确，请检查后重试。')
  }
  if (response.status === 403 && code === 'EMAIL_NOT_VERIFIED') {
    return errorResponse(403, 'EMAIL_NOT_VERIFIED', '该邮箱尚未验证，请先完成邮箱验证。')
  }
  if (response.status >= 500) {
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable')
  }
  if (response.status >= 400) {
    const status = response.status === 422 ? 422 : response.status === 400 ? 400 : response.status
    return errorResponse(status, 'VALIDATION_FAILED', '登录请求无效，请检查输入后重试。')
  }
  return errorResponse(502, 'AUTH_UPSTREAM_RESPONSE_INVALID', 'Authentication service returned an invalid response')
}

const publicLoginResponse = (response: Response, sessionToken: string, user: PublicUser): Response => {
  const headers = new Headers(response.headers)
  // Bearer credentials use an app-owned response header. Browser clients keep
  // using Better Auth's HttpOnly Set-Cookie session without reading the token.
  headers.delete('set-auth-token')
  headers.delete('content-length')
  headers.delete('content-encoding')
  headers.delete('transfer-encoding')
  headers.set('content-type', 'application/json; charset=utf-8')
  headers.set('cache-control', 'no-store')
  headers.set('X-LuckRead-Session-Token', sessionToken)

  return new Response(JSON.stringify({
    data: { user },
    requestId: crypto.randomUUID(),
  }), { status: response.status, headers })
}

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
  if (Object.keys(body).some((key) => key !== 'identity' && key !== 'credential')) {
    return errorResponse(400, 'VALIDATION_FAILED', '登录请求包含不支持的字段。')
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

  let upstream: Response
  try {
    upstream = await proxyBetterAuth(request, '/sign-in/email', {
      body: {
        email: normalizedIdentity,
        password: credential,
        rememberMe: true,
      },
    })
  } catch {
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable')
  }

  if (!upstream.ok) return normalizeUpstreamError(upstream)

  let payload: unknown = null
  try { payload = await upstream.clone().json() } catch {}
  if (!isRecord(payload)) {
    return errorResponse(502, 'AUTH_UPSTREAM_RESPONSE_INVALID', 'Authentication service returned an invalid response')
  }

  const user = publicUser(payload.user)
  const bodyToken = typeof payload.token === 'string' && payload.token.length > 0 ? payload.token : null
  const headerToken = upstream.headers.get('set-auth-token')?.trim() ?? ''
  // Better Auth's Bearer plugin publishes the session credential in the
  // response header. Do not require a duplicate credential in the JSON body.
  if (!user || !headerToken || (bodyToken !== null && headerToken !== bodyToken)) {
    return errorResponse(502, 'AUTH_UPSTREAM_RESPONSE_INVALID', 'Authentication service returned an invalid response')
  }

  return publicLoginResponse(upstream, headerToken, user)
}
