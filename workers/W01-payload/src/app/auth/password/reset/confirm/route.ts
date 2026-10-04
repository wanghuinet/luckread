import { proxyBetterAuth } from '../../../../auth/better-auth-route'

type PasswordResetConfirmRequest = {
  recoveryToken?: unknown
  newPassword?: unknown
}

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
    return Response.json(
      { error: { code: 'VALIDATION_FAILED', message: 'Invalid password reset request' } },
      { status: 422, headers: { 'cache-control': 'no-store' } },
    )
  }

  if (
    typeof body.recoveryToken !== 'string' ||
    body.recoveryToken.length === 0 ||
    !assertPasswordPolicy(body.newPassword)
  ) {
    return Response.json(
      { error: { code: 'VALIDATION_FAILED', message: 'Invalid password reset request' } },
      { status: 422, headers: { 'cache-control': 'no-store' } },
    )
  }

  return proxyBetterAuth(request, '/reset-password', 'POST', {
    token: body.recoveryToken,
    newPassword: body.newPassword,
  })
}
