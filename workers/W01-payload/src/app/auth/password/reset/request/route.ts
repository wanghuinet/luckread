import { callW02BetterAuth } from '../../../../../auth/w02-auth-client.js'

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
    body = await request.json() as PasswordResetRequest
  } catch {
    return jsonError(422, 'VALIDATION_FAILED', 'Invalid password recovery request')
  }

  if (typeof body.identifier !== 'string' || body.identifier.trim().length === 0) {
    return jsonError(422, 'VALIDATION_FAILED', 'Invalid password recovery request')
  }

  try {
    const response = await callW02BetterAuth(request, '/api/auth/request-password-reset', {
      method: 'POST',
      body: {
        email: body.identifier.trim().toLowerCase(),
        redirectTo: new URL('/reset-password', request.url).toString(),
      },
    })

    if (response.status === 400 || response.status === 422) {
      return jsonError(422, 'VALIDATION_FAILED', 'Invalid password recovery request')
    }
    if (!response.ok) {
      return jsonError(503, 'SERVICE_UNAVAILABLE', 'Password recovery service unavailable')
    }

    return new Response(null, {
      status: 202,
      headers: { 'cache-control': 'no-store' },
    })
  } catch {
    return jsonError(503, 'SERVICE_UNAVAILABLE', 'Password recovery service unavailable')
  }
}
