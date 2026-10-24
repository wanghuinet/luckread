import { callW02 } from '../../../../auth/w02-session-client.js'
import {
  enforceW01WriteEndpointRateLimit,
  enforceW01WriteRateLimit,
  rateLimitResponse,
  TrafficLimitError,
} from '../../../../auth/traffic-limit.js'

const errorResponse = (status: number, code: string, message: string): Response =>
  Response.json(
    { error: { code, message, details: {} }, requestId: 'req_' + crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
  )

const isCurrentPassword = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 1 && value.length <= 128 && value.trim().length > 0

export async function POST(request: Request): Promise<Response> {
  // W01 owns public ingress and edge throttling. The W02 internal operation
  // performs identity checks, per-account throttling and factor mutation in
  // one Service Binding call; W01 does not perform a second principal lookup.
  try {
    await enforceW01WriteRateLimit(request)
    await enforceW01WriteEndpointRateLimit('authMfaEnrollmentStart')
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'MFA enrollment service unavailable')
  }

  const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
  if (!/^[A-Za-z0-9._:-]{16,255}$/.test(idempotencyKey)) {
    return errorResponse(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key is required')
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse(422, 'VALIDATION_FAILED', 'Invalid MFA enrollment request')
  }
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => key !== 'currentPassword') ||
    !isCurrentPassword((body as { currentPassword?: unknown }).currentPassword)
  ) {
    return errorResponse(422, 'VALIDATION_FAILED', 'Current password is required')
  }

  try {
    const upstream = await callW02('/internal/auth/mfa/enrollment/start', {
      request,
      body: { currentPassword: (body as { currentPassword: string }).currentPassword },
      headers: {
        'X-LuckRead-Caller': 'W01',
        'X-LuckRead-Transport-Version': '1.0',
        'Idempotency-Key': idempotencyKey,
      },
    })
    let payload: unknown = null
    try { payload = await upstream.json() } catch {}
    if (!upstream.ok) {
      const status = upstream.status
      if (status === 401) return errorResponse(401, 'UNAUTHENTICATED', 'A valid session is required')
      if (status === 403) return errorResponse(403, 'ACCOUNT_NOT_ACTIVE', 'The account is not eligible for MFA changes')
      if (status === 409) return errorResponse(409, 'MFA_ENROLLMENT_CONFLICT', 'MFA enrollment is already pending or enabled')
      if (status === 429) return errorResponse(429, 'RATE_LIMITED', 'Too many requests')
      if (status >= 500) return errorResponse(503, 'SERVICE_UNAVAILABLE', 'MFA enrollment service unavailable')
      return errorResponse(400, 'MFA_ENROLLMENT_REJECTED', 'MFA enrollment could not be started')
    }
    const data = payload && typeof payload === 'object'
      ? (payload as { data?: unknown }).data
      : null
    if (
      !data || typeof data !== 'object' ||
      typeof (data as { totpUri?: unknown }).totpUri !== 'string' ||
      !(data as { totpUri: string }).totpUri.startsWith('otpauth://totp/') ||
      !Array.isArray((data as { recoveryCodes?: unknown }).recoveryCodes) ||
      (data as { recoveryCodes: unknown[] }).recoveryCodes.length < 1 ||
      (data as { recoveryCodes: unknown[] }).recoveryCodes.length > 32 ||
      !(data as { recoveryCodes: unknown[] }).recoveryCodes.every(
        (code) => typeof code === 'string' && code.length >= 1 && code.length <= 128,
      )
    ) {
      return errorResponse(503, 'SERVICE_UNAVAILABLE', 'MFA enrollment service unavailable')
    }

    return Response.json(
      { data, requestId: 'req_' + crypto.randomUUID() },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    )
  } catch {
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'MFA enrollment service unavailable')
  }
}
