import { resolveBetterAuthPrincipal } from './principal.js'
import type { BetterAuthEnv } from './better-auth.js'

export type AuthoritativeMfaStatus = {
  enabled: boolean
  verified: boolean
  enrolledAt: string | null
}

type MfaStatusRow = {
  userEnabled: number | boolean
  enrolledAt: string | null
  factorVerified: number | boolean | null
}

const isTrue = (value: number | boolean | null | undefined): boolean =>
  value === true || value === 1

/**
 * Reads only the public MFA status projection from W02's authoritative D1-01.
 * Never returns factor secrets, backup codes, lockout counters or replay state.
 * A partial or stale database state does not establish MFA assurance.
 */
export async function readAuthoritativeMfaStatus(
  db: D1Database,
  userId: string,
  now = new Date(),
): Promise<AuthoritativeMfaStatus | null> {
  if (typeof userId !== 'string' || userId.length < 1 || userId.length > 128) {
    throw new TypeError('invalid MFA status subject')
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('invalid MFA status clock')
  }

  const row = await db.prepare(
    'SELECT u.two_factor_enabled AS userEnabled, u.mfa_enrolled_at AS enrolledAt, ' +
    'tf.verified AS factorVerified FROM "user" u ' +
    'LEFT JOIN "twoFactor" tf ON tf.userId = u.id WHERE u.id = ? LIMIT 1',
  ).bind(userId).first<MfaStatusRow>()

  if (!row) return null

  const timestamp = typeof row.enrolledAt === 'string' ? Date.parse(row.enrolledAt) : Number.NaN
  const validEnrollment = Number.isFinite(timestamp) && timestamp <= now.getTime()
  // A factor verification bit alone is insufficient if the authoritative
  // enrollment timestamp is missing, invalid, or in the future.
  const verified = isTrue(row.factorVerified) && validEnrollment
  const enabled = isTrue(row.userEnabled) && verified

  return {
    enabled,
    verified,
    enrolledAt: enabled ? new Date(timestamp).toISOString() : null,
  }
}


const response = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

/**
 * Private W02 handler for a W01-originated status read.
 * Identity is derived from the real Better Auth session; no user ID is accepted
 * from the request body or query string.
 */
export async function handleMfaStatusRequest(
  env: BetterAuthEnv,
  request: Request,
): Promise<Response> {
  if (
    request.headers.get('X-LuckRead-Caller') !== 'W01' ||
    request.headers.get('X-LuckRead-Transport-Version') !== '1.0'
  ) {
    return response({ error: { code: 'FORBIDDEN', message: 'authorized W01 service boundary required' } }, 403)
  }

  try {
    const principal = await resolveBetterAuthPrincipal(env, request)
    if (!principal || principal.accountState !== 'ACTIVE') {
      return response({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }, 401)
    }
    const status = await readAuthoritativeMfaStatus(env.D1_01, principal.userId)
    if (!status) return response({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }, 401)
    return response({ data: status })
  } catch {
    // AUTH-007 schema is still gated; a missing table or failed read is a
    // closed service failure, never an inferred "MFA disabled" response.
    return response({ error: { code: 'SERVICE_UNAVAILABLE', message: 'MFA status unavailable' } }, 503)
  }
}
