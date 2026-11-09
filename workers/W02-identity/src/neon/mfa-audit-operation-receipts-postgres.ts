import type { Pool, PoolClient } from 'pg'

import type { MfaAuditOperationReceiptStore } from '../auth/mfa-audit-operation-receipt-store.js'
import { reconcileMfaAuditOperationReceiptsPostgres } from './mfa-audit-operation-receipt-reconciler-postgres.js'


import {
  mergeMfaAuditReceiptPlan,
  parseMfaAuditReceiptPlan,
  type MfaAuditReceiptEvent,
  type MfaAuditReceiptOperationPath,
} from '../auth/mfa-audit-receipts.js'

type ReceiptStatus = 'STARTED' | 'READY' | 'EMITTED' | 'RESOLVED' | 'UNKNOWN'

type ReceiptRow = {
  receiptId: string
  resourceId: string
  operationPath: MfaAuditReceiptOperationPath
  status: ReceiptStatus
  startedAt: Date | string
  completedAt: Date | string | null
  correlationId: string
  causationId: string
  eventPlan: string | null
  attempt: number
}

const validPaths = new Set<MfaAuditReceiptOperationPath>([
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
  '/two-factor/disable',
  '/two-factor/generate-backup-codes',
])
const subjectPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const correlationPattern = /^[A-Za-z0-9._:-]{1,128}$/
const receiptIdPattern = /^mfaop_[a-f0-9]{32}$/
const MAX_COMPARE_AND_SET_ATTEMPTS = 4

function safeCorrelation(value: string | null | undefined, fallback: string): string {
  return value && correlationPattern.test(value) ? value : fallback
}

function assertReceiptId(receiptId: string): void {
  if (typeof receiptId !== 'string' || !receiptIdPattern.test(receiptId)) {
    throw new TypeError('invalid MFA audit receipt id')
  }
}

function assertTimestamp(value: string, code: string): void {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(code)
  }
}

function isReceiptInputError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return new Set([
    'MFA_AUDIT_RECEIPT_NOT_FOUND',
    'MFA_AUDIT_RECEIPT_INVALID',
    'MFA_AUDIT_RECEIPT_NOT_APPENDABLE',
    'MFA_AUDIT_RECEIPT_OUTCOME_UNKNOWN',
    'MFA_AUDIT_RECEIPT_ALREADY_FINALIZED',
    'MFA_AUDIT_RECEIPT_STATUS_INVALID',
    'INVALID_MFA_AUDIT_RECEIPT_PLAN',
    'MFA_AUDIT_EVENT_IDEMPOTENCY_CONFLICT',
    'MFA_AUDIT_RECEIPT_PLAN_LIMIT_EXCEEDED',
  ]).has(error.message)
}

async function loadReceipt(client: PoolClient, receiptId: string): Promise<ReceiptRow> {
  const result = await client.query<ReceiptRow>(
    'SELECT receipt_id AS "receiptId", resource_id AS "resourceId", ' +
      'operation_path AS "operationPath", status, started_at AS "startedAt", ' +
      'completed_at AS "completedAt", correlation_id AS "correlationId", ' +
      'causation_id AS "causationId", event_plan AS "eventPlan", attempt ' +
      'FROM auth_007_mfa_operation_receipts WHERE receipt_id = $1 FOR UPDATE',
    [receiptId],
  )
  const row = result.rows[0]
  if (!row) throw new Error('MFA_AUDIT_RECEIPT_NOT_FOUND')
  if (!subjectPattern.test(row.resourceId) || !validPaths.has(row.operationPath)) {
    throw new Error('MFA_AUDIT_RECEIPT_INVALID')
  }
  return row
}

/**
 * Check the server-generated receipt context before a nested Better Auth
 * operation reuses it. A receipt can only be consumed by the same subject,
 * endpoint and challenge mode while it remains STARTED.
 */
export async function assertMfaAuditOperationReceiptOwnerPostgres(
  pool: Pool,
  input: {
    receiptId: string
    userId: string
    operationPath: MfaAuditReceiptOperationPath
    isChallenge: boolean
  },
): Promise<void> {
  if (
    !receiptIdPattern.test(input.receiptId) ||
    !subjectPattern.test(input.userId) ||
    !validPaths.has(input.operationPath) ||
    typeof input.isChallenge !== 'boolean'
  ) {
    throw new Error('MFA_AUDIT_RECEIPT_CONTEXT_MISMATCH')
  }

  const result = await pool.query<{
    receiptId: string
    resourceId: string
    operationPath: string
    isChallenge: number
    status: ReceiptStatus
  }>(
    'SELECT receipt_id AS "receiptId", resource_id AS "resourceId", ' +
      'operation_path AS "operationPath", is_challenge AS "isChallenge", status ' +
      'FROM auth_007_mfa_operation_receipts WHERE receipt_id = $1',
    [input.receiptId],
  )
  const row = result.rows[0]
  if (
    !row ||
    row.receiptId !== input.receiptId ||
    row.resourceId !== input.userId ||
    row.operationPath !== input.operationPath ||
    Number(row.isChallenge) !== (input.isChallenge ? 1 : 0) ||
    row.status !== 'STARTED'
  ) {
    throw new Error('MFA_AUDIT_RECEIPT_CONTEXT_MISMATCH')
  }
}

/** Persist a secret-free STARTED receipt before Better Auth mutates MFA state. */
export async function createMfaAuditOperationReceiptPostgres(
  pool: Pool,
  input: {
    userId: string
    operationPath: MfaAuditReceiptOperationPath
    isChallenge: boolean
    correlationId?: string | null
    causationId?: string | null
    now?: string
  },
): Promise<string> {
  if (!subjectPattern.test(input.userId)) throw new TypeError('invalid MFA audit subject')
  if (!validPaths.has(input.operationPath) || typeof input.isChallenge !== 'boolean') {
    throw new TypeError('invalid MFA audit receipt operation')
  }
  const now = input.now ?? new Date().toISOString()
  assertTimestamp(now, 'invalid MFA audit receipt timestamp')

  const receiptId = 'mfaop_' + crypto.randomUUID().replaceAll('-', '')
  const correlationId = safeCorrelation(input.correlationId, receiptId)
  const causationId = safeCorrelation(input.causationId, correlationId)
  try {
    const inserted = await pool.query(
      'INSERT INTO auth_007_mfa_operation_receipts ' +
        '(receipt_id, resource_id, operation_path, is_challenge, status, started_at, completed_at, ' +
        'correlation_id, causation_id, event_plan, attempt, next_attempt_at, last_error_code) ' +
        "VALUES ($1, $2, $3, $4, 'STARTED', $5, NULL, $6, $7, NULL, 0, NULL, NULL)",
      [receiptId, input.userId, input.operationPath, input.isChallenge ? 1 : 0, new Date(now), correlationId, causationId],
    )
    if (inserted.rowCount === 1) return receiptId
  } catch {
    // The server-generated ID is read back to distinguish a lost response from
    // a write that did not commit. No caller-supplied ID can be adopted here.
  }

  try {
    const existing = await pool.query<{ receiptId: string; resourceId: string; operationPath: string }>(
      'SELECT receipt_id AS "receiptId", resource_id AS "resourceId", operation_path AS "operationPath" ' +
        'FROM auth_007_mfa_operation_receipts WHERE receipt_id = $1',
      [receiptId],
    )
    const row = existing.rows[0]
    if (row?.receiptId === receiptId && row.resourceId === input.userId && row.operationPath === input.operationPath) {
      return receiptId
    }
  } catch {
    // Without an exact read-back proof, the caller must fail closed.
  }
  throw new Error('MFA_AUDIT_RECEIPT_WRITE_FAILED')
}

/**
 * Append an observed event while a receipt is STARTED. PostgreSQL row locking
 * serializes concurrent appenders; the shared plan validator preserves the
 * D1 implementation's idempotency and four-event bound.
 */
export async function appendMfaAuditOperationReceiptEventPostgres(
  pool: Pool,
  receiptId: string,
  event: MfaAuditReceiptEvent,
): Promise<void> {
  assertReceiptId(receiptId)
  const idempotencyKey = event.idempotencyKey ?? `mfa-operation:${receiptId}:${event.eventType}`

  let lastError: unknown
  for (let attempt = 0; attempt < MAX_COMPARE_AND_SET_ATTEMPTS; attempt += 1) {
    const client = await pool.connect()
    let transactionOpen = false
    try {
      await client.query('BEGIN')
      transactionOpen = true
      const row = await loadReceipt(client, receiptId)
      if (row.status !== 'STARTED') throw new Error('MFA_AUDIT_RECEIPT_NOT_APPENDABLE')

      const currentPlan = parseMfaAuditReceiptPlan(row.eventPlan)
      const plan = mergeMfaAuditReceiptPlan(
        receiptId,
        currentPlan,
        [event],
        event.occurredAt ?? new Date().toISOString(),
      )
      if (currentPlan.some((item) => item.idempotencyKey === idempotencyKey)) {
        await client.query('COMMIT')
        transactionOpen = false
        return
      }

      const updated = await client.query(
        'UPDATE auth_007_mfa_operation_receipts SET event_plan = $1, last_error_code = NULL ' +
          "WHERE receipt_id = $2 AND status = 'STARTED' AND event_plan IS NOT DISTINCT FROM $3",
        [JSON.stringify(plan), receiptId, row.eventPlan],
      )
      if (updated.rowCount !== 1) throw new Error('MFA_AUDIT_RECEIPT_WRITE_FAILED')
      await client.query('COMMIT')
      transactionOpen = false
      return
    } catch (error) {
      if (transactionOpen) {
        try { await client.query('ROLLBACK') } catch { /* Preserve the original failure. */ }
      }
      if (isReceiptInputError(error)) throw error
      lastError = error
    } finally {
      client.release()
    }
  }
  throw lastError instanceof Error ? new Error('MFA_AUDIT_RECEIPT_WRITE_FAILED') : new Error('MFA_AUDIT_RECEIPT_WRITE_FAILED')
}

/** Store the known outcome durably before any separate outbox reconciliation. */
export async function finalizeMfaAuditOperationReceiptPostgres(
  pool: Pool,
  receiptId: string,
  events: MfaAuditReceiptEvent[],
  now = new Date().toISOString(),
): Promise<boolean> {
  assertReceiptId(receiptId)
  assertTimestamp(now, 'invalid MFA audit receipt timestamp')

  let lastError: unknown
  for (let attempt = 0; attempt < MAX_COMPARE_AND_SET_ATTEMPTS; attempt += 1) {
    const client = await pool.connect()
    let transactionOpen = false
    try {
      await client.query('BEGIN')
      transactionOpen = true
      const row = await loadReceipt(client, receiptId)
      if (row.status === 'UNKNOWN') throw new Error('MFA_AUDIT_RECEIPT_OUTCOME_UNKNOWN')

      const currentPlan = parseMfaAuditReceiptPlan(row.eventPlan)
      const plan = mergeMfaAuditReceiptPlan(receiptId, currentPlan, events, now)
      if (row.status === 'READY' || row.status === 'EMITTED' || row.status === 'RESOLVED') {
        if (plan.length === currentPlan.length) {
          await client.query('COMMIT')
          transactionOpen = false
          return false
        }
        throw new Error('MFA_AUDIT_RECEIPT_ALREADY_FINALIZED')
      }
      if (row.status !== 'STARTED') throw new Error('MFA_AUDIT_RECEIPT_STATUS_INVALID')

      const nextStatus = plan.length > 0 ? 'READY' : 'RESOLVED'
      const updated = await client.query(
        'UPDATE auth_007_mfa_operation_receipts SET status = $1, event_plan = $2, ' +
          'completed_at = $3, next_attempt_at = NULL, last_error_code = NULL ' +
          "WHERE receipt_id = $4 AND status = 'STARTED'",
        [nextStatus, JSON.stringify(plan), new Date(now), receiptId],
      )
      if (updated.rowCount !== 1) throw new Error('MFA_AUDIT_RECEIPT_FINALIZE_FAILED')
      await client.query('COMMIT')
      transactionOpen = false
      return true
    } catch (error) {
      if (transactionOpen) {
        try { await client.query('ROLLBACK') } catch { /* Preserve the original failure. */ }
      }
      if (isReceiptInputError(error)) throw error
      lastError = error
    } finally {
      client.release()
    }
  }
  throw lastError instanceof Error
    ? new Error('MFA_AUDIT_RECEIPT_FINALIZE_FAILED')
    : new Error('MFA_AUDIT_RECEIPT_FINALIZE_FAILED')
}



/** PostgreSQL adapter over the existing AUTH-007 durable receipt and journal contract. */
export function createPostgresMfaAuditOperationReceiptStore(pool: Pool): MfaAuditOperationReceiptStore {
  return {
    assertOwner: (input) => assertMfaAuditOperationReceiptOwnerPostgres(pool, input),
    create: (input) => createMfaAuditOperationReceiptPostgres(pool, input),
    append: (receiptId, event) => appendMfaAuditOperationReceiptEventPostgres(pool, receiptId, event),
    finalize: (receiptId, events, now) =>
      finalizeMfaAuditOperationReceiptPostgres(pool, receiptId, events, now),
    reconcile: (now) => reconcileMfaAuditOperationReceiptsPostgres(pool, now),
  }
}
