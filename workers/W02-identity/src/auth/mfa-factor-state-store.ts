import {
  isActiveMfaSubject,
} from './mfa-challenge-account-state.js'
import {
  consumeTotpTimeStep,
} from './totp-replay-guard.js'

export type MfaFactorVerificationMaterial = {
  /** Better Auth encrypted factor secret; never plaintext. */
  encryptedSecret: string
  /** D1 stores TEXT; PostgreSQL returns TIMESTAMPTZ as Date. */
  lockedUntil: Date | string | null
}

/**
 * The small persistence seam used by W02 MFA verification hooks.
 *
 * Implementations may differ by database provider, but must preserve:
 * - W02 account-state authority;
 * - encrypted-secret-only factor reads;
 * - strictly increasing, atomic TOTP time-step reservation.
 *
 * Recovery codes, plaintext secrets, and verification counters are not part
 * of this interface.
 */
export type MfaFactorStateStore = {
  isActiveSubject(userId: string): Promise<boolean>
  readVerificationMaterial(userId: string): Promise<MfaFactorVerificationMaterial | null>
  consumeTotpTimeStep(userId: string, timeStep: number): Promise<boolean>
}

const SUBJECT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

function assertSubject(userId: string): void {
  if (typeof userId !== 'string' || !SUBJECT_PATTERN.test(userId)) {
    throw new TypeError('invalid MFA factor subject')
  }
}

/**
 * Production adapter. It deliberately delegates the established D1 authority
 * and conditional UPDATE implementations without changing their SQL semantics.
 */
export function createD1MfaFactorStateStore(db: D1Database): MfaFactorStateStore {
  return {
    isActiveSubject(userId) {
      return isActiveMfaSubject(db, userId)
    },

    async readVerificationMaterial(userId) {
      assertSubject(userId)
      const row = await db.prepare(
        'SELECT secret, lockedUntil FROM "twoFactor" WHERE userId = ? LIMIT 1',
      ).bind(userId).first<{ secret: string; lockedUntil: string | null }>()
      if (!row) return null
      if (
        typeof row.secret !== 'string' || row.secret.length === 0 ||
        (row.lockedUntil !== null && typeof row.lockedUntil !== 'string')
      ) {
        throw new Error('MFA_FACTOR_VERIFICATION_MATERIAL_INVALID')
      }
      return {
        encryptedSecret: row.secret,
        lockedUntil: row.lockedUntil,
      }
    },

    consumeTotpTimeStep(userId, timeStep) {
      return consumeTotpTimeStep(db, userId, timeStep)
    },
  }
}
