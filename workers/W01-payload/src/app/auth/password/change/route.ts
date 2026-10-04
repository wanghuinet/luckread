import { proxyBetterAuth } from '../../../../auth/better-auth-route'
import { TrafficLimitError, enforceW01WriteRateLimit, rateLimitResponse } from '@/auth/traffic-limit'

type PasswordChangeRequest = {
  currentPassword?: unknown
  newPassword?: unknown
}

const jsonError = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
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
    body = (await request.json()) as PasswordChangeRequest
  } catch {
    return jsonError(422, 'VALIDATION_FAILED', 'Invalid password change request')
  }

  if (!assertPasswordPolicy(body.currentPassword) || !assertPasswordPolicy(body.newPassword)) {
    return jsonError(422, 'VALIDATION_FAILED', 'Password does not satisfy the canonical length policy')
  }

  return proxyBetterAuth(request, '/change-password', 'POST', {
    currentPassword: body.currentPassword,
    newPassword: body.newPassword,
    revokeOtherSessions: true,
  })
}
