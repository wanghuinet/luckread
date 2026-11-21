import {
  getBetterAuthPrincipal,
  getMfaStatus,
  proxyBetterAuth,
  W02AuthClientError,
  type BetterAuthPrincipal,
  type MfaStatusResponse,
} from '../../../auth/w02-session-client.js'
import {
  enforceW01WriteAccountRateLimit,
  enforceW01WriteEndpointRateLimit,
  enforceW01WriteRateLimit,
  rateLimitResponse,
  TrafficLimitError,
} from '../../../auth/traffic-limit.js'

export const mfaError = (status: number, code: string, message: string): Response =>
  Response.json(
    { error: { code, message, details: {} }, requestId: 'req_' + crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
  )

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

export const onlyKeys = (value: Record<string, unknown>, keys: string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key))

export const validPassword = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 1 && value.length <= 128 && value.trim().length > 0

export async function enforceMfaEdgeLimit(request: Request): Promise<Response | null> {
  try {
    await enforceW01WriteRateLimit(request)
    return null
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return mfaError(503, 'SERVICE_UNAVAILABLE', 'MFA service unavailable')
  }
}

export async function activeMfaPrincipal(
  request: Request,
): Promise<{ principal: BetterAuthPrincipal } | { response: Response }> {
  try {
    const principal = await getBetterAuthPrincipal(request)
    if (principal.accountState !== 'ACTIVE') {
      return { response: mfaError(403, 'ACCOUNT_NOT_ACTIVE', 'The account is not eligible for MFA changes') }
    }
    return { principal }
  } catch (error) {
    if (error instanceof W02AuthClientError && error.status === 401) {
      return { response: mfaError(401, 'UNAUTHENTICATED', 'A valid session is required') }
    }
    return { response: mfaError(503, 'SERVICE_UNAVAILABLE', 'MFA service unavailable') }
  }
}

export async function enforceMfaAccountAndEndpointLimits(
  request: Request,
  userId: string,
  operation: string,
): Promise<Response | null> {
  try {
    await enforceW01WriteAccountRateLimit(userId)
    await enforceW01WriteEndpointRateLimit(operation)
    return null
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return mfaError(503, 'SERVICE_UNAVAILABLE', 'MFA service unavailable')
  }
}

export async function enforceMfaEndpointLimit(
  request: Request,
  operation: string,
): Promise<Response | null> {
  try {
    await enforceW01WriteEndpointRateLimit(operation)
    return null
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return mfaError(503, 'SERVICE_UNAVAILABLE', 'MFA service unavailable')
  }
}

export async function requireVerifiedMfa(
  request: Request,
): Promise<{ status: MfaStatusResponse } | { response: Response }> {
  try {
    const status = await getMfaStatus(request)
    if (!status.enabled || !status.verified || !status.enrolledAt) {
      return { response: mfaError(409, 'MFA_NOT_ENABLED', 'A verified MFA factor is required') }
    }
    return { status }
  } catch (error) {
    if (error instanceof W02AuthClientError && error.status === 401) {
      return { response: mfaError(401, 'UNAUTHENTICATED', 'A valid session is required') }
    }
    return { response: mfaError(503, 'SERVICE_UNAVAILABLE', 'MFA service unavailable') }
  }
}

export async function callFactor(
  request: Request,
  path: string,
  body: unknown,
): Promise<Response | { response: Response }> {
  try {
    const response = await proxyBetterAuth(request, path, { body })
    if (response.ok) return response
    if (response.status === 429) {
      return { response: mfaError(429, 'RATE_LIMITED', 'Too many requests') }
    }
    if (response.status === 401) {
      return { response: mfaError(401, 'MFA_VERIFICATION_FAILED', 'MFA verification failed') }
    }
    if (response.status >= 500) {
      return { response: mfaError(503, 'SERVICE_UNAVAILABLE', 'MFA service unavailable') }
    }
    if (response.status === 409) {
      return { response: mfaError(409, 'MFA_STATE_CONFLICT', 'MFA state changed; reload security settings') }
    }
    return { response: mfaError(400, 'MFA_OPERATION_REJECTED', 'MFA operation could not be completed') }
  } catch {
    return { response: mfaError(503, 'SERVICE_UNAVAILABLE', 'MFA service unavailable') }
  }
}
