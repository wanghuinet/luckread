import { proxyBetterAuth } from '../../../../../auth/w02-session-client.js'

type PasswordResetConfirmRequest = {
  recoveryToken?: unknown
  newPassword?: unknown
}

const jsonError = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} }, requestId: crypto.randomUUID() }, {
    status,
    headers: { 'cache-control': 'no-store' },
  })

const assertPasswordPolicy = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  const length = Array.from(value).length
  return length >= 15 && length <= 128
}

export async function POST(request: Request): Promise<Response> {
  let body: PasswordResetConfirmRequest
  try { body = await request.json() as PasswordResetConfirmRequest } catch {
    return jsonError(422, 'VALIDATION_FAILED', '请求数据格式无效，请刷新页面后重试。')
  }

  if (typeof body.recoveryToken !== 'string' || body.recoveryToken.trim().length === 0) {
    return jsonError(422, 'RESET_TOKEN_REQUIRED', '缺少重置令牌，请使用邮件中的重置链接打开页面。')
  }
  if (typeof body.newPassword !== 'string' || body.newPassword.length === 0) {
    return jsonError(422, 'PASSWORD_REQUIRED', '请输入新密码。')
  }
  if (!assertPasswordPolicy(body.newPassword)) {
    return jsonError(422, 'PASSWORD_LENGTH_INVALID', '新密码长度必须为 15–128 个字符。')
  }

  try {
    const response = await proxyBetterAuth(request, '/reset-password', {
      body: { token: body.recoveryToken, newPassword: body.newPassword },
    })
    if (!response.ok) {
      if (response.status === 429) {
        return jsonError(429, 'RATE_LIMITED', '操作过于频繁，请稍后再试。')
      }
      if (response.status >= 500) {
        return jsonError(503, 'SERVICE_UNAVAILABLE', '密码重置服务暂时不可用，请稍后重试。')
      }
      return jsonError(422, 'RESET_TOKEN_INVALID_OR_EXPIRED', '重置链接无效、已过期或已使用，请重新申请密码找回邮件。')
    }
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
  } catch {
    return jsonError(503, 'SERVICE_UNAVAILABLE', '密码重置服务暂时不可用，请稍后重试。')
  }
}
