import { callW02BetterAuth } from '../../../../auth/w02-auth-client.js'
import { TrafficLimitError, enforceW01WriteRateLimit, rateLimitResponse } from '@/auth/traffic-limit'

type PasswordChangeRequest = {
  currentPassword?: unknown
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
    body = await request.json() as PasswordChangeRequest
  } catch {
    return jsonError(422, 'VALIDATION_FAILED', 'Invalid password change request')
  }

  if (!assertPasswordPolicy(body.currentPassword) || !assertPasswordPolicy(body.newPassword)) {
    return jsonError(422, 'VALIDATION_FAILED', 'Password does not satisfy the canonical length policy')
  }

  try {
    const response = await callW02BetterAuth(request, '/api/auth/change-password', {
      method: 'POST',
      body: {
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
        revokeOtherSessions: true,
      },
    })

    if (response.status === 401) {
      return jsonError(401, 'UNAUTHENTICATED', 'Authentication required')
    }
    if (response.status === 400 || response.status === 422) {
      return jsonError(response.status, 'VALIDATION_FAILED', 'Password change request was rejected')
    }
    if (!response.ok) {
      return jsonError(503, 'SERVICE_UNAVAILABLE', 'Password change service unavailable')
    }

    return new Response(null, {
      status: 204,
      headers: { 'cache-control': 'no-store' },
    })
  } catch {
    return jsonError(503, 'SERVICE_UNAVAILABLE', 'Password change service unavailable')
  }
}
