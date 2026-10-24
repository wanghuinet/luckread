import { createLuckReadAuth, type BetterAuthEnv } from './better-auth.js'
import { resolveBetterAuthPrincipal } from './principal.js'
import { readAuthoritativeMfaStatus } from './mfa-status.js'

const json = (body: unknown, status = 200): Response => Response.json(body, {
  status,
  headers: { 'cache-control': 'no-store' },
})

const isTrue = (value: number | boolean | null | undefined): boolean => value === true || value === 1

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

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

  const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
  if (!/^[A-Za-z0-9._:-]{16,255}$/.test(idempotencyKey)) {
    return json({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'valid Idempotency-Key required' } }, 400)
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
      'SELECT u.two_factor_enabled AS userEnabled, ' +
      'u.mfa_enrollment_confirm_key_hash AS confirmationKeyHash, ' +
      'u.mfa_enrollment_confirm_request_hash AS confirmationRequestHash, ' +
      'tf.verified AS factorVerified FROM "user" u ' +
      'LEFT JOIN "twoFactor" tf ON tf.userId = u.id WHERE u.id = ? LIMIT 1',
    ).bind(principal.userId).first<{
      userEnabled: number | boolean
      confirmationKeyHash: string | null
      confirmationRequestHash: string | null
      factorVerified: number | boolean | null
    }>()
    if (!pending || pending.factorVerified === null || pending.factorVerified === undefined) {
      return json({ error: { code: 'ENROLLMENT_NOT_PENDING', message: 'MFA enrollment is not pending' } }, 409)
    }

    const keyHash = await sha256Hex(idempotencyKey)
    // Include the key in the request fingerprint so a replay with the same key
    // and same code can recover status without re-consuming TOTP; never persist
    // the short six-digit code or an unkeyed hash of the code alone.
    const requestHash = await sha256Hex(idempotencyKey + '\0' + (body).code)

    if (isTrue(pending.userEnabled) && isTrue(pending.factorVerified)) {
      if (pending.confirmationKeyHash === keyHash &&
          pending.confirmationRequestHash === requestHash) {
        const status = await readAuthoritativeMfaStatus(env.D1_01, principal.userId)
        if (status?.enabled && status.verified && status.enrolledAt) return json({ data: status })
      }
      return json({
        error: {
          code: pending.confirmationKeyHash === keyHash
            ? 'IDEMPOTENCY_KEY_REUSE_CONFLICT'
            : 'FACTOR_ALREADY_VERIFIED',
          message: 'MFA enrollment confirmation cannot be repeated with different input',
        },
      }, 409)
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
    // The upstream body contains a session token and is deliberately discarded.
    // A rotated session can be delivered only through the HTTP-only Set-Cookie
    // header, and only after the authoritative read-back succeeds.
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

    const stored = await env.D1_01.prepare(
      'UPDATE "user" SET mfa_enrollment_key_hash = NULL, ' +
      'mfa_enrollment_confirm_key_hash = ?, mfa_enrollment_confirm_request_hash = ? ' +
      'WHERE id = ? AND two_factor_enabled = 1 ' +
      'AND EXISTS (SELECT 1 FROM "twoFactor" WHERE userId = ? AND verified = 1)',
    ).bind(keyHash, requestHash, principal.userId, principal.userId).run()
    if (stored.meta.changes !== 1) {
      return json({ error: { code: 'MFA_READBACK_FAILED', message: 'MFA confirmation could not be verified' } }, 503)
    }
    // Better Auth rotates the authenticated session after verified enrollment.
    // Forward only its Set-Cookie headers after D1 read-back and the idempotency
    // marker have succeeded. Never expose the upstream token/body in JSON.
    const response = json({ data: status })
    const upstreamHeaders = verified.headers as Headers & { getSetCookie?: () => string[] }
    const setCookies = typeof upstreamHeaders.getSetCookie === 'function'
      ? upstreamHeaders.getSetCookie.call(verified.headers)
      : (verified.headers.get('set-cookie') ? [verified.headers.get('set-cookie') as string] : [])
    for (const cookie of setCookies) response.headers.append('set-cookie', cookie)
    return response
  } catch {
    return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'MFA confirmation unavailable' } }, 503)
  }
}
