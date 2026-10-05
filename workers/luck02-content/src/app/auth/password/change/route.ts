import { getPayload } from 'payload'

import config from '@payload-config'
import { TrafficLimitError, enforceW01WriteRateLimit, rateLimitResponse } from '@/auth/traffic-limit'

type PasswordChangeRequest = {
  currentPassword?: unknown
  newPassword?: unknown
}

type AuthUser = {
  id?: string | number
  email?: string
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

const isValidationError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  return /password|validation|invalid|credentials/i.test(message)
}

export async function POST(request: Request): Promise<Response> {
  if (!request.headers.get('Idempotency-Key')?.trim()) {
    return jsonError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required')
  }

  try {
    await enforceW01WriteRateLimit(request)
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return jsonError(503, 'SERVICE_UNAVAILABLE', 'Password change service unavailable')
  }

  let body: PasswordChangeRequest
  try {
    body = (await request.json()) as PasswordChangeRequest
  } catch {
    return jsonError(422, 'VALIDATION_FAILED', 'Invalid password change request')
  }

  if (!assertPasswordPolicy(body.currentPassword) || !assertPasswordPolicy(body.newPassword)) {
    return jsonError(422, 'VALIDATION_FAILED', 'Password does not satisfy the canonical length policy')
  }

  const payload = await getPayload({ config })

  const authResult = await payload.auth({
    headers: request.headers,
    canSetHeaders: false,
  })

  const user = authResult.user as AuthUser | null
  if (!user?.id || typeof user.email !== 'string' || user.email.length === 0) {
    return jsonError(401, 'UNAUTHENTICATED', 'Authentication required')
  }

  try {
    // Payload-native authentication is the credential verifier. No password
    // material is logged or copied into custom persistence.
    const verification = await payload.login({
      collection: 'users',
      data: {
        email: user.email,
        password: body.currentPassword,
      },
    })

    if (String(verification.user?.id ?? '') !== String(user.id)) {
      return jsonError(401, 'UNAUTHENTICATED', 'Authentication required')
    }
  } catch {
    return jsonError(401, 'UNAUTHENTICATED', 'Current password is invalid')
  }

  try {
    // Passing the authenticated user is required so Payload retains the
    // current session and invalidates the other native sessions.
    await payload.update({
      collection: 'users',
      id: user.id,
      data: { password: body.newPassword },
      user,
      overrideAccess: false,
    })
  } catch (error) {
    if (isValidationError(error)) {
      return jsonError(422, 'VALIDATION_FAILED', 'Password change was rejected')
    }

    console.error(
      JSON.stringify({
        event: 'auth.password_change.native_failure',
        diagnosticCode: 'AUTH004_PAYLOAD_PASSWORD_CHANGE_FAILURE',
        errorName: error instanceof Error ? error.name : typeof error,
      }),
    )
    return jsonError(503, 'SERVICE_UNAVAILABLE', 'Password change service unavailable')
  }

  return new Response(null, {
    status: 204,
    headers: {
      'cache-control': 'no-store',
    },
  })
}
