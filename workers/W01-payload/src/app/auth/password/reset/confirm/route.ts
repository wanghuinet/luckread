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
    return jsonError(422, 'VALIDATION_FAILED', 'Invalid password reset request')
  }

  if (
    typeof body.recoveryToken !== 'string' ||
    body.recoveryToken.length === 0 ||
    !assertPasswordPolicy(body.newPassword)
  ) {
    return jsonError(422, 'VALIDATION_FAILED', 'Invalid password reset request')
  }

  try {
    const response = await proxyBetterAuth(request, '/reset-password', {
      body: { token: body.recoveryToken, newPassword: body.newPassword },
    })
    if (!response.ok) {
      return new Response(null, {
        status: response.status >= 500 ? 503 : 422,
        headers: { 'cache-control': 'no-store' },
      })
    }
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
  } catch {
    return jsonError(503, 'SERVICE_UNAVAILABLE', 'Password reset service unavailable')
  }
}
