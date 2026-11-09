export type MfaEnrollmentConfirmState = {
  userEnabled: boolean
  confirmationKeyHash: string | null
  confirmationRequestHash: string | null
  factorVerified: boolean | null
}

export type MfaEnrollmentConfirmStore = {
  read(userId: string): Promise<MfaEnrollmentConfirmState | null>
  persistConfirmation(input: {
    userId: string
    keyHash: string
    requestHash: string
  }): Promise<boolean>
}

const SUBJECT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const HASH_PATTERN = /^[a-f0-9]{64}$/

function assertSubject(userId: string): void {
  if (typeof userId !== 'string' || !SUBJECT_PATTERN.test(userId)) {
    throw new TypeError('invalid MFA enrollment-confirm subject')
  }
}

function assertConfirmationInput(input: {
  userId: string
  keyHash: string
  requestHash: string
}): void {
  assertSubject(input.userId)
  if (!HASH_PATTERN.test(input.keyHash) || !HASH_PATTERN.test(input.requestHash)) {
    throw new TypeError('invalid MFA enrollment-confirm fingerprint')
  }
}

function toBoolean(value: boolean | number): boolean {
  if (value === true || value === 1) return true
  if (value === false || value === 0) return false
  throw new Error('MFA_ENROLLMENT_CONFIRM_STATE_INVALID')
}

function mapState(row: {
  userEnabled: boolean | number
  confirmationKeyHash: string | null
  confirmationRequestHash: string | null
  factorVerified: boolean | number | null
}): MfaEnrollmentConfirmState {
  if (
    (row.confirmationKeyHash !== null && typeof row.confirmationKeyHash !== 'string') ||
    (row.confirmationRequestHash !== null && typeof row.confirmationRequestHash !== 'string')
  ) {
    throw new Error('MFA_ENROLLMENT_CONFIRM_STATE_INVALID')
  }
  return {
    userEnabled: toBoolean(row.userEnabled),
    confirmationKeyHash: row.confirmationKeyHash,
    confirmationRequestHash: row.confirmationRequestHash,
    factorVerified: row.factorVerified === null ? null : toBoolean(row.factorVerified),
  }
}

/**
 * D1 remains the production-default enrollment-confirm state store.
 * The read is a secret-free projection; the final marker update is conditional
 * on the authoritative Better Auth factor already being verified.
 */
export function createD1MfaEnrollmentConfirmStore(db: D1Database): MfaEnrollmentConfirmStore {
  return {
    async read(userId) {
      assertSubject(userId)
      const row = await db.prepare(
        'SELECT u.two_factor_enabled AS userEnabled, ' +
          'u.mfa_enrollment_confirm_key_hash AS confirmationKeyHash, ' +
          'u.mfa_enrollment_confirm_request_hash AS confirmationRequestHash, ' +
          'tf.verified AS factorVerified FROM "user" u ' +
          'LEFT JOIN "twoFactor" tf ON tf.userId = u.id WHERE u.id = ? LIMIT 1',
      ).bind(userId).first<{
        userEnabled: boolean | number
        confirmationKeyHash: string | null
        confirmationRequestHash: string | null
        factorVerified: boolean | number | null
      }>()
      return row ? mapState(row) : null
    },

    async persistConfirmation(input) {
      assertConfirmationInput(input)
      const result = await db.prepare(
        'UPDATE "user" SET mfa_enrollment_key_hash = NULL, ' +
          'mfa_enrollment_confirm_key_hash = ?, mfa_enrollment_confirm_request_hash = ? ' +
          'WHERE id = ? AND two_factor_enabled = 1 ' +
          'AND mfa_enrollment_key_hash IS NOT NULL ' +
          'AND mfa_enrollment_confirm_key_hash IS NULL ' +
          'AND mfa_enrollment_confirm_request_hash IS NULL ' +
          'AND EXISTS (SELECT 1 FROM "twoFactor" WHERE userId = ? AND verified = 1)',
      ).bind(input.keyHash, input.requestHash, input.userId, input.userId).run()
      if (result.success !== true) throw new Error('MFA_ENROLLMENT_CONFIRM_MARKER_WRITE_FAILED')
      return result.meta?.changes === 1
    },
  }
}
