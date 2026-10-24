import {
  getBetterAuthPrincipal,
  proxyBetterAuth,
  W02AuthClientError,
} from '../../../../auth/w02-session-client.js'
import {
  enforceW01WriteAccountRateLimit,
  enforceW01WriteEndpointRateLimit,
  enforceW01WriteRateLimit,
  rateLimitResponse,
  TrafficLimitError,
} from '../../../../auth/traffic-limit.js'

const jsonError = (status: number, code: string, message: string): Response =>
  Response.json(
    { error: { code, message, details: {} }, requestId: 'req_' + crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
  )

const isCurrentPassword = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 1 && value.length <= 128 && value.trim().length > 0

export async function POST(request: Request): Promise<Response> {
  // Apply edge/origin controls before parsing credentials or invoking W02.
  try {
    await enforceW01WriteRateLimit(request)
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return jsonError(503, 'SERVICE_UNAVAILABLE', 'MFA enrollment service unavailable')
  }

  let body: { currentPassword?: unknown }
  try {
    body = await request.json() as typeof body
  } catch {
    return jsonError(422, 'VALIDATION_FAILED', 'Invalid MFA enrollment request')
  }
  if (!body || !isCurrentPassword(body.currentPassword)) {
    return jsonError(422, 'VALIDATION_FAILED', 'Current password is required')
  }

  // W02 derives identity from the real Better Auth session; never accept a
  // client-supplied user ID or an MFA-assurance boolean.
  let principal
  try {
    principal = await getBetterAuthPrincipal(request)
  } catch (error) {
    if (error instanceof W02AuthClientError && error.status === 401) {
      return jsonError(401, 'UNAUTHENTICATED', 'A valid session is required')
    }
    return jsonError(503, 'SERVICE_UNAVAILABLE', 'MFA enrollment service unavailable')
  }
  if (principal.accountState !== 'ACTIVE') {
    return jsonError(403, 'ACCOUNT_NOT_ACTIVE', 'The account is not eligible for MFA changes')
  }

  try {
    await enforceW01WriteAccountRateLimit(principal.userId)
    await enforceW01WriteEndpointRateLimit('authMfaEnrollmentStart')
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return jsonError(503, 'SERVICE_UNAVAILABLE', 'MFA enrollment service unavailable')
  }

  try {
    // W01 exposes a dedicated DTO; the raw Better Auth endpoint remains an
    // internal W01 -> W02 service-binding operation, not a public route.
    const upstream = await proxyBetterAuth(request, '/two-factor/enable', {
      body: { password: body.currentPassword, method: 'totp' },
    })
    if (!upstream.ok) {
      if (upstream.status === 401) {
        return jsonError(401, 'UNAUTHENTICATED', 'A valid session is required')
      }
      if (upstream.status === 429) {
        return jsonError(429, 'RATE_LIMITED', 'Too many requests')
      }
      if (upstream.status >= 500) {
        return jsonError(503, 'SERVICE_UNAVAILABLE', 'MFA enrollment service unavailable')
      }
      // Do not echo Better Auth internals or disclose factor-storage state.
      return jsonError(400, 'MFA_ENROLLMENT_REJECTED', 'MFA enrollment could not be started')
    }

    let payload: unknown
    try { payload = await upstream.json() } catch {
      return jsonError(503, 'SERVICE_UNAVAILABLE', 'MFA enrollment service unavailable')
    }
    if (!payload || typeof payload !== 'object') {
      return jsonError(503, 'SERVICE_UNAVAILABLE', 'MFA enrollment service unavailable')
    }
    const data = payload as { method?: unknown; totpURI?: unknown; backupCodes?: unknown }
    if (
      data.method !== 'totp' ||
      typeof data.totpURI !== 'string' ||
      !data.totpURI.startsWith('otpauth://totp/') ||
      !Array.isArray(data.backupCodes) ||
      data.backupCodes.length < 1 ||
      data.backupCodes.length > 32 ||
      !data.backupCodes.every((code) => typeof code === 'string' && code.length >= 1 && code.length <= 128)
    ) {
      return jsonError(503, 'SERVICE_UNAVAILABLE', 'MFA enrollment service unavailable')
    }

    // This is the one-time disclosure of the TOTP URI and recovery codes.
    // Neither the upstream body nor credentials are logged or cached.
    return Response.json({
      data: { totpUri: data.totpURI, recoveryCodes: data.backupCodes },
      requestId: 'req_' + crypto.randomUUID(),
    }, { status: 200, headers: { 'cache-control': 'no-store' } })
  } catch {
    return jsonError(503, 'SERVICE_UNAVAILABLE', 'MFA enrollment service unavailable')
  }
}
