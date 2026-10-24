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
  const verified = isTrue(row.factorVerified)
  const enabled = isTrue(row.userEnabled) && verified && validEnrollment

  return {
    enabled,
    verified,
    enrolledAt: enabled ? new Date(timestamp).toISOString() : null,
  }
}
