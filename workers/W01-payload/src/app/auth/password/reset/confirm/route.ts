import { getPayload } from 'payload'

import config from '@payload-config'

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

  const payload = await getPayload({ config })

  try {
    // This route is anonymous/token-bound. Explicitly keep access checks
    // enabled; the recovery token is the native Payload authorization boundary.
    await payload.resetPassword({
      collection: 'users',
      data: {
        token: body.recoveryToken,
        password: body.newPassword,
      },
      overrideAccess: false,
    })
  } catch {
    // Invalid, expired, wrong-purpose and replayed recovery tokens converge
    // on the same client-visible class. Never echo the token or password.
    return jsonError(422, 'RECOVERY_TOKEN_REJECTED', 'Password reset token is invalid or expired')
  }

  return new Response(null, {
    status: 204,
    headers: {
      'cache-control': 'no-store',
    },
  })
}
