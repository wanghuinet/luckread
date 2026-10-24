/**
 * Authoritative MFA gate for L5-L8 principals.
 *
 * MFA is accepted only when Better Auth's TOTP plugin marked the account
 * enabled, the current authenticator row is verified, and the current
 * session was created at/after the database-stamped activation instant.
 * Pre-enrollment sessions cannot gain admin privileges merely because MFA
 * was enabled in another session.
 */
export async function requireMfaForPrivilegedAction(
  db: D1Database,
  subjectId: string,
  sessionCreatedAt: Date | string | null | undefined,
): Promise<boolean> {
  if (
    typeof subjectId !== 'string' ||
    subjectId.length < 1 ||
    subjectId.length > 128 ||
    sessionCreatedAt === null ||
    sessionCreatedAt === undefined
  ) return false

  const createdAt = sessionCreatedAt instanceof Date
    ? sessionCreatedAt.toISOString()
    : sessionCreatedAt
  if (typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))) return false

  const assurance = await db.prepare(
    'SELECT u.two_factor_enabled AS enabled, ' +
    'u.two_factor_enabled_at AS enabledAt, tf.verified AS verified ' +
    'FROM "user" AS u LEFT JOIN "twoFactor" AS tf ON tf.userId = u.id ' +
    'WHERE u.id = ? LIMIT 1',
  ).bind(subjectId).first<{
    enabled: number | boolean
    enabledAt: string | null
    verified: number | boolean | null
  }>()

  if (
    !assurance ||
    !(assurance.enabled === true || assurance.enabled === 1) ||
    !(assurance.verified === true || assurance.verified === 1) ||
    typeof assurance.enabledAt !== 'string' ||
    !Number.isFinite(Date.parse(assurance.enabledAt))
  ) return false

  return Date.parse(createdAt) >= Date.parse(assurance.enabledAt)
}

/**
 * The initial L8 setup screen is intentionally restricted to an account that
 * already has the canonical global super_admin assignment. A regular account
 * cannot opt into the app-wide two-factor login challenge and unexpectedly
 * lose compatibility with clients that do not yet implement MFA challenges.
 */
export async function isSuperAdminMfaEnrollmentEligible(
  db: D1Database,
  subjectId: string,
  now = new Date().toISOString(),
): Promise<boolean> {
  if (
    typeof subjectId !== 'string' ||
    subjectId.length < 1 ||
    subjectId.length > 128 ||
    !Number.isFinite(Date.parse(now))
  ) return false

  const assignment = await db.prepare(
    "SELECT id FROM role_assignments WHERE subject_id = ? AND role_id = 'super_admin' " +
    "AND scope_type = 'global' AND scope_id IS NULL AND status = 'ACTIVE' " +
    "AND valid_from <= ? AND (valid_until IS NULL OR ? < valid_until) LIMIT 1",
  ).bind(subjectId, now, now).first<{ id: string }>()

  return !!assignment
}
