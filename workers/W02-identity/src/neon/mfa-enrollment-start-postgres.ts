import type { Pool } from 'pg'

import type { MfaAuditEvent } from '../auth/mfa-audit-events.js'
import {
  type MfaEnrollmentStartReservationInput,
  type MfaEnrollmentStartStore,
} from '../auth/mfa-enrollment-start-store.js'
import { recordMfaAuditEventOncePostgres } from './mfa-audit-publication-journal-postgres.js'

const SUBJECT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const HASH_PATTERN = /^[a-f0-9]{64}$/
const EVENT_ID_PATTERN = /^evt_[a-f0-9]{32}$/

function assertReservationInput(input: MfaEnrollmentStartReservationInput): void {
  if (
    !input ||
    typeof input.userId !== 'string' ||
    !SUBJECT_PATTERN.test(input.userId) ||
    typeof input.keyHash !== 'string' ||
    !HASH_PATTERN.test(input.keyHash)
  ) {
    throw new TypeError('invalid PostgreSQL MFA enrollment reservation input')
  }
  const event = input.event
  if (
    !event ||
    !EVENT_ID_PATTERN.test(event.eventId) ||
    event.eventType !== 'auth.mfa.enrollment_started' ||
    event.resourceType !== 'User' ||
    event.resourceId !== input.userId ||
    event.payload?.operationId !== 'authMfaEnrollmentStart' ||
    event.payload?.result !== 'started' ||
    event.payload?.reasonCode !== 'USER_INITIATED' ||
    event.payload?.factorState !== 'PENDING_VERIFICATION' ||
    !Number.isFinite(Date.parse(event.occurredAt)) ||
    !Number.isFinite(Date.parse(event.publishedAt))
  ) {
    throw new TypeError('invalid PostgreSQL MFA enrollment-start audit intent')
  }
}

function failureEventInput(event: MfaAuditEvent) {
  if (
    !event ||
    !EVENT_ID_PATTERN.test(event.eventId) ||
    event.eventType !== 'auth.mfa.enrollment_failed' ||
    event.resourceType !== 'User' ||
    event.payload?.operationId !== 'authMfaEnrollmentStart' ||
    event.payload?.result !== 'failed' ||
    event.payload?.factorState !== 'PENDING_VERIFICATION'
  ) {
    throw new TypeError('invalid PostgreSQL MFA enrollment-failure audit intent')
  }

  return {
    eventType: event.eventType,
    operationId: event.payload.operationId,
    userId: event.resourceId,
    occurredAt: event.occurredAt,
    correlationId: event.correlationId,
    causationId: event.causationId,
    result: event.payload.result,
    ...(event.payload.reasonCode ? { reasonCode: event.payload.reasonCode } : {}),
    ...(event.payload.factorState ? { factorState: event.payload.factorState } : {}),
    idempotencyKey: event.idempotencyKey,
    eventId: event.eventId,
  } as const
}

/**
 * PostgreSQL counterpart of the W02 MFA enrollment reservation.
 *
 * The user-row conditional update and enrollment_started outbox insert are one
 * transaction. Competing enrollment requests can reserve only once, and a
 * failed outbox insert rolls the reservation back. The Better Auth TOTP secret
 * and recovery codes are never written by this adapter.
 */
export async function reserveMfaEnrollmentStartPostgres(
  pool: Pool,
  input: MfaEnrollmentStartReservationInput,
): Promise<boolean> {
  assertReservationInput(input)
  const client = await pool.connect()
  let transactionOpen = false

  try {
    await client.query('BEGIN')
    transactionOpen = true

    const reservation = await client.query<{ id: string }>(
      'UPDATE "user" SET mfa_enrollment_key_hash = $1 ' +
        'WHERE id = $2 AND two_factor_enabled = FALSE AND mfa_enrollment_key_hash IS NULL ' +
        'AND NOT EXISTS (SELECT 1 FROM "twoFactor" WHERE "userId" = $2) ' +
        'RETURNING id',
      [input.keyHash, input.userId],
    )

    if (reservation.rowCount === 0) {
      await client.query('COMMIT')
      transactionOpen = false
      return false
    }
    if (reservation.rowCount !== 1 || reservation.rows[0]?.id !== input.userId) {
      throw new Error('MFA_ENROLLMENT_RESERVATION_WRITE_INCOMPLETE')
    }

    const event = input.event
    const journal = await client.query<{ eventId: string }>(
      'INSERT INTO auth_007_mfa_publication_journal ' +
        '(journal_id, event_id, event_type, schema_version, resource_id, source_version, ' +
        'idempotency_key, payload, status, attempt, next_attempt_at, created_at, published_at, last_error_code) ' +
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING', 1, NULL, $9, NULL, NULL) " +
        'RETURNING event_id AS "eventId"',
      [
        crypto.randomUUID(),
        event.eventId,
        event.eventType,
        event.schemaVersion,
        event.resourceId,
        event.sourceVersion,
        event.idempotencyKey,
        JSON.stringify(event),
        new Date(event.publishedAt),
      ],
    )
    if (journal.rowCount !== 1 || journal.rows[0]?.eventId !== event.eventId) {
      throw new Error('MFA_ENROLLMENT_START_AUDIT_WRITE_INCOMPLETE')
    }

    await client.query('COMMIT')
    transactionOpen = false
    return true
  } catch (error) {
    if (transactionOpen) {
      try { await client.query('ROLLBACK') } catch { /* Preserve the original failure. */ }
    }
    throw error
  } finally {
    client.release()
  }
}

/** Clear only this operation's reservation and only while no TOTP factor exists. */
export async function releaseMfaEnrollmentReservationPostgres(
  pool: Pool,
  userId: string,
  keyHash: string,
): Promise<void> {
  if (
    typeof userId !== 'string' ||
    !SUBJECT_PATTERN.test(userId) ||
    typeof keyHash !== 'string' ||
    !HASH_PATTERN.test(keyHash)
  ) {
    throw new TypeError('invalid PostgreSQL MFA enrollment reservation release input')
  }

  await pool.query(
    'UPDATE "user" SET mfa_enrollment_key_hash = NULL ' +
      'WHERE id = $1 AND mfa_enrollment_key_hash = $2 ' +
      'AND NOT EXISTS (SELECT 1 FROM "twoFactor" WHERE "userId" = $1)',
    [userId, keyHash],
  )
}

export function createPostgresMfaEnrollmentStartStore(pool: Pool): MfaEnrollmentStartStore {
  return {
    reserve: (input) => reserveMfaEnrollmentStartPostgres(pool, input),
    async recordFailure(event) {
      const input = failureEventInput(event)
      await recordMfaAuditEventOncePostgres(pool, input)
    },
    releaseReservationIfNoFactor: (userId, keyHash) =>
      releaseMfaEnrollmentReservationPostgres(pool, userId, keyHash),
  }
}
