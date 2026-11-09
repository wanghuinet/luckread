import type { Pool } from 'pg'

import {
  deriveMfaAuditEventIdForIdempotencyKey,
} from '../auth/mfa-audit-events.js'
import {
  parseMfaAuditReceiptPlan,
  type MfaAuditReceiptDrainSummary,
} from '../auth/mfa-audit-receipts.js'
import {
  recordMfaAuditEventOncePostgres,
} from './mfa-audit-publication-journal-postgres.js'

type ReceiptStatus = 'STARTED' | 'READY' | 'EMITTED' | 'RESOLVED' | 'UNKNOWN'

type ReadyReceiptRow = {
  receiptId: string
  resourceId: string
  operationPath: string
  status: ReceiptStatus
  startedAt: Date | string
  completedAt: Date | string | null
  correlationId: string
  causationId: string
  eventPlan: string | null
  attempt: number
}

type ReceiptStateRow = {
  status: ReceiptStatus
}

const MAX_BATCH = 10
const MAX_BACKOFF_SECONDS = 300
const STALE_OPERATION_MS = 5 * 60 * 1000

function assertReconcileInput(now: string, maxBatch: number): void {
  if (typeof now !== 'string' || !Number.isFinite(Date.parse(now))) {
    throw new TypeError('invalid MFA receipt reconciliation timestamp')
  }
  if (!Number.isInteger(maxBatch) || maxBatch < 1 || maxBatch > MAX_BATCH) {
    throw new TypeError('AUTH-007 PostgreSQL receipt batch size must be 1-10')
  }
}

function retryDelaySeconds(attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new Error('MFA_AUDIT_RECEIPT_ATTEMPT_INVALID')
  }
  return Math.min(2 ** Math.max(0, attempt), MAX_BACKOFF_SECONDS)
}

function terminalMfaOutboxErrorCode(error: unknown): string | null {
  if (!(error instanceof Error)) return null
  switch (error.message) {
    case 'MFA_AUDIT_OUTBOX_PREVIOUSLY_FAILED':
      return 'OUTBOX_PREVIOUSLY_FAILED'
    case 'MFA_AUDIT_EVENT_ID_CONFLICT':
      return 'OUTBOX_EVENT_ID_CONFLICT'
    case 'MFA_AUDIT_EVENT_ACTION_CONFLICT':
      return 'OUTBOX_ACTION_CONFLICT'
    case 'MFA_AUDIT_EVENT_INTENT_CONFLICT':
      return 'OUTBOX_INTENT_CONFLICT'
    case 'MFA_AUDIT_OUTBOX_STATUS_INVALID':
      return 'OUTBOX_STATUS_INVALID'
    case 'MFA_AUDIT_RECEIPT_IDENTITY_RECONCILIATION_FAILED':
      return 'RECEIPT_IDENTITY_CONFLICT'
    default:
      return null
  }
}

async function readReceiptState(pool: Pool, receiptId: string): Promise<ReceiptStatus | null> {
  const result = await pool.query<ReceiptStateRow>(
    'SELECT status FROM auth_007_mfa_operation_receipts WHERE receipt_id = $1',
    [receiptId],
  )
  return result.rows[0]?.status ?? null
}

async function accountForAlreadyTerminalState(
  pool: Pool,
  receiptId: string,
  summary: MfaAuditReceiptDrainSummary,
): Promise<boolean> {
  let status: ReceiptStatus | null
  try {
    status = await readReceiptState(pool, receiptId)
  } catch {
    return false
  }
  if (status === 'EMITTED') {
    summary.emitted += 1
    return true
  }
  if (status === 'RESOLVED') return true
  if (status === 'UNKNOWN') {
    summary.unknown += 1
    return true
  }
  return false
}

/**
 * Reconcile READY MFA operation receipts into the PostgreSQL W02 publication
 * journal. Each receipt is locked with FOR UPDATE SKIP LOCKED while it is
 * processed. The receipt transition and all event-journal inserts share one
 * PostgreSQL transaction; unique idempotency keys make a retry safe after an
 * ambiguous commit response.
 *
 * Stale STARTED receipts and malformed/empty READY plans become UNKNOWN rather
 * than inventing an MFA outcome. This helper is test-only until the separate
 * W02 runtime-adapter change-control is approved. It does not publish a Queue
 * message; delivery remains a separate existing-AUTH013_QUEUE operation.
 */
type MfaAuditEventRecorder = typeof recordMfaAuditEventOncePostgres

export async function reconcileMfaAuditOperationReceiptsPostgres(
  pool: Pool,
  now = new Date().toISOString(),
  maxBatch = MAX_BATCH,
  recordEvent: MfaAuditEventRecorder = recordMfaAuditEventOncePostgres,
): Promise<MfaAuditReceiptDrainSummary> {
  assertReconcileInput(now, maxBatch)
  const nowDate = new Date(now)
  const staleBefore = new Date(Date.parse(now) - STALE_OPERATION_MS)
  const stale = await pool.query(
    "UPDATE auth_007_mfa_operation_receipts " +
      "SET status = 'UNKNOWN', last_error_code = 'OUTCOME_NOT_FINALIZED', next_attempt_at = NULL " +
      "WHERE status = 'STARTED' AND started_at <= $1 RETURNING receipt_id",
    [staleBefore],
  )

  const summary: MfaAuditReceiptDrainSummary = {
    selected: 0,
    emitted: 0,
    failed: 0,
    unknown: stale.rowCount ?? 0,
  }

  while (summary.selected < maxBatch) {
    const client = await pool.connect()
    let transactionOpen = false
    let released = false
    let row: ReadyReceiptRow | undefined
    let forcedTerminalCode: string | null = null
    const release = (): void => {
      if (!released) {
        client.release()
        released = true
      }
    }

    try {
      await client.query('BEGIN')
      transactionOpen = true
      const selected = await client.query<ReadyReceiptRow>(
        'SELECT receipt_id AS "receiptId", resource_id AS "resourceId", ' +
          'operation_path AS "operationPath", status, started_at AS "startedAt", ' +
          'completed_at AS "completedAt", correlation_id AS "correlationId", ' +
          'causation_id AS "causationId", event_plan AS "eventPlan", attempt ' +
          'FROM auth_007_mfa_operation_receipts ' +
          "WHERE status = 'READY' AND (next_attempt_at IS NULL OR next_attempt_at <= $1) " +
          'ORDER BY started_at ASC, receipt_id ASC LIMIT 1 FOR UPDATE SKIP LOCKED',
        [nowDate],
      )
      row = selected.rows[0]

      if (!row) {
        await client.query('COMMIT')
        transactionOpen = false
        release()
        break
      }

      summary.selected += 1

      let plan: ReturnType<typeof parseMfaAuditReceiptPlan>
      try {
        plan = parseMfaAuditReceiptPlan(row.eventPlan)
        if (plan.length === 0) throw new Error('INVALID_MFA_AUDIT_RECEIPT_PLAN')
      } catch {
        forcedTerminalCode = 'INVALID_EVENT_PLAN'
        throw new Error('INVALID_MFA_AUDIT_RECEIPT_PLAN')
      }

      let adoptedLegacyIdentity = false
      for (let index = 0; index < plan.length; index += 1) {
        const event = plan[index]!
        const requestedEventId = event.eventType === 'auth.mfa.locked' &&
          event.idempotencyKey.startsWith('mfa-lock:')
          ? await deriveMfaAuditEventIdForIdempotencyKey(event.idempotencyKey)
          : event.eventId

        const recorded = await recordEvent(client, {
          eventType: event.eventType,
          ...(event.operationId ? { operationId: event.operationId } : {}),
          userId: row.resourceId,
          occurredAt: event.occurredAt,
          correlationId: row.correlationId,
          causationId: row.causationId,
          result: event.result,
          ...(event.reasonCode ? { reasonCode: event.reasonCode } : {}),
          ...(event.factorState ? { factorState: event.factorState } : {}),
          ...(event.challengeMethod ? { challengeMethod: event.challengeMethod } : {}),
          idempotencyKey: event.idempotencyKey,
          eventId: requestedEventId,
        })

        if (recorded.eventId !== event.eventId) {
          plan[index] = { ...event, eventId: recorded.eventId }
          adoptedLegacyIdentity = true
        }
      }

      if (adoptedLegacyIdentity) {
        const persisted = await client.query(
          'UPDATE auth_007_mfa_operation_receipts SET event_plan = $1 ' +
            "WHERE receipt_id = $2 AND status = 'READY' AND event_plan IS NOT DISTINCT FROM $3",
          [JSON.stringify(plan), row.receiptId, row.eventPlan],
        )
        if (persisted.rowCount !== 1) {
          throw new Error('MFA_AUDIT_RECEIPT_IDENTITY_RECONCILIATION_FAILED')
        }
      }

      const emitted = await client.query(
        'UPDATE auth_007_mfa_operation_receipts ' +
          "SET status = 'EMITTED', next_attempt_at = NULL, last_error_code = NULL " +
          "WHERE receipt_id = $1 AND status = 'READY' RETURNING receipt_id",
        [row.receiptId],
      )
      if (emitted.rowCount !== 1) {
        throw new Error('MFA_AUDIT_RECEIPT_MARK_EMITTED_FAILED')
      }

      await client.query('COMMIT')
      transactionOpen = false
      release()
      summary.emitted += 1
    } catch (error) {
      if (transactionOpen) {
        try {
          await client.query('ROLLBACK')
        } catch {
          // Preserve the original failure; read-back below determines the outcome.
        }
        transactionOpen = false
      }
      release()

      if (!row) {
        throw new Error('MFA_AUDIT_RECEIPT_SELECT_FAILED')
      }

      if (await accountForAlreadyTerminalState(pool, row.receiptId, summary)) continue

      const terminalErrorCode = forcedTerminalCode ?? terminalMfaOutboxErrorCode(error)
      if (terminalErrorCode) {
        try {
          const terminal = await pool.query(
            'UPDATE auth_007_mfa_operation_receipts ' +
              "SET status = 'UNKNOWN', next_attempt_at = NULL, last_error_code = $1 " +
              "WHERE receipt_id = $2 AND status = 'READY' RETURNING receipt_id",
            [terminalErrorCode, row.receiptId],
          )
          if (terminal.rowCount === 1) {
            summary.unknown += 1
            continue
          }
          if (await accountForAlreadyTerminalState(pool, row.receiptId, summary)) continue
        } catch {
          // An unproven terminal transition remains visible and retryable.
        }
        if (await accountForAlreadyTerminalState(pool, row.receiptId, summary)) continue
        if (forcedTerminalCode) {
          summary.failed += 1
          continue
        }
      }

      const delay = retryDelaySeconds(Number(row.attempt))
      const nextAttemptAt = new Date(Date.parse(now) + delay * 1000)
      try {
        const retried = await pool.query(
          'UPDATE auth_007_mfa_operation_receipts ' +
            'SET attempt = attempt + 1, next_attempt_at = $1, last_error_code = $2 ' +
            "WHERE receipt_id = $3 AND status = 'READY' RETURNING receipt_id",
          [nextAttemptAt, terminalErrorCode ?? 'OUTBOX_WRITE_FAILED', row.receiptId],
        )
        if (retried.rowCount !== 1 &&
            await accountForAlreadyTerminalState(pool, row.receiptId, summary)) {
          continue
        }
      } catch {
        // Leave READY durable; the existing Cron tick can retry after this stage recovers.
      }
      summary.failed += 1
    }
  }

  return summary
}
