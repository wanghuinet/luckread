import { createLuckReadAuth, type BetterAuthEnv } from './better-auth.js'
import { resolveBetterAuthPrincipal } from './principal.js'
import { readAuthoritativeMfaStatus } from './mfa-status.js'

const json = (body: unknown, status = 200): Response => Response.json(body, {
  status,
  headers: { 'cache-control': 'no-store' },
})

const isTrue = (value: number | boolean | null | undefined): boolean => value === true || value === 1

/**
 * W02-owned enrollment confirmation. W02 derives the subject from the live
 * session, verifies the pending factor through Better Auth, and returns only
 * a read-back of the authoritative status. The newly enabled factor revokes
 * existing sessions through the D1 lifecycle trigger.
 */
export async function handleMfaEnrollmentConfirmRequest(
  env: BetterAuthEnv,
  request: Request,
): Promise<Response> {
  if (
    request.headers.get('X-LuckRead-Caller') !== 'W01' ||
    request.headers.get('X-LuckRead-Transport-Version') !== '1.0'
  ) {
    return json({ error: { code: 'FORBIDDEN', message: 'authorized W01 service boundary required' } }, 403)
  }

  let principal
  try {
    principal = await resolveBetterAuthPrincipal(env, request)
  } catch {
    return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'MFA confirmation unavailable' } }, 503)
  }
  if (!principal || principal.accountState !== 'ACTIVE') {
    return json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }, 401)
  }

  let body: { code?: unknown }
  try {
    body = await request.json() as typeof body
  } catch {
    return json({ error: { code: 'VALIDATION_FAILED', message: 'invalid MFA confirmation request' } }, 400)
  }
  if (!body || typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) {
    return json({ error: { code: 'VALIDATION_FAILED', message: 'a six-digit TOTP code is required' } }, 400)
  }

  try {
    const pending = await env.D1_01.prepare(
      'SELECT u.two_factor_enabled AS userEnabled, tf.verified AS factorVerified ' +
      'FROM "user" u LEFT JOIN "twoFactor" tf ON tf.userId = u.id WHERE u.id = ? LIMIT 1',
    ).bind(principal.userId).first<{
      userEnabled: number | boolean
      factorVerified: number | boolean | null
    }>()
    if (!pending || pending.factorVerified === null || pending.factorVerified === undefined) {
      return json({ error: { code: 'ENROLLMENT_NOT_PENDING', message: 'MFA enrollment is not pending' } }, 409)
    }
    if (isTrue(pending.userEnabled) || isTrue(pending.factorVerified)) {
      return json({ error: { code: 'FACTOR_ALREADY_VERIFIED', message: 'MFA enrollment must not replace a verified factor' } }, 409)
    }

    const headers = new Headers(request.headers)
    headers.delete('host')
    headers.delete('content-length')
    headers.set('content-type', 'application/json; charset=utf-8')
    const authRequest = new Request('https://luckread.com/api/auth/two-factor/verify-totp', {
      method: 'POST',
      headers,
      body: JSON.stringify({ code: body.code, trustDevice: false }),
    })
    // Never forward the native session token or upstream response body here.
    // Enabling TOTP invalidates current sessions before the factor can be used
    // for privileged authentication.
    const verified = await createLuckReadAuth(env).handler(authRequest)
    if (!verified.ok) {
      if (verified.status === 429) {
        return json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, 429)
      }
      if (verified.status === 401) {
        return json({ error: { code: 'MFA_CODE_INVALID', message: 'MFA confirmation failed' } }, 401)
      }
      if (verified.status >= 500) {
        return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'MFA confirmation unavailable' } }, 503)
      }
      return json({ error: { code: 'MFA_CONFIRM_REJECTED', message: 'MFA confirmation failed' } }, 400)
    }

    const status = await readAuthoritativeMfaStatus(env.D1_01, principal.userId)
    if (!status || !status.enabled || !status.verified || !status.enrolledAt) {
      return json({ error: { code: 'MFA_READBACK_FAILED', message: 'MFA confirmation could not be verified' } }, 503)
    }
    return json({ data: status })
  } catch {
    return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'MFA confirmation unavailable' } }, 503)
  }
}
