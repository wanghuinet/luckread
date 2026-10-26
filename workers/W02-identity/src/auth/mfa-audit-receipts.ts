import {
  MFA_AUDIT_EVENT_NAMES,
  recordMfaAuditEventOnce,
  type MfaAuditEventName,
  type MfaAuditResult,
} from './mfa-audit-events.js'

export type MfaAuditReceiptOperationPath =
  | '/two-factor/verify-totp'
  | '/two-factor/verify-backup-code'
  | '/two-factor/disable'
  | '/two-factor/generate-backup-codes'

export type MfaAuditReceiptEvent = {
  eventType: MfaAuditEventName
  result: MfaAuditResult
  reasonCode?: string
  factorState?: 'PENDING_VERIFICATION' | 'ENABLED' | 'DISABLED'
  challengeMethod?: 'totp' | 'recovery_code'
  idempotencyKey?: string
  occurredAt?: string
}

type ReceiptRow = {
  receiptId: string
  resourceId: string
  operationPath: MfaAuditReceiptOperationPath
  status: 'STARTED' | 'READY' | 'EMITTED' | 'RESOLVED' | 'UNKNOWN'
  startedAt: string
  completedAt: string | null
  correlationId: string
  causationId: string
  eventPlan: string | null
  attempt: number
}

type StoredReceiptEvent = MfaAuditReceiptEvent & {
  idempotencyKey: string
  occurredAt: string
}

const validPaths = new Set<MfaAuditReceiptOperationPath>([
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
  '/two-factor/disable',
  '/two-factor/generate-backup-codes',
])
const validEventNames = new Set<string>(MFA_AUDIT_EVENT_NAMES)
const validResults = new Set<MfaAuditResult>(['started', 'succeeded', 'failed', 'rejected'])
const subjectPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const correlationPattern = /^[A-Za-z0-9._:-]{1,128}$/
const idempotencyPattern = /^[A-Za-z0-9._:-]{1,255}$/
const staleOperationMs = 5 * 60 * 1000
const maxBatch = 10
const maxBackoffSeconds = 300

export type MfaAuditReceiptDrainSummary = {
  selected: number
  emitted: number
  failed: number
  unknown: number
}

function safeCorrelation(value: string | null | undefined, fallback: string): string {
  return value && correlationPattern.test(value) ? value : fallback
}

function validateEvent(value: unknown): StoredReceiptEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INVALID_MFA_AUDIT_RECEIPT_PLAN')
  }
  const event = value as Record<string, unknown>
  if (typeof event.eventType !== 'string' || !validEventNames.has(event.eventType)) {
    throw new Error('INVALID_MFA_AUDIT_RECEIPT_PLAN')
  }
  if (typeof event.result !== 'string' || !validResults.has(event.result as MfaAuditResult)) {
    throw new Error('INVALID_MFA_AUDIT_RECEIPT_PLAN')
  }
  if (
    event.reasonCode !== undefined &&
    (typeof event.reasonCode !== 'string' || !/^[A-Z0-9_:-]{1,96}$/.test(event.reasonCode))
  ) {
    throw new Error('INVALID_MFA_AUDIT_RECEIPT_PLAN')
  }
  if (
    event.factorState !== undefined &&
    !['PENDING_VERIFICATION', 'ENABLED', 'DISABLED'].includes(String(event.factorState))
  ) {
    throw new Error('INVALID_MFA_AUDIT_RECEIPT_PLAN')
  }
  if (
    event.challengeMethod !== undefined &&
    !['totp', 'recovery_code'].includes(String(event.challengeMethod))
  ) {
    throw new Error('INVALID_MFA_AUDIT_RECEIPT_PLAN')
  }
  if (typeof event.idempotencyKey !== 'string' || !idempotencyPattern.test(event.idempotencyKey)) {
    throw new Error('INVALID_MFA_AUDIT_RECEIPT_PLAN')
  }
  if (typeof event.occurredAt !== 'string' || !Number.isFinite(Date.parse(event.occurredAt))) {
    throw new Error('INVALID_MFA_AUDIT_RECEIPT_PLAN')
  }

  return {
    eventType: event.eventType as MfaAuditEventName,
    result: event.result as MfaAuditResult,
    ...(typeof event.reasonCode === 'string' ? { reasonCode: event.reasonCode } : {}),
    ...(typeof event.factorState === 'string'
      ? { factorState: event.factorState as StoredReceiptEvent['factorState'] }
      : {}),
    ...(typeof event.challengeMethod === 'string'
      ? { challengeMethod: event.challengeMethod as StoredReceiptEvent['challengeMethod'] }
      : {}),
    idempotencyKey: event.idempotencyKey,
    occurredAt: event.occurredAt,
  }
}

function parsePlan(value: string | null): StoredReceiptEvent[] {
  if (value === null) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('INVALID_MFA_AUDIT_RECEIPT_PLAN')
  }
  if (!Array.isArray(parsed) || parsed.length > 4) {
    throw new Error('INVALID_MFA_AUDIT_RECEIPT_PLAN')
  }
  return parsed.map(validateEvent)
}

function mergePlan(
  receiptId: string,
  existing: StoredReceiptEvent[],
  incoming: MfaAuditReceiptEvent[],
  occurredAt: string,
): StoredReceiptEvent[] {
  const byKey = new Map(existing.map((event) => [event.idempotencyKey, event]))
  for (const input of incoming) {
    const idempotencyKey = input.idempotencyKey ??
      `mfa-operation:${receiptId}:${input.eventType}`
    const candidate = validateEvent({
      ...input,
      idempotencyKey,
      occurredAt: input.occurredAt ?? occurredAt,
    })
    if (!byKey.has(candidate.idempotencyKey)) byKey.set(candidate.idempotencyKey, candidate)
  }
  if (byKey.size > 4) throw new Error('MFA_AUDIT_RECEIPT_PLAN_LIMIT_EXCEEDED')
  return [...byKey.values()]
}

async function loadReceipt(db: D1Database, receiptId: string): Promise<ReceiptRow> {
  const row = await db.prepare(
    'SELECT receipt_id AS receiptId, resource_id AS resourceId, operation_path AS operationPath, ' +
    'status, started_at AS startedAt, completed_at AS completedAt, correlation_id AS correlationId, ' +
    'causation_id AS causationId, event_plan AS eventPlan, attempt ' +
    'FROM auth_007_mfa_operation_receipts WHERE receipt_id = ? LIMIT 1',
  ).bind(receiptId).first<ReceiptRow>()
  if (!row) throw new Error('MFA_AUDIT_RECEIPT_NOT_FOUND')
  if (!subjectPattern.test(row.resourceId) || !validPaths.has(row.operationPath)) {
    throw new Error('MFA_AUDIT_RECEIPT_INVALID')
  }
  return row
}

/**
 * Persist a secret-free receipt before Better Auth can mutate an MFA factor,
 * consume a recovery code, or establish a session from a challenge.
 */
export async function createMfaAuditOperationReceipt(
  db: D1Database,
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
  if (!Number.isFinite(Date.parse(now))) throw new TypeError('invalid MFA audit receipt timestamp')

  const receiptId = 'mfaop_' + crypto.randomUUID().replaceAll('-', '')
  const correlationId = safeCorrelation(input.correlationId, receiptId)
  const causationId = safeCorrelation(input.causationId, correlationId)
  try {
    const result = await db.prepare(
      'INSERT INTO auth_007_mfa_operation_receipts ' +
      '(receipt_id, resource_id, operation_path, is_challenge, status, started_at, completed_at, ' +
      'correlation_id, causation_id, event_plan, attempt, next_attempt_at, last_error_code) ' +
      'VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, 0, NULL, NULL)',
    ).bind(
      receiptId,
      input.userId,
      input.operationPath,
      input.isChallenge ? 1 : 0,
      'STARTED',
      now,
      correlationId,
      causationId,
    ).run()
    if (result.success && result.meta?.changes === 1) return receiptId
  } catch {
    // The write may have committed even if the D1 response was lost. Verify
    // the exact server-generated receipt ID before deciding the operation
    // must fail closed.
  }

  try {
    const existing = await db.prepare(
      'SELECT receipt_id AS receiptId FROM auth_007_mfa_operation_receipts WHERE receipt_id = ? LIMIT 1',
    ).bind(receiptId).first<{ receiptId: string }>()
    if (existing?.receiptId === receiptId) return receiptId
  } catch {
    // Without a read-back proof, a failed receipt write remains a hard block.
  }
  throw new Error('MFA_AUDIT_RECEIPT_WRITE_FAILED')
}

/**
 * Append an already-observed, pre-hook rejection (for example TOTP replay) to
 * the durable receipt. The receipt remains STARTED until the after hook records
 * the final result; this keeps the existing Cron from publishing a partial plan.
 */
export async function appendMfaAuditOperationReceiptEvent(
  db: D1Database,
  receiptId: string,
  event: MfaAuditReceiptEvent,
): Promise<void> {
  const row = await loadReceipt(db, receiptId)
  if (!['STARTED', 'READY'].includes(row.status)) {
    throw new Error('MFA_AUDIT_RECEIPT_NOT_APPENDABLE')
  }
  const plan = mergePlan(receiptId, parsePlan(row.eventPlan), [event], event.occurredAt ?? new Date().toISOString())
  const idempotencyKey = event.idempotencyKey ?? `mfa-operation:${receiptId}:${event.eventType}`
  try {
    const result = await db.prepare(
      'UPDATE auth_007_mfa_operation_receipts SET event_plan = ?, ' +
      'last_error_code = NULL WHERE receipt_id = ? AND status IN (?, ?)',
    ).bind(JSON.stringify(plan), receiptId, 'STARTED', 'READY').run()
    if (result.success && result.meta?.changes === 1) return
  } catch {
    // The D1 write may have committed even when the response was lost.
  }

  try {
    const latest = await loadReceipt(db, receiptId)
    if (parsePlan(latest.eventPlan).some((item) =>
      item.idempotencyKey === idempotencyKey &&
      item.eventType === event.eventType &&
      item.result === event.result
    )) return
  } catch {
    // Without an authoritative read-back, fail closed before returning the auth error.
  }
  throw new Error('MFA_AUDIT_RECEIPT_WRITE_FAILED')
}

/** Store the known outcome durably before attempting any outbox insert. */
export async function finalizeMfaAuditOperationReceipt(
  db: D1Database,
  receiptId: string,
  events: MfaAuditReceiptEvent[],
  now = new Date().toISOString(),
): Promise<boolean> {
  if (!Number.isFinite(Date.parse(now))) throw new TypeError('invalid MFA audit receipt timestamp')
  const row = await loadReceipt(db, receiptId)
  if (row.status === 'EMITTED' || row.status === 'RESOLVED') return false
  if (row.status === 'UNKNOWN') throw new Error('MFA_AUDIT_RECEIPT_OUTCOME_UNKNOWN')

  const plan = mergePlan(receiptId, parsePlan(row.eventPlan), events, now)
  const nextStatus = plan.length > 0 ? 'READY' : 'RESOLVED'
  const result = await db.prepare(
    'UPDATE auth_007_mfa_operation_receipts SET status = ?, event_plan = ?, completed_at = ?, ' +
    'next_attempt_at = NULL, last_error_code = NULL WHERE receipt_id = ? AND status IN (?, ?)',
  ).bind(nextStatus, JSON.stringify(plan), now, receiptId, 'STARTED', 'READY').run()
  if (result.success && result.meta?.changes === 1) return true

  const latest = await loadReceipt(db, receiptId)
  if (latest.status === 'EMITTED' || latest.status === 'RESOLVED') return false
  throw new Error('MFA_AUDIT_RECEIPT_FINALIZE_FAILED')
}

function retryDelaySeconds(attempt: number): number {
  return Math.min(2 ** Math.max(0, attempt), maxBackoffSeconds)
}

/**
 * Reconcile the receipt journal on the existing W02 Cron path. A receipt is
 * EMITTED only after every event has a durable, idempotent W02 outbox row.
 * Stale STARTED receipts become UNKNOWN rather than being silently discarded
 * or having an unprovable success/failure invented.
 */
export async function reconcileMfaAuditOperationReceipts(
  db: D1Database,
  now = new Date().toISOString(),
): Promise<MfaAuditReceiptDrainSummary> {
  if (!Number.isFinite(Date.parse(now))) throw new TypeError('invalid MFA receipt reconciliation timestamp')
  const staleBefore = new Date(Date.parse(now) - staleOperationMs).toISOString()
  const stale = await db.prepare(
    'UPDATE auth_007_mfa_operation_receipts SET status = ?, last_error_code = ?, next_attempt_at = NULL ' +
    'WHERE status = ? AND started_at <= ?',
  ).bind('UNKNOWN', 'OUTCOME_NOT_FINALIZED', 'STARTED', staleBefore).run()
  if (!stale.success) throw new Error('MFA_AUDIT_RECEIPT_STALE_SCAN_FAILED')

  const selectedResult = await db.prepare(
    'SELECT receipt_id AS receiptId, resource_id AS resourceId, status, started_at AS startedAt, ' +
    'completed_at AS completedAt, correlation_id AS correlationId, causation_id AS causationId, ' +
    'event_plan AS eventPlan, attempt FROM auth_007_mfa_operation_receipts ' +
    'WHERE status = ? AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ' +
    'ORDER BY started_at ASC LIMIT ?',
  ).bind('READY', now, maxBatch).all<ReceiptRow>()
  const rows = selectedResult.results ?? []
  let emitted = 0
  let failed = 0
  let unknown = stale.success ? Number(stale.meta?.changes ?? 0) : 0

  for (const row of rows) {
    let plan: StoredReceiptEvent[]
    try {
      plan = parsePlan(row.eventPlan)
      if (plan.length === 0) throw new Error('INVALID_MFA_AUDIT_RECEIPT_PLAN')
    } catch {
      try {
        const result = await db.prepare(
          'UPDATE auth_007_mfa_operation_receipts SET status = ?, last_error_code = ?, ' +
          'next_attempt_at = NULL WHERE receipt_id = ? AND status = ?',
        ).bind('UNKNOWN', 'INVALID_EVENT_PLAN', row.receiptId, 'READY').run()
        if (result.success && result.meta?.changes === 1) {
          unknown += 1
        } else {
          throw new Error('MFA_AUDIT_RECEIPT_MARK_UNKNOWN_FAILED')
        }
      } catch {
        failed += 1
      }
      continue
    }

    try {
      for (const event of plan) {
        await recordMfaAuditEventOnce(db, {
          eventType: event.eventType,
          userId: row.resourceId,
          occurredAt: event.occurredAt,
          correlationId: row.correlationId,
          causationId: row.causationId,
          result: event.result,
          ...(event.reasonCode ? { reasonCode: event.reasonCode } : {}),
          ...(event.factorState ? { factorState: event.factorState } : {}),
          ...(event.challengeMethod ? { challengeMethod: event.challengeMethod } : {}),
          idempotencyKey: event.idempotencyKey,
        })
      }
      const result = await db.prepare(
        'UPDATE auth_007_mfa_operation_receipts SET status = ?, next_attempt_at = NULL, ' +
        'last_error_code = NULL WHERE receipt_id = ? AND status = ?',
      ).bind('EMITTED', row.receiptId, 'READY').run()
      if (result.success && result.meta?.changes === 1) {
        emitted += 1
      } else {
        // A concurrent Cron invocation may already have finalized the receipt.
        // Prove that state before treating the failed compare-and-set as safe.
        const latest = await loadReceipt(db, row.receiptId)
        if (latest.status !== 'EMITTED') {
          throw new Error('MFA_AUDIT_RECEIPT_MARK_EMITTED_FAILED')
        }
      }
    } catch {
      const delay = retryDelaySeconds(row.attempt)
      const nextAttemptAt = new Date(Date.parse(now) + delay * 1000).toISOString()
      try {
        await db.prepare(
          'UPDATE auth_007_mfa_operation_receipts SET attempt = attempt + 1, next_attempt_at = ?, ' +
          'last_error_code = ? WHERE receipt_id = ? AND status = ?',
        ).bind(nextAttemptAt, 'OUTBOX_WRITE_FAILED', row.receiptId, 'READY').run()
      } catch {
        // Leave READY durable so the next scheduled tick can retry it.
      }
      failed += 1
    }
  }

  return { selected: rows.length, emitted, failed, unknown }
}
