import {
  requestPasswordResetThroughW02,
  W02PasswordRecoveryClientError,
} from '@/auth/w02-password-recovery-client'

type PasswordResetRequest = {
  identifier?: unknown
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

export async function POST(request: Request): Promise<Response> {
  let body: PasswordResetRequest
  try {
    body = (await request.json()) as PasswordResetRequest
  } catch {
    return jsonError(422, 'VALIDATION_FAILED', 'Invalid password recovery request')
  }

  if (typeof body.identifier !== 'string' || body.identifier.trim().length === 0) {
    return jsonError(422, 'VALIDATION_FAILED', 'Invalid password recovery request')
  }

  try {
    await requestPasswordResetThroughW02(
      request,
      body.identifier.trim().toLowerCase(),
    )
  } catch (error) {
    if (error instanceof W02PasswordRecoveryClientError) {
      return jsonError(error.status, error.code, error.message)
    }
    return jsonError(503, 'SERVICE_UNAVAILABLE', 'Password recovery service unavailable')
  }

  return new Response(null, {
    status: 202,
    headers: {
      'cache-control': 'no-store',
    },
  })
}
