import {
  resetPasswordThroughW02,
  W02PasswordRecoveryClientError,
} from '@/auth/w02-password-recovery-client'

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
    body = (await request.json()) as PasswordResetConfirmRequest
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
    await resetPasswordThroughW02(
      request,
      body.recoveryToken,
      body.newPassword,
    )
  } catch (error) {
    if (error instanceof W02PasswordRecoveryClientError) {
      return jsonError(error.status, error.code, error.message)
    }
    return jsonError(503, 'SERVICE_UNAVAILABLE', 'Password recovery service unavailable')
  }

  return new Response(null, {
    status: 204,
    headers: {
      'cache-control': 'no-store',
    },
  })
}
