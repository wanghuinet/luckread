import type { Pool } from 'pg'
import {
  assertSessionRevokedEvent,
  type SessionRevokedEvent,
} from '../auth/session-revocation-events.js'

export type SessionRevocationPostgresInput = {
  userId: string
  sessionId: string
  now: string
  event: SessionRevokedEvent
}

export type SessionRevocationPostgresResult =
  | { status: 'REVOKED' }
  | { status: 'NOT_FOUND_OR_NOT_OWNED' }
  | { status: 'PERMISSION_DENIED' }

const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

function validateInput(input: SessionRevocationPostgresInput): void {
  if (
    !input ||
    typeof input.userId !== 'string' ||
    !RESOURCE_ID.test(input.userId) ||
    typeof input.sessionId !== 'string' ||
    !RESOURCE_ID.test(input.sessionId) ||
    typeof input.now !== 'string' ||
    !Number.isFinite(Date.parse(input.now)) ||
    new Date(input.now).toISOString() !== input.now
  ) {
    throw new TypeError('invalid PostgreSQL session revocation input')
  }
}

/**
 * PostgreSQL-native AUTH-010 persistence adapter.
 *
 * The caller must authenticate the Better Auth session and enforce the
 * existing rate limits before calling this repository. This method rechecks
 * the effective base-user assignment while holding row locks, then deletes
 * only a session owned by the authenticated subject and writes its immutable
 * audit outbox intent in the same PostgreSQL transaction.
 *
 * This adapter is deliberately not wired to the production Worker yet.
 */
export async function revokeUserSessionPostgres(
  pool: Pool,
  input: SessionRevocationPostgresInput,
): Promise<SessionRevocationPostgresResult> {
  validateInput(input)

  const event = await assertSessionRevokedEvent(input.event)
  if (event.actor.actorId !== input.userId || event.resourceId !== input.sessionId) {
    throw new TypeError('session revocation event subject does not match command')
  }

  const client = await pool.connect()
  let transactionOpen = false

  try {
    await client.query('BEGIN')
    transactionOpen = true

    // Lock the authority rows so account suspension or role revocation cannot
    // race between authorization and session deletion.
    const authorization = await client.query<{ id: string }>(
      'SELECT assignment.id ' +
        'FROM "user" AS account ' +
        'INNER JOIN role_assignments AS assignment ON assignment.subject_id = account.id ' +
        'WHERE account.id = $1 ' +
        "AND account.account_state IN ('PENDING_VERIFICATION', 'ACTIVE') " +
        "AND assignment.role_id = 'user' " +
        "AND assignment.scope_type = 'global' " +
        'AND assignment.scope_id IS NULL ' +
        "AND assignment.status = 'ACTIVE' " +
        'AND assignment.valid_from <= $2 ' +
        'AND (assignment.valid_until IS NULL OR $2 < assignment.valid_until) ' +
        'FOR SHARE OF account, assignment',
      [input.userId, input.now],
    )

    if (authorization.rowCount !== 1) {
      await client.query('COMMIT')
      transactionOpen = false
      return { status: 'PERMISSION_DENIED' }
    }

    // Serialize duplicate revocations of the same caller-owned session.
    const target = await client.query<{ id: string }>(
      'SELECT id FROM "session" WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [input.sessionId, input.userId],
    )
    if (target.rowCount !== 1) {
      await client.query('COMMIT')
      transactionOpen = false
      return { status: 'NOT_FOUND_OR_NOT_OWNED' }
    }

    const deleted = await client.query<{ id: string }>(
      'DELETE FROM "session" WHERE id = $1 AND user_id = $2 RETURNING id',
      [input.sessionId, input.userId],
    )
    if (deleted.rowCount !== 1 || deleted.rows[0]?.id !== input.sessionId) {
      throw new Error('AUTH010_POSTGRES_SESSION_DELETE_INCOMPLETE')
    }

    const inserted = await client.query<{ journalId: string }>(
      'INSERT INTO auth_010_session_revocation_journal ' +
        '(journal_id, event_id, event_type, schema_version, resource_id, source_version, ' +
        'idempotency_key, payload, status, attempt, next_attempt_at, created_at, published_at, last_error_code) ' +
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING', 1, NULL, $9, NULL, NULL) " +
        'RETURNING journal_id AS "journalId"',
      [
        crypto.randomUUID(),
        event.eventId,
        event.eventType,
        event.schemaVersion,
        event.resourceId,
        event.sourceVersion,
        event.idempotencyKey,
        JSON.stringify(event),
        event.publishedAt,
      ],
    )
    if (inserted.rowCount !== 1 || !inserted.rows[0]?.journalId) {
      throw new Error('AUTH010_POSTGRES_OUTBOX_INSERT_INCOMPLETE')
    }

    await client.query('COMMIT')
    transactionOpen = false
    return { status: 'REVOKED' }
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK')
      } catch {
        // Preserve the original operation error; the caller fails closed.
      }
    }
    throw error
  } finally {
    client.release()
  }
}
