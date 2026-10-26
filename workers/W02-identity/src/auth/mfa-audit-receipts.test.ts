import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMfaAuditOperationReceipt,
  finalizeMfaAuditOperationReceipt,
  reconcileMfaAuditOperationReceipts,
  type MfaAuditReceiptEvent,
} from './mfa-audit-receipts'

type Receipt = {
  receiptId: string
  resourceId: string
  operationPath: string
  status: string
  startedAt: string
  completedAt: string | null
  correlationId: string
  causationId: string
  eventPlan: string | null
  attempt: number
  nextAttemptAt: string | null
  lastErrorCode: string | null
}

function createDb() {
  const receipts = new Map<string, Receipt>()
  const outbox = new Map<string, { eventId: string; payload: string }>()
  let failNextOutboxInsert = false
  let failNextReceiptInsertAfterCommit = false
  const prepare = vi.fn((sql: string) => ({
    bind: (...args: unknown[]) => ({
      run: async () => {
        if (sql.includes('INSERT INTO auth_007_mfa_operation_receipts')) {
          const [receiptId, resourceId, operationPath, isChallenge, status, startedAt, correlationId, causationId] = args
          receipts.set(String(receiptId), {
            receiptId: String(receiptId),
            resourceId: String(resourceId),
            operationPath: String(operationPath),
            status: String(status),
            startedAt: String(startedAt),
            completedAt: null,
            correlationId: String(correlationId),
            causationId: String(causationId),
            eventPlan: null,
            attempt: 0,
            nextAttemptAt: null,
            lastErrorCode: null,
          })
          expect(isChallenge === 0 || isChallenge === 1).toBe(true)
          if (failNextReceiptInsertAfterCommit) {
            failNextReceiptInsertAfterCommit = false
            throw new Error('synthetic D1 response loss after receipt commit')
          }
          return { success: true, meta: { changes: 1 } }
        }

        if (sql.includes('INSERT INTO auth_007_mfa_publication_journal')) {
          if (failNextOutboxInsert) {
            failNextOutboxInsert = false
            throw new Error('synthetic transient D1 failure')
          }
          const [journalId, eventId, eventType, schemaVersion, resourceId, sourceVersion, idempotencyKey, payload] = args
          if (outbox.has(String(idempotencyKey))) {
            return { success: false, meta: { changes: 0 } }
          }
          outbox.set(String(idempotencyKey), {
            eventId: String(eventId),
            payload: String(payload),
          })
          expect(String(journalId)).toBeTruthy()
          expect(String(eventType)).toMatch(/^auth\.mfa\./)
          expect(schemaVersion).toBe('1.0')
          expect(String(resourceId)).toBeTruthy()
          expect(sourceVersion).toBe(1)
          return { success: true, meta: { changes: 1 } }
        }

        if (sql.includes('UPDATE auth_007_mfa_operation_receipts') && sql.includes('SET event_plan = ?')) {
          const [eventPlan, receiptId] = args
          const row = receipts.get(String(receiptId))
          if (!row || !['STARTED', 'READY'].includes(row.status)) return { success: true, meta: { changes: 0 } }
          row.eventPlan = String(eventPlan)
          return { success: true, meta: { changes: 1 } }
        }

        if (sql.includes('UPDATE auth_007_mfa_operation_receipts') && sql.includes('SET status = ?, event_plan = ?, completed_at = ?')) {
          const [status, eventPlan, completedAt, receiptId] = args
          const row = receipts.get(String(receiptId))
          if (!row || !['STARTED', 'READY'].includes(row.status)) return { success: true, meta: { changes: 0 } }
          row.status = String(status)
          row.eventPlan = String(eventPlan)
          row.completedAt = String(completedAt)
          row.nextAttemptAt = null
          row.lastErrorCode = null
          return { success: true, meta: { changes: 1 } }
        }

        if (sql.includes('SET status = ?, last_error_code = ?, next_attempt_at = NULL') && sql.includes('started_at <= ?')) {
          const [status, errorCode, priorStatus, staleBefore] = args
          let changes = 0
          for (const row of receipts.values()) {
            if (row.status === priorStatus && row.startedAt <= String(staleBefore)) {
              row.status = String(status)
              row.lastErrorCode = String(errorCode)
              row.nextAttemptAt = null
              changes += 1
            }
          }
          return { success: true, meta: { changes } }
        }

        if (sql.includes("SET status = ?, last_error_code = ?, next_attempt_at = NULL WHERE receipt_id = ?")) {
          const [status, errorCode, receiptId, priorStatus] = args
          const row = receipts.get(String(receiptId))
          if (!row || row.status !== priorStatus) return { success: true, meta: { changes: 0 } }
          row.status = String(status)
          row.lastErrorCode = String(errorCode)
          row.nextAttemptAt = null
          return { success: true, meta: { changes: 1 } }
        }

        if (sql.includes("SET status = ?, next_attempt_at = NULL, last_error_code = NULL WHERE receipt_id = ?")) {
          const [status, receiptId, priorStatus] = args
          const row = receipts.get(String(receiptId))
          if (!row || row.status !== priorStatus) return { success: true, meta: { changes: 0 } }
          row.status = String(status)
          row.nextAttemptAt = null
          row.lastErrorCode = null
          return { success: true, meta: { changes: 1 } }
        }

        if (sql.includes('SET attempt = attempt + 1, next_attempt_at = ?')) {
          const [nextAttemptAt, errorCode, receiptId, priorStatus] = args
          const row = receipts.get(String(receiptId))
          if (!row || row.status !== priorStatus) return { success: true, meta: { changes: 0 } }
          row.attempt += 1
          row.nextAttemptAt = String(nextAttemptAt)
          row.lastErrorCode = String(errorCode)
          return { success: true, meta: { changes: 1 } }
        }

        throw new Error('Unhandled test SQL: ' + sql)
      },
      first: async () => {
        if (sql.includes('FROM auth_007_mfa_operation_receipts WHERE receipt_id = ?')) {
          const row = receipts.get(String(args[0]))
          return row ? {
            receiptId: row.receiptId,
            resourceId: row.resourceId,
            operationPath: row.operationPath,
            status: row.status,
            startedAt: row.startedAt,
            completedAt: row.completedAt,
            correlationId: row.correlationId,
            causationId: row.causationId,
            eventPlan: row.eventPlan,
            attempt: row.attempt,
          } : null
        }
        if (sql.includes('FROM auth_007_mfa_publication_journal WHERE idempotency_key = ?')) {
          const row = outbox.get(String(args[0]))
          return row ? { eventId: row.eventId } : null
        }
        throw new Error('Unhandled test SQL first: ' + sql)
      },
      all: async () => {
        if (sql.includes('FROM auth_007_mfa_operation_receipts') && sql.includes('WHERE status = ?')) {
          const [status, now, limit] = args
          return {
            results: [...receipts.values()]
              .filter((row) => row.status === status && (!row.nextAttemptAt || row.nextAttemptAt <= String(now)))
              .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
              .slice(0, Number(limit))
              .map((row) => ({
                receiptId: row.receiptId,
                resourceId: row.resourceId,
                status: row.status,
                startedAt: row.startedAt,
                completedAt: row.completedAt,
                correlationId: row.correlationId,
                causationId: row.causationId,
                eventPlan: row.eventPlan,
                attempt: row.attempt,
              })),
          }
        }
        throw new Error('Unhandled test SQL all: ' + sql)
      },
    }),
  }))

  return {
    db: { prepare } as unknown as D1Database,
    receipts,
    outbox,
    failNextOutboxInsert: () => { failNextOutboxInsert = true },
    failNextReceiptInsertAfterCommit: () => { failNextReceiptInsertAfterCommit = true },
  }
}

const startedAt = '2026-10-26T12:00:00.000Z'
const successEvent: MfaAuditReceiptEvent = {
  eventType: 'auth.mfa.challenge_succeeded',
  result: 'succeeded',
  reasonCode: 'CHALLENGE_VERIFIED',
  challengeMethod: 'totp',
}

describe('AUTH-007 durable MFA operation receipts', () => {
  let store: ReturnType<typeof createDb>

  beforeEach(() => {
    store = createDb()
  })

  it('read-backs a receipt when D1 commits the insert but its response is lost', async () => {
    store.failNextReceiptInsertAfterCommit()

    const receiptId = await createMfaAuditOperationReceipt(store.db, {
      userId: 'user-123',
      operationPath: '/two-factor/verify-totp',
      isChallenge: true,
      now: startedAt,
    })

    expect(store.receipts.get(receiptId)?.status).toBe('STARTED')
    expect(store.receipts.size).toBe(1)
  })

  it('persists a secret-free operation intent before the caller can mutate MFA state', async () => {
    const receiptId = await createMfaAuditOperationReceipt(store.db, {
      userId: 'user-123',
      operationPath: '/two-factor/verify-totp',
      isChallenge: true,
      correlationId: 'corr-123',
      causationId: 'req-123',
      now: startedAt,
    })

    const receipt = store.receipts.get(receiptId)
    expect(receipt?.status).toBe('STARTED')
    expect(receipt?.eventPlan).toBeNull()
    expect(JSON.stringify(receipt)).not.toMatch(/password|secret|recoveryCodes|backupCodes|session_token|123456/)
  })

  it('persists the outcome before creating one idempotent outbox event', async () => {
    const receiptId = await createMfaAuditOperationReceipt(store.db, {
      userId: 'user-123',
      operationPath: '/two-factor/verify-totp',
      isChallenge: true,
      now: startedAt,
    })
    await finalizeMfaAuditOperationReceipt(store.db, receiptId, [successEvent], startedAt)

    expect(store.receipts.get(receiptId)?.status).toBe('READY')
    await expect(reconcileMfaAuditOperationReceipts(store.db, startedAt)).resolves.toEqual({
      selected: 1,
      emitted: 1,
      failed: 0,
      unknown: 0,
    })
    expect(store.receipts.get(receiptId)?.status).toBe('EMITTED')
    expect(store.outbox.size).toBe(1)
    await reconcileMfaAuditOperationReceipts(store.db, '2026-10-26T12:01:00.000Z')
    expect(store.outbox.size).toBe(1)
  })

  it('keeps a ready receipt retryable when the outbox insert fails, then recovers on a later cron tick', async () => {
    const receiptId = await createMfaAuditOperationReceipt(store.db, {
      userId: 'user-123',
      operationPath: '/two-factor/generate-backup-codes',
      isChallenge: false,
      now: startedAt,
    })
    await finalizeMfaAuditOperationReceipt(store.db, receiptId, [{
      eventType: 'auth.mfa.recovery_codes_rotated',
      result: 'succeeded',
      reasonCode: 'USER_INITIATED',
    }], startedAt)
    store.failNextOutboxInsert()

    await expect(reconcileMfaAuditOperationReceipts(store.db, startedAt)).resolves.toEqual({
      selected: 1,
      emitted: 0,
      failed: 1,
      unknown: 0,
    })
    expect(store.receipts.get(receiptId)?.status).toBe('READY')
    expect(store.receipts.get(receiptId)?.lastErrorCode).toBe('OUTBOX_WRITE_FAILED')

    await expect(reconcileMfaAuditOperationReceipts(store.db, '2026-10-26T12:00:05.000Z')).resolves.toEqual({
      selected: 1,
      emitted: 1,
      failed: 0,
      unknown: 0,
    })
    expect(store.receipts.get(receiptId)?.status).toBe('EMITTED')
    expect(store.outbox.size).toBe(1)
  })

  it('marks a crashed or unfinalized operation UNKNOWN instead of inventing an outcome', async () => {
    const receiptId = await createMfaAuditOperationReceipt(store.db, {
      userId: 'user-123',
      operationPath: '/two-factor/disable',
      isChallenge: false,
      now: startedAt,
    })

    const summary = await reconcileMfaAuditOperationReceipts(store.db, '2026-10-26T12:06:00.000Z')
    expect(summary.unknown).toBe(1)
    expect(store.receipts.get(receiptId)?.status).toBe('UNKNOWN')
    expect(store.receipts.get(receiptId)?.lastErrorCode).toBe('OUTCOME_NOT_FINALIZED')
    expect(store.outbox.size).toBe(0)
  })

  it('retains two distinct events for a successful recovery-code login challenge', async () => {
    const receiptId = await createMfaAuditOperationReceipt(store.db, {
      userId: 'user-123',
      operationPath: '/two-factor/verify-backup-code',
      isChallenge: true,
      now: startedAt,
    })
    await finalizeMfaAuditOperationReceipt(store.db, receiptId, [
      { eventType: 'auth.mfa.challenge_succeeded', result: 'succeeded', challengeMethod: 'recovery_code' },
      { eventType: 'auth.mfa.recovery_code_consumed', result: 'succeeded', challengeMethod: 'recovery_code' },
    ], startedAt)
    await reconcileMfaAuditOperationReceipts(store.db, startedAt)

    expect(store.receipts.get(receiptId)?.status).toBe('EMITTED')
    expect(store.outbox.size).toBe(2)
  })
})
