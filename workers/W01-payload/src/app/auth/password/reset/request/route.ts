import { getPayload } from 'payload'

import config from '@payload-config'

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

  const payload = await getPayload({ config })

  try {
    // Payload's native forgotPassword flow deliberately fails silently when
    // the account does not exist. The route returns the same 202 response in
    // either case, preserving the contract's enumeration-resistant semantics.
    await payload.forgotPassword({
      collection: 'users',
      data: {
        email: body.identifier.trim().toLowerCase(),
      },
    })
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'auth.password_reset_request.native_failure',
        diagnosticCode: 'AUTH004_PAYLOAD_FORGOT_PASSWORD_FAILURE',
        errorName: error instanceof Error ? error.name : typeof error,
      }),
    )
    return jsonError(503, 'SERVICE_UNAVAILABLE', 'Password recovery service unavailable')
  }

  return new Response(null, {
    status: 202,
    headers: {
      'cache-control': 'no-store',
    },
  })
}
