import type { Pool, PoolClient } from 'pg'

import {
  deriveMfaAuditEventIdForIdempotencyKey,
} from '../auth/mfa-audit-events.js'
import {
  parseMfaAuditReceiptPlan,
} from '../auth/mfa-audit-receipts.js'
import { recordMfaAuditEventOncePostgres } from './mfa-audit-publication-journal-postgres.js'

type StoredPlanEvent = ReturnType<typeof parseMfaAuditReceiptPlan>[number]
type ReceiptRow = {
  receiptId: string
  resourceId: string
  status: 'READY' | 'EMITTED' | 'RESOLVED' | 'UNKNOWN'
  startedAt: Date
  correlationId: string
  causationId: string
  eventPlan: string | null
  attempt: number
}

export type MfaAuditReceiptDrainSummaryPostgres = {
  selected: number
  emitted: number
  failed: number
  unknown: number
}

const STALE_OPERATION_MS = 5 * 60 * 1000
const MAX_BATCH = 10
const MAX_BACKOFF_SECONDS = 300

function retryDelaySeconds(attempt: number): number {
  return Math.min(2 ** Math.max(0, attempt), MAX_BACKOFF_SECONDS)
}

function terminalErrorCode(error: unknown): string | null {
  if (!(error instanceof Error)) return null
  switch (error.message) {
    case 'MFA_AUDIT_OUTBOX_PREVIOUSLY_FAILED': return 'OUTBOX_PREVIOUSLY_FAILED'
    case 'MFA_AUDIT_EVENT_ID_CONFLICT': return 'OUTBOX_EVENT_ID_CONFLICT'
    case 'MFA_AUDIT_EVENT_ACTION_CONFLICT': return 'OUTBOX_ACTION_CONFLICT'
    case 'MFA_AUDIT_EVENT_INTENT_CONFLICT': return 'OUTBOX_INTENT_CONFLICT'
    case 'MFA_AUDIT_OUTBOX_STATUS_INVALID': return 'OUTBOX_STATUS_INVALID'
    case 'MFA_AUDIT_RECEIPT_IDENTITY_RECONCILIATION_FAILED': return 'RECEIPT_IDENTITY_CONFLICT'
    default: return null
  }
}

async function loadReceiptForUpdate(client: PoolClient, receiptId: string): Promise<ReceiptRow | null> {
  const result = await client.query<ReceiptRow>(
    'SELECT receipt_id AS "receiptId", resource_id AS "resourceId", status, started_at AS "startedAt", ' +
      'correlation_id AS "correlationId", causation_id AS "causationId", event_plan AS "eventPlan", attempt ' +
      'FROM auth_007_mfa_operation_receipts WHERE receipt_id = $1 FOR UPDATE',
    [receiptId],
  )
  return result.rows[0] ?? null
}

function buildJournalInput(row: ReceiptRow, event: StoredPlanEvent) {
  return {
    eventType: event.eventType,
    operationId: event.operationId,
    userId: row.resourceId,
    occurredAt: event.occurredAt,
    correlationId: row.correlationId,
    causationId: row.causationId,
    result: event.result,
    ...(event.reasonCode ? { reasonCode: event.reasonCode } : {}),
    ...(event.factorState ? { factorState: event.factorState } : {}),
    ...(event.challengeMethod ? { challengeMethod: event.challengeMethod } : {}),
    idempotencyKey: event.idempotencyKey,
    eventId: event.eventType === 'auth.mfa.locked' && event.idempotencyKey.startsWith('mfa-lock:')
      ? undefined
      : event.eventId,
  }
}

/**
 * PostgreSQL counterpart of the existing W02 Cron receipt reconciler.
 * Receipt rows are selected in a bounded batch and locked with FOR UPDATE while
 * idempotent journal writes are proven. Only after every event is durable is
 * READY transitioned to EMITTED. This function does not publish to Queue.
 */
export async function reconcileMfaAuditOperationReceiptsPostgres(
  pool: Pool,
  now = new Date().toISOString(),
): Promise<MfaAuditReceiptDrainSummaryPostgres> {
  const nowMs = Date.parse(now)
  if (!Number.isFinite(nowMs)) throw new TypeError('invalid MFA receipt reconciliation timestamp')
  const staleBefore = new Date(nowMs - STALE_OPERATION_MS)
  const nowDate = new Date(nowMs)

  const stale = await pool.query(
    "UPDATE auth_007_mfa_operation_receipts SET status = 'UNKNOWN', " +
      "last_error_code = 'OUTCOME_NOT_FINALIZED', next_attempt_at = NULL " +
      "WHERE status = 'STARTED' AND started_at <= $1",
    [staleBefore],
  )

  const selectedResult = await pool.query<{ receiptId: string }>(
    "SELECT receipt_id AS \"receiptId\" FROM auth_007_mfa_operation_receipts " +
      "WHERE status = 'READY' AND (next_attempt_at IS NULL OR next_attempt_at <= $1) " +
      'ORDER BY started_at ASC LIMIT $2',
    [nowDate, MAX_BATCH],
  )
  const receiptIds = selectedResult.rows.map((row) => row.receiptId)
  let emitted = 0
  let failed = 0
  let unknown = Number(stale.rowCount ?? 0)

  for (const receiptId of receiptIds) {
    const client = await pool.connect()
    let transactionOpen = false
    let attemptForRetry = 0
    try {
      await client.query('BEGIN')
      transactionOpen = true
      const row = await loadReceiptForUpdate(client, receiptId)
      if (!row || row.status !== 'READY') {
        await client.query('COMMIT')
        transactionOpen = false
        continue
      }

      attemptForRetry = row.attempt
      let plan: StoredPlanEvent[]
      try {
        plan = parseMfaAuditReceiptPlan(row.eventPlan)
        if (plan.length === 0) throw new Error('INVALID_MFA_AUDIT_RECEIPT_PLAN')
      } catch {
        const marked = await client.query(
          "UPDATE auth_007_mfa_operation_receipts SET status = 'UNKNOWN', " +
            "last_error_code = 'INVALID_EVENT_PLAN', next_attempt_at = NULL " +
            "WHERE receipt_id = $1 AND status = 'READY'",
          [receiptId],
        )
        if (marked.rowCount !== 1) throw new Error('MFA_AUDIT_RECEIPT_MARK_UNKNOWN_FAILED')
        await client.query('COMMIT')
        transactionOpen = false
        unknown += 1
        continue
      }

      let adoptedLegacyIdentity = false
      for (let index = 0; index < plan.length; index += 1) {
        const event = plan[index]!
        const requestedEventId = event.eventType === 'auth.mfa.locked' &&
          event.idempotencyKey.startsWith('mfa-lock:')
          ? await deriveMfaAuditEventIdForIdempotencyKey(event.idempotencyKey)
          : event.eventId
        const recorded = await recordMfaAuditEventOncePostgres(pool, {
          ...buildJournalInput(row, event),
          eventId: requestedEventId,
        })
        if (recorded.eventId !== event.eventId) {
          plan[index] = { ...event, eventId: recorded.eventId }
          adoptedLegacyIdentity = true
        }
      }

      if (adoptedLegacyIdentity) {
        const updated = await client.query(
          "UPDATE auth_007_mfa_operation_receipts SET event_plan = $1 " +
            "WHERE receipt_id = $2 AND status = 'READY' AND event_plan IS NOT DISTINCT FROM $3",
          [JSON.stringify(plan), receiptId, row.eventPlan],
        )
        if (updated.rowCount !== 1) {
          const latest = await client.query<{ eventPlan: string | null; status: string }>(
            'SELECT event_plan AS "eventPlan", status FROM auth_007_mfa_operation_receipts WHERE receipt_id = $1',
            [receiptId],
          )
          const latestPlan = latest.rows[0]?.eventPlan
            ? parseMfaAuditReceiptPlan(latest.rows[0].eventPlan)
            : []
          const adopted = plan.every((event) => latestPlan.some((candidate) =>
            candidate.idempotencyKey === event.idempotencyKey &&
            candidate.eventType === event.eventType &&
            candidate.eventId === event.eventId
          ))
          if (!adopted || !['READY', 'EMITTED'].includes(latest.rows[0]?.status ?? '')) {
            throw new Error('MFA_AUDIT_RECEIPT_IDENTITY_RECONCILIATION_FAILED')
          }
        }
      }

      const marked = await client.query(
        "UPDATE auth_007_mfa_operation_receipts SET status = 'EMITTED', " +
          'next_attempt_at = NULL, last_error_code = NULL ' +
          "WHERE receipt_id = $1 AND status = 'READY'",
        [receiptId],
      )
      if (marked.rowCount === 1) emitted += 1
      else {
        const latest = await client.query<{ status: string }>(
          'SELECT status FROM auth_007_mfa_operation_receipts WHERE receipt_id = $1',
          [receiptId],
        )
        if (latest.rows[0]?.status !== 'EMITTED') throw new Error('MFA_AUDIT_RECEIPT_MARK_EMITTED_FAILED')
        emitted += 1
      }
      await client.query('COMMIT')
      transactionOpen = false
    } catch (error) {
      if (transactionOpen) {
        try { await client.query('ROLLBACK') } catch { /* Keep original failure. */ }
      }
      // A previous transaction may have committed its terminal state while the
      // client lost the acknowledgement. Re-read before classifying the result.
      try {
        const latest = await pool.query<{ status: string }>(
          'SELECT status FROM auth_007_mfa_operation_receipts WHERE receipt_id = $1',
          [receiptId],
        )
        if (latest.rows[0]?.status === 'EMITTED') {
          emitted += 1
          continue
        }
        if (latest.rows[0]?.status === 'RESOLVED') continue
        if (latest.rows[0]?.status === 'UNKNOWN') {
          unknown += 1
          continue
        }
      } catch {
        // Fall through to bounded retry; status could not be proven.
      }

      const terminal = terminalErrorCode(error)
      if (terminal) {
        const marked = await pool.query(
          "UPDATE auth_007_mfa_operation_receipts SET status = 'UNKNOWN', " +
            'next_attempt_at = NULL, last_error_code = $1 ' +
            "WHERE receipt_id = $2 AND status = 'READY'",
          [terminal, receiptId],
        )
        if (marked.rowCount === 1) {
          unknown += 1
          continue
        }
        const latest = await pool.query<{ status: string }>(
          'SELECT status FROM auth_007_mfa_operation_receipts WHERE receipt_id = $1',
          [receiptId],
        )
        if (latest.rows[0]?.status === 'UNKNOWN') {
          unknown += 1
          continue
        }
        if (['EMITTED', 'RESOLVED'].includes(latest.rows[0]?.status ?? '')) continue
      }

      const delay = retryDelaySeconds(attemptForRetry)
      await pool.query(
        "UPDATE auth_007_mfa_operation_receipts SET attempt = attempt + 1, " +
          'next_attempt_at = $1, last_error_code = $2 ' +
          "WHERE receipt_id = $3 AND status = 'READY'",
        [new Date(nowMs + delay * 1000), terminal ?? 'OUTBOX_WRITE_FAILED', receiptId],
      )
      failed += 1
    } finally {
      client.release()
    }
  }

  return { selected: receiptIds.length, emitted, failed, unknown }
}
