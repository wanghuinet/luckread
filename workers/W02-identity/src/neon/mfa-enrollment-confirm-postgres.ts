import type { Pool } from 'pg'

import type { MfaEnrollmentConfirmStore, MfaEnrollmentConfirmState } from '../auth/mfa-enrollment-confirm-store.js'

const SUBJECT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const HASH_PATTERN = /^[a-f0-9]{64}$/

function assertSubject(userId: string): void {
  if (typeof userId !== 'string' || !SUBJECT_PATTERN.test(userId)) {
    throw new TypeError('invalid MFA enrollment-confirm subject')
  }
}

function assertFingerprint(value: string): void {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new TypeError('invalid MFA enrollment-confirm fingerprint')
  }
}

type EnrollmentConfirmRow = {
  userEnabled: boolean
  confirmationKeyHash: string | null
  confirmationRequestHash: string | null
  factorVerified: boolean | null
}

/**
 * PostgreSQL counterpart of the D1 enrollment-confirm state projection.
 * It reads no factor secret or recovery material and writes only the two
 * request fingerprints after Better Auth has verified the persisted factor.
 */
export function createPostgresMfaEnrollmentConfirmStore(pool: Pool): MfaEnrollmentConfirmStore {
  return {
    async read(userId): Promise<MfaEnrollmentConfirmState | null> {
      assertSubject(userId)
      const result = await pool.query<EnrollmentConfirmRow>(
        'SELECT u.two_factor_enabled AS "userEnabled", ' +
          'u.mfa_enrollment_confirm_key_hash AS "confirmationKeyHash", ' +
          'u.mfa_enrollment_confirm_request_hash AS "confirmationRequestHash", ' +
          'tf.verified AS "factorVerified" FROM "user" u ' +
          'LEFT JOIN "twoFactor" tf ON tf."userId" = u.id WHERE u.id = $1 LIMIT 1',
        [userId],
      )
      const row = result.rows[0]
      if (!row) return null
      if (
        typeof row.userEnabled !== 'boolean' ||
        (row.factorVerified !== null && typeof row.factorVerified !== 'boolean') ||
        (row.confirmationKeyHash !== null && typeof row.confirmationKeyHash !== 'string') ||
        (row.confirmationRequestHash !== null && typeof row.confirmationRequestHash !== 'string')
      ) {
        throw new Error('MFA_ENROLLMENT_CONFIRM_STATE_INVALID')
      }
      return {
        userEnabled: row.userEnabled,
        confirmationKeyHash: row.confirmationKeyHash,
        confirmationRequestHash: row.confirmationRequestHash,
        factorVerified: row.factorVerified,
      }
    },

    async persistConfirmation(input): Promise<boolean> {
      assertSubject(input.userId)
      assertFingerprint(input.keyHash)
      assertFingerprint(input.requestHash)
      const result = await pool.query<{ id: string }>(
        'UPDATE "user" SET mfa_enrollment_key_hash = NULL, ' +
          'mfa_enrollment_confirm_key_hash = $1, mfa_enrollment_confirm_request_hash = $2 ' +
          'WHERE id = $3 AND two_factor_enabled = TRUE ' +
          'AND EXISTS (SELECT 1 FROM "twoFactor" WHERE "userId" = $4 AND verified = TRUE) ' +
          'RETURNING id',
        [input.keyHash, input.requestHash, input.userId, input.userId],
      )
      return result.rowCount === 1 && result.rows[0]?.id === input.userId
    },
  }
}
