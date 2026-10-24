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
