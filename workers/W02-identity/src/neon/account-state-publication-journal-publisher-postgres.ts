import type { Pool } from 'pg'

import { parseEventEnvelopeMetadata } from '../../../W10-async/src/event-envelope.js'

type PendingPublicationRow = {
  journalId: string
  payload: string
  attempt: number
}

export type AccountStatePublicationQueues = {
  auth013: { send(message: unknown): Promise<void> }
  projection: { send(message: unknown): Promise<void> }
}

export type AccountStatePostgresPublicationSummary = {
  selected: number
  published: number
  failed: number
}

const MAX_BATCH = 10
const MAX_BACKOFF_SECONDS = 300

function assertTimestamp(now: string): void {
  if (
    typeof now !== 'string' ||
    !Number.isFinite(Date.parse(now)) ||
    new Date(now).toISOString() !== now
  ) {
    throw new TypeError('invalid AUTH-013 PostgreSQL publication timestamp')
  }
}

function retryDelaySeconds(attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error('AUTH013_POSTGRES_PUBLICATION_ATTEMPT_INVALID')
  }
  return Math.min(2 ** Math.max(0, attempt - 1), MAX_BACKOFF_SECONDS)
}

/**
 * PostgreSQL counterpart of W02's existing two-destination AUTH-013 publisher.
 * The existing Queue bindings and payload contract are reused unchanged.
 * Each journal row is locked with SKIP LOCKED through queue acceptance and
 * terminal state update; delivery remains at-least-once and consumers dedupe
 * by the canonical event identity.
 */
export async function publishPendingAccountStateEventsPostgres(
  pool: Pool,
  queues: AccountStatePublicationQueues,
  now = new Date().toISOString(),
): Promise<AccountStatePostgresPublicationSummary> {
  assertTimestamp(now)
  const summary: AccountStatePostgresPublicationSummary = {
    selected: 0,
    published: 0,
    failed: 0,
  }

  while (summary.selected < MAX_BATCH) {
    const client = await pool.connect()
    let transactionOpen = false

    try {
      await client.query('BEGIN')
      transactionOpen = true
      const selected = await client.query<PendingPublicationRow>(
        'SELECT journal_id AS "journalId", payload, attempt ' +
          'FROM auth_013_publication_journal ' +
          "WHERE status = 'PENDING' AND (next_attempt_at IS NULL OR next_attempt_at <= $1) " +
          'ORDER BY created_at ASC, journal_id ASC LIMIT 1 FOR UPDATE SKIP LOCKED',
        [now],
      )
      const row = selected.rows[0]
      if (!row) {
        await client.query('COMMIT')
        transactionOpen = false
        break
      }
      summary.selected += 1

      let payload: unknown
      try {
        payload = JSON.parse(row.payload)
        const envelope = parseEventEnvelopeMetadata(payload)
        if (
          envelope.eventType !== 'identity.account_state_changed' ||
          envelope.schemaVersion !== '1.0' ||
          envelope.producer !== 'W02' ||
          envelope.resourceType !== 'User'
        ) throw new Error('INVALID_AUTH_013_EVENT_ENVELOPE')
      } catch {
        const quarantined = await client.query(
          'UPDATE auth_013_publication_journal ' +
            "SET status = 'FAILED', last_error_code = 'INVALID_EVENT_PAYLOAD', next_attempt_at = NULL " +
            "WHERE journal_id = $1 AND status = 'PENDING'",
          [row.journalId],
        )
        if (quarantined.rowCount !== 1) {
          throw new Error('AUTH013_POSTGRES_PUBLISHER_QUARANTINE_INCOMPLETE')
        }
        await client.query('COMMIT')
        transactionOpen = false
        summary.failed += 1
        continue
      }

      const deliveries = await Promise.allSettled([
        queues.auth013.send(payload),
        queues.projection.send(payload),
      ])
      if (deliveries.every((delivery) => delivery.status === 'fulfilled')) {
        const finalized = await client.query(
          'UPDATE auth_013_publication_journal ' +
            "SET status = 'PUBLISHED', published_at = $1, next_attempt_at = NULL, last_error_code = NULL " +
            "WHERE journal_id = $2 AND status = 'PENDING'",
          [now, row.journalId],
        )
        if (finalized.rowCount !== 1) {
          throw new Error('AUTH013_POSTGRES_PUBLISHER_FINALIZE_INCOMPLETE')
        }
        await client.query('COMMIT')
        transactionOpen = false
        summary.published += 1
        continue
      }

      const delaySeconds = retryDelaySeconds(Number(row.attempt))
      const nextAttemptAt = new Date(Date.parse(now) + delaySeconds * 1000)
      const retried = await client.query(
        'UPDATE auth_013_publication_journal ' +
          "SET status = 'PENDING', attempt = attempt + 1, next_attempt_at = $1, last_error_code = 'QUEUE_DESTINATION_FAILED' " +
          "WHERE journal_id = $2 AND status = 'PENDING'",
        [nextAttemptAt, row.journalId],
      )
      if (retried.rowCount !== 1) {
        throw new Error('AUTH013_POSTGRES_PUBLISHER_RETRY_INCOMPLETE')
      }
      await client.query('COMMIT')
      transactionOpen = false
      summary.failed += 1
    } catch {
      if (transactionOpen) {
        try { await client.query('ROLLBACK') } catch { /* preserve fixed failure */ }
      }
      throw new Error('AUTH013_POSTGRES_PUBLICATION_STAGE_FAILED')
    } finally {
      client.release()
    }
  }
  return summary
}
