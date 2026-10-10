import { proxyBetterAuth } from '../../../../../auth/w02-session-client.js'

type PasswordResetRequest = { identifier?: unknown }

const jsonError = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} }, requestId: crypto.randomUUID() }, {
    status,
    headers: { 'cache-control': 'no-store' },
  })

export async function POST(request: Request): Promise<Response> {
  let body: unknown
  try { body = await request.json() } catch {
    return jsonError(422, 'VALIDATION_FAILED', '请求数据格式无效，请刷新页面后重试。')
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonError(422, 'VALIDATION_FAILED', '请求数据格式无效，请刷新页面后重试。')
  }

  const rawIdentifier = (body as PasswordResetRequest).identifier
  if (typeof rawIdentifier !== 'string' || rawIdentifier.trim().length === 0) {
    return jsonError(422, 'EMAIL_REQUIRED', '请输入注册邮箱。')
  }
  const identifier = rawIdentifier.trim().toLowerCase()
  if (identifier.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
    return jsonError(422, 'EMAIL_INVALID', '邮箱格式不正确，请检查后重试。')
  }

  try {
    const response = await proxyBetterAuth(request, '/request-password-reset', {
      body: {
        email: identifier,
        redirectTo: 'https://luckread.com/reset-password',
      },
    })
    if (response.ok) return new Response(null, { status: 202, headers: { 'cache-control': 'no-store' } })
    if (response.status === 429) {
      return jsonError(429, 'RATE_LIMITED', '请求过于频繁，请稍等片刻后再试。')
    }
    if (response.status >= 500) {
      return jsonError(503, 'SERVICE_UNAVAILABLE', '密码找回邮件服务暂时不可用，请稍后重试。')
    }
    return jsonError(422, 'RECOVERY_REQUEST_REJECTED', '找回请求未能处理，请检查邮箱格式后重试。')
  } catch {
    return jsonError(503, 'SERVICE_UNAVAILABLE', '密码找回服务暂时不可用，请稍后重试。')
  }
}
