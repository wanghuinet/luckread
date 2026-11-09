import type { Pool } from 'pg'
import type { MfaFactorStateStore } from '../auth/mfa-factor-state-store.js'

export type AuthoritativeMfaStatusPostgres = {
  enabled: boolean
  verified: boolean
  enrolledAt: string | null
}

export type MfaFactorVerificationMaterialPostgres = {
  /** Better Auth encrypted factor secret; never plaintext. */
  encryptedSecret: string
  lockedUntil: Date | null
}

type MfaStatusRow = {
  userEnabled: boolean
  enrolledAt: Date | string | null
  factorVerified: boolean | null
}

type FactorVerificationRow = {
  secret: string
  lockedUntil: Date | null
}

const SUBJECT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

function assertSubject(userId: string): void {
  if (typeof userId !== 'string' || !SUBJECT_PATTERN.test(userId)) {
    throw new TypeError('invalid MFA factor subject')
  }
}

function timestampMillis(value: Date | string | null): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') return Date.parse(value)
  return Number.NaN
}

/**
 * PostgreSQL counterpart of the D1 MFA account-state gate.
 * A missing user is not an active subject; database failures remain errors.
 */
export async function isActiveMfaSubjectPostgres(
  pool: Pool,
  userId: string,
): Promise<boolean> {
  assertSubject(userId)
  const result = await pool.query<{ accountState: string | null }>(
    'SELECT account_state AS "accountState" FROM "user" WHERE id = $1 LIMIT 1',
    [userId],
  )
  return result.rows[0]?.accountState === 'ACTIVE'
}

/**
 * Read only the encrypted TOTP factor secret and lockout timestamp needed by
 * the Better Auth before-hook. Recovery codes and counters are deliberately
 * excluded from this projection.
 */
export async function readMfaFactorVerificationMaterialPostgres(
  pool: Pool,
  userId: string,
): Promise<MfaFactorVerificationMaterialPostgres | null> {
  assertSubject(userId)
  const result = await pool.query<FactorVerificationRow>(
    'SELECT secret, "lockedUntil" FROM "twoFactor" WHERE "userId" = $1 LIMIT 1',
    [userId],
  )
  const row = result.rows[0]
  if (!row) return null
  if (typeof row.secret !== 'string' || row.secret.length === 0) {
    throw new Error('MFA_FACTOR_VERIFICATION_MATERIAL_INVALID')
  }
  return {
    encryptedSecret: row.secret,
    lockedUntil: row.lockedUntil ?? null,
  }
}

/**
 * Atomically reserve a strictly increasing RFC 6238 time-step.
 * PostgreSQL's conditional UPDATE is the concurrency authority: of concurrent
 * attempts for the same step, exactly one can return true.
 */
export async function consumeTotpTimeStepPostgres(
  pool: Pool,
  subjectId: string,
  timeStep: number,
): Promise<boolean> {
  assertSubject(subjectId)
  if (!Number.isSafeInteger(timeStep) || timeStep < 0) {
    throw new TypeError('invalid TOTP replay-guard input')
  }

  try {
    const result = await pool.query<{ userId: string }>(
      'UPDATE "twoFactor" SET "lastAcceptedTotpTimeStep" = $1 ' +
        'WHERE "userId" = $2 AND (' +
        '"lastAcceptedTotpTimeStep" IS NULL OR "lastAcceptedTotpTimeStep" < $1' +
        ') RETURNING "userId"',
      [timeStep, subjectId],
    )
    return result.rowCount === 1 && result.rows[0]?.userId === subjectId
  } catch {
    // A storage failure is never equivalent to a replay rejection.
    throw new Error('TOTP_REPLAY_GUARD_PERSISTENCE_FAILED')
  }
}

/**
 * PostgreSQL counterpart of W02's public MFA status projection. The database
 * returns TIMESTAMPTZ as Date; only the minimal status DTO leaves this method.
 */
export async function readAuthoritativeMfaStatusPostgres(
  pool: Pool,
  userId: string,
  now = new Date(),
): Promise<AuthoritativeMfaStatusPostgres | null> {
  assertSubject(userId)
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('invalid MFA status clock')
  }

  const result = await pool.query<MfaStatusRow>(
    'SELECT u.two_factor_enabled AS "userEnabled", u.mfa_enrolled_at AS "enrolledAt", ' +
      'tf.verified AS "factorVerified" ' +
      'FROM "user" u LEFT JOIN "twoFactor" tf ON tf."userId" = u.id ' +
      'WHERE u.id = $1 LIMIT 1',
    [userId],
  )
  const row = result.rows[0]
  if (!row) return null

  const enrolledAtMs = timestampMillis(row.enrolledAt)
  const validEnrollment = Number.isFinite(enrolledAtMs) && enrolledAtMs <= now.getTime()
  const verified = row.factorVerified === true && validEnrollment
  const enabled = row.userEnabled === true && verified

  return {
    enabled,
    verified,
    enrolledAt: enabled ? new Date(enrolledAtMs).toISOString() : null,
  }
}

/**
 * Provider adapter exposed through W02's injectable MFA factor-state port.
 * Keep the SQL helpers above directly reusable by schema/rehearsal checks.
 */
export function createPostgresMfaFactorStateStore(pool: Pool): MfaFactorStateStore {
  return {
    isActiveSubject(userId) {
      return isActiveMfaSubjectPostgres(pool, userId)
    },
    readVerificationMaterial(userId) {
      return readMfaFactorVerificationMaterialPostgres(pool, userId)
    },
    consumeTotpTimeStep(userId, timeStep) {
      return consumeTotpTimeStepPostgres(pool, userId, timeStep)
    },
  }
}
