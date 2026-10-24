import {
  confirmMfaEnrollment,
  getBetterAuthPrincipal,
  W02AuthClientError,
} from '../../../../../auth/w02-session-client.js'
import {
  enforceW01WriteAccountRateLimit,
  enforceW01WriteEndpointRateLimit,
  enforceW01WriteRateLimit,
  rateLimitResponse,
  TrafficLimitError,
} from '../../../../../auth/traffic-limit.js'

const errorResponse = (status: number, code: string, message: string): Response =>
  Response.json(
    { error: { code, message, details: {} }, requestId: 'req_' + crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
  )

export async function POST(request: Request): Promise<Response> {
  try {
    await enforceW01WriteRateLimit(request)
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'MFA confirmation unavailable')
  }

  let body: { code?: unknown }
  try {
    body = await request.json() as typeof body
  } catch {
    return errorResponse(422, 'VALIDATION_FAILED', 'Invalid MFA confirmation request')
  }
  if (!body || Object.keys(body).some((key) => key !== 'code') ||
      typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) {
    return errorResponse(422, 'VALIDATION_FAILED', 'A six-digit TOTP code is required')
  }

  let principal
  try {
    principal = await getBetterAuthPrincipal(request)
  } catch (error) {
    if (error instanceof W02AuthClientError && error.status === 401) {
      return errorResponse(401, 'UNAUTHENTICATED', 'A valid session is required')
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'MFA confirmation unavailable')
  }
  if (principal.accountState !== 'ACTIVE') {
    return errorResponse(403, 'ACCOUNT_NOT_ACTIVE', 'The account is not eligible for MFA changes')
  }

  try {
    await enforceW01WriteAccountRateLimit(principal.userId)
    await enforceW01WriteEndpointRateLimit('authMfaEnrollmentConfirm')
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'MFA confirmation unavailable')
  }

  try {
    const data = await confirmMfaEnrollment(request, body.code)
    return Response.json(
      { data, requestId: 'req_' + crypto.randomUUID() },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    )
  } catch (error) {
    if (error instanceof W02AuthClientError) {
      if (error.status === 401) return errorResponse(401, 'MFA_CODE_INVALID', 'MFA confirmation failed')
      if (error.status === 403) return errorResponse(403, 'ACCOUNT_NOT_ACTIVE', 'The account is not eligible for MFA changes')
      if (error.status === 409) return errorResponse(409, 'MFA_ENROLLMENT_CONFLICT', 'MFA enrollment is not pending or a factor is already enabled')
      if (error.status === 429) return errorResponse(429, 'RATE_LIMITED', 'Too many requests')
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'MFA confirmation unavailable')
  }
}
