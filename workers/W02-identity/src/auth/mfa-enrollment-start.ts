import { createLuckReadAuth, type BetterAuthEnv } from './better-auth.js'
import { buildMfaAuditEvent } from './mfa-audit-events.js'
import {
  createD1MfaEnrollmentStartStore,
  type MfaEnrollmentStartStore,
} from './mfa-enrollment-start-store.js'
import { resolveBetterAuthPrincipal, type AuthenticatedPrincipal } from './principal.js'

export type MfaEnrollmentStartHandlerDependencies = {
  store?: MfaEnrollmentStartStore
  auth?: ReturnType<typeof createLuckReadAuth>
  resolvePrincipal?: (
    env: BetterAuthEnv,
    request: Request,
  ) => Promise<Pick<AuthenticatedPrincipal, 'userId' | 'accountState'> | null>
}

const json = (body: unknown, status = 200): Response => Response.json(body, {
  status,
  headers: { 'cache-control': 'no-store' },
})

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * One W01 -> W02 call for MFA enrollment start. W02 owns the principal,
 * account-level throttling, single-pending-factor guard and Better Auth write.
 * The idempotency key is stored only as a hash on the W02 identity row; retries
 * never replace a factor or redisclose recovery codes.
 */
export async function handleMfaEnrollmentStartRequest(
  env: BetterAuthEnv,
  request: Request,
  dependencies: MfaEnrollmentStartHandlerDependencies = {},
): Promise<Response> {
  if (
    request.headers.get('X-LuckRead-Caller') !== 'W01' ||
    request.headers.get('X-LuckRead-Transport-Version') !== '1.0'
  ) {
    return json({ error: { code: 'FORBIDDEN', message: 'authorized W01 service boundary required' } }, 403)
  }

  const key = request.headers.get('Idempotency-Key')?.trim() ?? ''
  if (!/^[A-Za-z0-9._:-]{16,255}$/.test(key)) {
    return json({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'valid Idempotency-Key required' } }, 400)
  }

  let body: unknown
  try { body = await request.json() } catch {
    return json({ error: { code: 'VALIDATION_FAILED', message: 'invalid enrollment request' } }, 400)
  }
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((name) => name !== 'currentPassword') ||
    typeof (body as { currentPassword?: unknown }).currentPassword !== 'string' ||
    !(body as { currentPassword: string }).currentPassword.trim() ||
    (body as { currentPassword: string }).currentPassword.length > 128
  ) {
    return json({ error: { code: 'VALIDATION_FAILED', message: 'current password required' } }, 400)
  }

  let principal
  try {
    const resolvePrincipal = dependencies.resolvePrincipal ?? resolveBetterAuthPrincipal
    principal = await resolvePrincipal(env, request)
  } catch {
    return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'MFA enrollment unavailable' } }, 503)
  }
  if (!principal) return json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }, 401)
  if (principal.accountState !== 'ACTIVE') {
    return json({ error: { code: 'ACCOUNT_NOT_ACTIVE', message: 'Account is not eligible for MFA changes' } }, 403)
  }

  const limiter = env.AUTH_SESSION_WRITE_LIMITER
  if (!limiter) return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'MFA enrollment unavailable' } }, 503)
  try {
    const limited = await limiter.limit({ key: 'auth-mfa-enrollment-start:' + principal.userId })
    if (!limited.success) return json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, 429)
  } catch {
    return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'MFA enrollment unavailable' } }, 503)
  }

  const keyHash = await sha256Hex(key)
  const startedAt = new Date().toISOString()
  const startedEvent = buildMfaAuditEvent({
    eventType: 'auth.mfa.enrollment_started',
    userId: principal.userId,
    occurredAt: startedAt,
    correlationId: request.headers.get('X-LuckRead-Correlation-Id'),
    causationId: request.headers.get('X-LuckRead-Request-Id'),
    result: 'started',
    reasonCode: 'USER_INITIATED',
    factorState: 'PENDING_VERIFICATION',
  })
  const store = dependencies.store ?? createD1MfaEnrollmentStartStore(env.D1_01)
  let reserved = false
  try {
    reserved = await store.reserve({
      userId: principal.userId,
      keyHash,
      event: startedEvent,
    })
  } catch {
    return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'MFA enrollment unavailable' } }, 503)
  }
  if (!reserved) {
    return json({ error: { code: 'MFA_ENROLLMENT_CONFLICT', message: 'MFA enrollment is already pending or enabled' } }, 409)
  }

  const recordEnrollmentFailure = async (reasonCode: string): Promise<void> => {
    try {
      await store.recordFailure(buildMfaAuditEvent({
        eventType: 'auth.mfa.enrollment_failed',
        operationId: 'authMfaEnrollmentStart',
        userId: principal.userId,
        occurredAt: new Date().toISOString(),
        correlationId: request.headers.get('X-LuckRead-Correlation-Id'),
        causationId: request.headers.get('X-LuckRead-Request-Id'),
        result: 'failed',
        reasonCode,
        factorState: 'PENDING_VERIFICATION',
      }))
    } catch {
      // The durable enrollment_started event remains as evidence of the attempt.
    }
  }

  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.delete('content-length')
  headers.set('content-type', 'application/json; charset=utf-8')
  const authRequest = new Request('https://luckread.com/api/auth/two-factor/enable', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      password: (body as { currentPassword: string }).currentPassword,
      method: 'totp',
    }),
  })

  let upstream: Response
  try {
    upstream = await (dependencies.auth ?? createLuckReadAuth(env)).handler(authRequest)
  } catch {
    await recordEnrollmentFailure('UPSTREAM_UNAVAILABLE')
    await store.releaseReservationIfNoFactor(principal.userId, keyHash)
    return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'MFA enrollment unavailable' } }, 503)
  }

  if (!upstream.ok) {
    // If Better Auth inserted a factor before returning an error, keep the
    // reservation and fail closed rather than allowing a second secret issue.
    await recordEnrollmentFailure(upstream.status === 429 ? 'UPSTREAM_RATE_LIMITED' :
      upstream.status === 401 ? 'REAUTHENTICATION_REQUIRED' :
      upstream.status >= 500 ? 'UPSTREAM_UNAVAILABLE' : 'UPSTREAM_REJECTED')
    await store.releaseReservationIfNoFactor(principal.userId, keyHash)
    const status = upstream.status === 429 ? 429 : upstream.status === 401 ? 401 :
      upstream.status >= 500 ? 503 : 400
    return json({
      error: {
        code: status === 401 ? 'UNAUTHENTICATED' :
          status === 429 ? 'RATE_LIMITED' :
          status === 503 ? 'SERVICE_UNAVAILABLE' : 'MFA_ENROLLMENT_REJECTED',
        message: status === 503 ? 'MFA enrollment unavailable' :
          status === 401 ? 'Authentication required' :
          status === 429 ? 'Too many requests' : 'MFA enrollment could not be started',
      },
    }, status)
  }

  let payload: unknown
  try { payload = await upstream.json() } catch {
    await recordEnrollmentFailure('UPSTREAM_RESPONSE_INVALID')
    return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'MFA enrollment unavailable' } }, 503)
  }
  const value = payload && typeof payload === 'object'
    ? payload as { method?: unknown; totpURI?: unknown; backupCodes?: unknown }
    : null
  if (
    value?.method !== 'totp' ||
    typeof value.totpURI !== 'string' ||
    !value.totpURI.startsWith('otpauth://totp/') ||
    !Array.isArray(value.backupCodes) ||
    value.backupCodes.length < 1 ||
    value.backupCodes.length > 32 ||
    !value.backupCodes.every((code) => typeof code === 'string' && code.length >= 1 && code.length <= 128)
  ) {
    await recordEnrollmentFailure('UPSTREAM_RESPONSE_INVALID')
    return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'MFA enrollment unavailable' } }, 503)
  }

  return json({ data: { totpUri: value.totpURI, recoveryCodes: value.backupCodes } })
}

