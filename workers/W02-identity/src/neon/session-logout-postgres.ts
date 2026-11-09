import type { Pool } from 'pg'
import {
  assertSessionRevokedEvent,
  type SessionRevokedEvent,
} from '../auth/session-revocation-events.js'

export type SessionLogoutPostgresInput = {
  userId: string
  sessionId: string
  now: string
  event: SessionRevokedEvent
}

export type SessionLogoutPostgresResult =
  | { status: 'REVOKED' }
  | { status: 'NOT_FOUND_OR_NOT_OWNED' }

const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

function validateInput(input: SessionLogoutPostgresInput): void {
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
    throw new TypeError('invalid PostgreSQL AUTH-010 session logout input')
  }
}

/**
 * PostgreSQL-native AUTH-010 self-logout persistence.
 *
 * The caller authenticates the current Better Auth session and enforces the
 * existing logout rate limits. This transaction deletes only that exact
 * caller-owned session, then records the USER_LOGOUT outbox intent before
 * commit. A concurrent/replayed logout that finds no row is an idempotent
 * no-op and cannot publish a second event.
 */
export async function logoutCurrentSessionPostgres(
  pool: Pool,
  input: SessionLogoutPostgresInput,
): Promise<SessionLogoutPostgresResult> {
  validateInput(input)

  const event = await assertSessionRevokedEvent(input.event)
  if (
    event.actor.actorId !== input.userId ||
    event.resourceId !== input.sessionId ||
    event.payload.operationId !== 'authLogout' ||
    event.payload.reasonCode !== 'USER_LOGOUT'
  ) {
    throw new TypeError('session logout event does not match command')
  }

  const client = await pool.connect()
  let transactionOpen = false

  try {
    await client.query('BEGIN')
    transactionOpen = true

    const deleted = await client.query<{ id: string }>(
      'DELETE FROM "session" WHERE id = $1 AND user_id = $2 RETURNING id',
      [input.sessionId, input.userId],
    )

    if (deleted.rowCount === 0) {
      await client.query('COMMIT')
      transactionOpen = false
      return { status: 'NOT_FOUND_OR_NOT_OWNED' }
    }
    if (deleted.rowCount !== 1 || deleted.rows[0]?.id !== input.sessionId) {
      throw new Error('AUTH010_POSTGRES_SESSION_LOGOUT_DELETE_INCOMPLETE')
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
      throw new Error('AUTH010_POSTGRES_SESSION_LOGOUT_OUTBOX_INSERT_INCOMPLETE')
    }

    await client.query('COMMIT')
    transactionOpen = false
    return { status: 'REVOKED' }
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK')
      } catch {
        // Preserve the original failure; the caller fails closed.
      }
    }
    throw error
  } finally {
    client.release()
  }
}
