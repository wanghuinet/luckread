import { callW02BetterAuth } from '../../../../../auth/w02-auth-client.js'

type PasswordResetConfirmRequest = {
  recoveryToken?: unknown
  newPassword?: unknown
}

const jsonError = (status: number, code: string, message: string) =>
  new Response(
    JSON.stringify({
      error: { code, message, details: {} },
      requestId: crypto.randomUUID(),
    }),
    {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  )

const assertPasswordPolicy = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  const length = Array.from(value).length
  return length >= 15 && length <= 128
}

export async function POST(request: Request): Promise<Response> {
  let body: PasswordResetConfirmRequest
  try {
    body = await request.json() as PasswordResetConfirmRequest
  } catch {
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
    const response = await callW02BetterAuth(request, '/api/auth/reset-password', {
      method: 'POST',
      body: {
        token: body.recoveryToken,
        newPassword: body.newPassword,
      },
    })

    if (response.status === 400 || response.status === 401 || response.status === 422) {
      return jsonError(422, 'RECOVERY_TOKEN_REJECTED', 'Password reset token is invalid or expired')
    }
    if (!response.ok) {
      return jsonError(503, 'SERVICE_UNAVAILABLE', 'Password reset service unavailable')
    }

    return new Response(null, {
      status: 204,
      headers: { 'cache-control': 'no-store' },
    })
  } catch {
    return jsonError(503, 'SERVICE_UNAVAILABLE', 'Password reset service unavailable')
  }
}
