import type { Pool } from 'pg'
import {
  assertSessionRevokedEvent,
  type SessionRevokedEvent,
} from '../auth/session-revocation-events.js'

export type SessionRevocationQueue = {
  send(message: SessionRevokedEvent): Promise<unknown>
}

export type SessionRevocationPublisherResult = {
  selected: number
  published: number
  failed: number
}

type PendingJournalRow = {
  journalId: string
  payload: string
  attempt: number
}

const MAX_BATCH = 10
const MAX_BACKOFF_SECONDS = 300

function assertPublisherInput(now: string, maxBatch: number): void {
  if (
    typeof now !== 'string' ||
    !Number.isFinite(Date.parse(now)) ||
    new Date(now).toISOString() !== now
  ) {
    throw new TypeError('invalid AUTH-010 PostgreSQL publisher timestamp')
  }
  if (!Number.isInteger(maxBatch) || maxBatch < 1 || maxBatch > MAX_BATCH) {
    throw new TypeError('AUTH-010 PostgreSQL publisher batch size must be 1-10')
  }
}

function retryDelaySeconds(attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error('AUTH010_POSTGRES_JOURNAL_ATTEMPT_INVALID')
  }
  return Math.min(2 ** Math.max(0, attempt - 1), MAX_BACKOFF_SECONDS)
}

/**
 * Publish the PostgreSQL AUTH-010 journal through the existing W02->W06
 * queue. Each row is locked with SKIP LOCKED while it is published and
 * finalized, so concurrent Cron invocations do not intentionally publish
 * the same pending row at the same time.
 *
 * Delivery remains at-least-once: if the queue accepts a message but the
 * PostgreSQL transaction cannot commit its PUBLISHED state, a later retry
 * may send the same event again. Consumers must continue to deduplicate by
 * the event's stable eventId/idempotencyKey.
 *
 * This helper is not wired to the production Worker or Cron yet.
 */
export async function publishPendingSessionRevocationEventsPostgres(
  pool: Pool,
  queue: SessionRevocationQueue,
  now = new Date().toISOString(),
  maxBatch = MAX_BATCH,
): Promise<SessionRevocationPublisherResult> {
  assertPublisherInput(now, maxBatch)

  const summary: SessionRevocationPublisherResult = {
    selected: 0,
    published: 0,
    failed: 0,
  }

  while (summary.selected < maxBatch) {
    const client = await pool.connect()
    let transactionOpen = false

    try {
      await client.query('BEGIN')
      transactionOpen = true

      const selected = await client.query<PendingJournalRow>(
        'SELECT journal_id AS "journalId", payload, attempt ' +
          'FROM auth_010_session_revocation_journal ' +
          "WHERE status = 'PENDING' AND (next_attempt_at IS NULL OR next_attempt_at <= $1) " +
          'ORDER BY created_at ASC, journal_id ASC ' +
          'LIMIT 1 FOR UPDATE SKIP LOCKED',
        [now],
      )
      const row = selected.rows[0]

      if (!row) {
        await client.query('COMMIT')
        transactionOpen = false
        break
      }

      summary.selected += 1

      let payload: SessionRevokedEvent
      try {
        payload = await assertSessionRevokedEvent(JSON.parse(row.payload))
      } catch {
        const quarantined = await client.query(
          'UPDATE auth_010_session_revocation_journal ' +
            "SET status = 'FAILED', next_attempt_at = NULL, last_error_code = 'INVALID_EVENT_PAYLOAD' " +
            "WHERE journal_id = $1 AND status = 'PENDING'",
          [row.journalId],
        )
        if (quarantined.rowCount !== 1) {
          throw new Error('AUTH010_POSTGRES_PUBLISHER_QUARANTINE_INCOMPLETE')
        }
        await client.query('COMMIT')
        transactionOpen = false
        summary.failed += 1
        continue
      }

      try {
        await queue.send(payload)
      } catch {
        const delaySeconds = retryDelaySeconds(Number(row.attempt))
        const nextAttemptAt = new Date(Date.parse(now) + delaySeconds * 1000).toISOString()
        const retried = await client.query(
          'UPDATE auth_010_session_revocation_journal ' +
            "SET status = 'PENDING', attempt = attempt + 1, next_attempt_at = $1, last_error_code = 'QUEUE_DESTINATION_FAILED' " +
            "WHERE journal_id = $2 AND status = 'PENDING'",
          [nextAttemptAt, row.journalId],
        )
        if (retried.rowCount !== 1) {
          throw new Error('AUTH010_POSTGRES_PUBLISHER_RETRY_INCOMPLETE')
        }
        await client.query('COMMIT')
        transactionOpen = false
        summary.failed += 1
        continue
      }

      const published = await client.query(
        'UPDATE auth_010_session_revocation_journal ' +
          "SET status = 'PUBLISHED', published_at = $1, next_attempt_at = NULL, last_error_code = NULL " +
          "WHERE journal_id = $2 AND status = 'PENDING'",
        [now, row.journalId],
      )
      if (published.rowCount !== 1) {
        throw new Error('AUTH010_POSTGRES_PUBLISHER_FINALIZE_INCOMPLETE')
      }

      await client.query('COMMIT')
      transactionOpen = false
      summary.published += 1
    } catch {
      if (transactionOpen) {
        try {
          await client.query('ROLLBACK')
        } catch {
          // Preserve fail-closed behavior without leaking driver details.
        }
      }
      throw new Error('AUTH010_POSTGRES_PUBLICATION_STAGE_FAILED')
    } finally {
      client.release()
    }
  }

  return summary
}
