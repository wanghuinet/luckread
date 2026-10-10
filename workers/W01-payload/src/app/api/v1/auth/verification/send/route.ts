import {
  enforceAuthRateLimit,
  TrafficLimitError,
  rateLimitResponse,
} from '../../../../../../auth/traffic-limit.js'
import { proxyBetterAuth } from '../../../../../../auth/w02-session-client.js'

const UPSTREAM_PRIVACY_NOOP_CODES = new Set([
  'USER_NOT_FOUND',
  'EMAIL_ALREADY_VERIFIED',
  'USER_ALREADY_VERIFIED',
])

const errorResponse = (status: number, code: string, message: string) =>
  Response.json({
    error: { code, message, details: {} },
    requestId: crypto.randomUUID(),
  }, {
    status,
    headers: { 'cache-control': 'no-store' },
  })

async function readUpstreamDiagnosticCode(response: Response): Promise<string | null> {
  try {
    const payload: unknown = await response.clone().json()
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
    const root = payload as Record<string, unknown>
    const nested = root.error && typeof root.error === 'object' && !Array.isArray(root.error)
      ? root.error as Record<string, unknown>
      : null
    const candidate = nested?.code ?? root.code ?? root.errorCode
    if (typeof candidate !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(candidate)) return null
    return candidate.toUpperCase()
  } catch {
    return null
  }
}

/**
 * Public v1 resend entry. Better Auth stays behind W02 and the general auth
 * proxy blocks direct use of send-verification-email so this rate-limited edge
 * remains the only public resend path.
 */
export async function POST(request: Request): Promise<Response> {
  const clientIp = request.headers.get('cf-connecting-ip')?.trim() || 'unknown'
  const cfRay = request.headers.get('cf-ray') ?? null
  try {
    await enforceAuthRateLimit(request, 'AUTH_REGISTER_LIMITER', ['ip:' + clientIp])
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    console.error(JSON.stringify({
      event: 'auth.email_verification.rate_limit_failure',
      diagnosticCode: 'AUTH_EMAIL_VERIFICATION_RATE_LIMIT_FAILURE',
      cfRay,
      errorName: error instanceof Error ? error.name : typeof error,
    }))
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
    const upstreamCode = await readUpstreamDiagnosticCode(upstream)

    // This is only the W02 endpoint outcome. Actual provider acceptance is
    // logged by W02 with a provider message ID when available.
    console.info(JSON.stringify({
      event: 'auth.email_verification.upstream_response',
      diagnosticCode: 'AUTH_EMAIL_VERIFICATION_UPSTREAM_RESPONSE',
      cfRay,
      upstreamStatus: upstream.status,
      upstreamCode,
    }))

    if (upstream.status === 429) {
      return errorResponse(429, 'RATE_LIMITED', '验证邮件请求过于频繁，请稍后再试。')
    }
    if (upstream.status >= 500) {
      console.error(JSON.stringify({
        event: 'auth.email_verification.upstream_failure',
        diagnosticCode: 'AUTH_EMAIL_VERIFICATION_UPSTREAM_FAILURE',
        cfRay,
        upstreamStatus: upstream.status,
        upstreamCode,
      }))
      return errorResponse(503, 'SERVICE_UNAVAILABLE', '验证邮件服务暂时不可用，请稍后重试。')
    }

    // Preserve Better Auth's account-enumeration protection for expected
    // no-op outcomes, including older versions that returned a 4xx code.
    if (!upstream.ok && UPSTREAM_PRIVACY_NOOP_CODES.has(upstreamCode ?? '')) {
      return new Response(null, {
        status: 202,
        headers: { 'cache-control': 'no-store' },
      })
    }

    // Do not convert unrelated 4xx/redirects into "accepted": that hid invalid
    // origin and integration errors from the caller while no mail was sent.
    if (!upstream.ok) {
      console.warn(JSON.stringify({
        event: 'auth.email_verification.upstream_rejection',
        diagnosticCode: 'AUTH_EMAIL_VERIFICATION_UPSTREAM_REJECTION',
        cfRay,
        upstreamStatus: upstream.status,
        upstreamCode,
      }))
      return errorResponse(503, 'SERVICE_UNAVAILABLE', '验证邮件服务暂时不可用，请稍后重试。')
    }

    return new Response(null, {
      status: 202,
      headers: { 'cache-control': 'no-store' },
    })
  } catch (error) {
    console.error(JSON.stringify({
      event: 'auth.email_verification.proxy_failure',
      diagnosticCode: 'AUTH_EMAIL_VERIFICATION_PROXY_FAILURE',
      cfRay,
      errorName: error instanceof Error ? error.name : typeof error,
    }))
    return errorResponse(503, 'SERVICE_UNAVAILABLE', '验证邮件服务暂时不可用，请稍后重试。')
  }
}
