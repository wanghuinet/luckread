import {
  buildMfaAuditOutboxInsert,
  type MfaAuditEvent,
} from './mfa-audit-events.js'

export type MfaEnrollmentStartReservationInput = {
  userId: string
  keyHash: string
  event: MfaAuditEvent
}

export interface MfaEnrollmentStartStore {
  reserve(input: MfaEnrollmentStartReservationInput): Promise<boolean>
  recordFailure(event: MfaAuditEvent): Promise<void>
  releaseReservationIfNoFactor(userId: string, keyHash: string): Promise<void>
}

const SUBJECT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const HASH_PATTERN = /^[a-f0-9]{64}$/

function assertReservationInput(input: MfaEnrollmentStartReservationInput): void {
  if (
    !input ||
    typeof input.userId !== 'string' ||
    !SUBJECT_PATTERN.test(input.userId) ||
    typeof input.keyHash !== 'string' ||
    !HASH_PATTERN.test(input.keyHash)
  ) {
    throw new TypeError('invalid MFA enrollment reservation input')
  }
  assertStartedEvent(input.event, input.userId)
}

function assertStartedEvent(event: MfaAuditEvent, userId: string): void {
  if (
    !event ||
    event.eventType !== 'auth.mfa.enrollment_started' ||
    event.resourceType !== 'User' ||
    event.resourceId !== userId ||
    event.payload?.operationId !== 'authMfaEnrollmentStart' ||
    event.payload?.result !== 'started' ||
    event.payload?.reasonCode !== 'USER_INITIATED' ||
    event.payload?.factorState !== 'PENDING_VERIFICATION'
  ) {
    throw new TypeError('invalid MFA enrollment-start audit intent')
  }
}

/**
 * D1 remains the production-default MFA enrollment reservation store.
 * Reservation and the secret-free enrollment_started audit outbox row are
 * committed in one D1 batch; the outbox insert is conditional on the exact
 * reservation update changing one user row.
 */
export function createD1MfaEnrollmentStartStore(db: D1Database): MfaEnrollmentStartStore {
  return {
    async reserve(input) {
      assertReservationInput(input)
      const result = await db.batch([
        db.prepare(
          'UPDATE "user" SET mfa_enrollment_key_hash = ? ' +
            'WHERE id = ? AND two_factor_enabled = 0 AND mfa_enrollment_key_hash IS NULL ' +
            'AND NOT EXISTS (SELECT 1 FROM "twoFactor" WHERE userId = ?)',
        ).bind(input.keyHash, input.userId, input.userId),
        buildMfaAuditOutboxInsert(db, input.event, { onlyWhenPreviousStatementChanged: true }),
      ])
      if (
        result.length !== 2 ||
        result.some((entry) => entry?.success !== true) ||
        !Number.isInteger(result[0]?.meta?.changes) ||
        !Number.isInteger(result[1]?.meta?.changes)
      ) {
        throw new Error('MFA_ENROLLMENT_RESERVATION_BATCH_FAILED')
      }
      const reserved = result[0]!.meta!.changes === 1
      const journaled = result[1]!.meta!.changes === 1
      if (reserved !== journaled) {
        throw new Error('MFA_ENROLLMENT_RESERVATION_AUDIT_INCOMPLETE')
      }
      return reserved
    },

    async recordFailure(event) {
      if (
        !event ||
        event.eventType !== 'auth.mfa.enrollment_failed' ||
        event.payload?.operationId !== 'authMfaEnrollmentStart' ||
        event.payload?.result !== 'failed' ||
        event.payload?.factorState !== 'PENDING_VERIFICATION'
      ) {
        throw new TypeError('invalid MFA enrollment-failure audit intent')
      }
      const result = await buildMfaAuditOutboxInsert(db, event).run()
      if (result.success !== true || result.meta?.changes !== 1) {
        throw new Error('MFA_ENROLLMENT_FAILURE_AUDIT_WRITE_FAILED')
      }
    },

    async releaseReservationIfNoFactor(userId, keyHash) {
      if (
        typeof userId !== 'string' ||
        !SUBJECT_PATTERN.test(userId) ||
        typeof keyHash !== 'string' ||
        !HASH_PATTERN.test(keyHash)
      ) {
        throw new TypeError('invalid MFA enrollment reservation release input')
      }
      const result = await db.prepare(
        'UPDATE "user" SET mfa_enrollment_key_hash = NULL ' +
          'WHERE id = ? AND mfa_enrollment_key_hash = ? ' +
          'AND NOT EXISTS (SELECT 1 FROM "twoFactor" WHERE userId = ?)',
      ).bind(userId, keyHash, userId).run()
      if (result.success !== true) {
        throw new Error('MFA_ENROLLMENT_RESERVATION_RELEASE_FAILED')
      }
    },
  }
}
