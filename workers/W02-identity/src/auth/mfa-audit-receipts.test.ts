import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deriveMfaAuditEventIdForIdempotencyKey } from './mfa-audit-events'
import {
  appendMfaAuditOperationReceiptEvent,
  assertMfaAuditOperationReceiptOwner,
  createMfaAuditOperationReceipt,
  finalizeMfaAuditOperationReceipt,
  reconcileMfaAuditOperationReceipts,
  type MfaAuditReceiptEvent,
} from './mfa-audit-receipts'

type Receipt = {
  receiptId: string
  resourceId: string
  operationPath: string
  isChallenge: number | boolean
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
  const outbox = new Map<string, { eventId: string; payload: string; status: 'PENDING' | 'PUBLISHED' | 'FAILED' }>()
  let failNextOutboxInsert = false
  let failNextReceiptInsertAfterCommit = false
  let failNextReceiptAppendAfterCommit = false
  const prepare = vi.fn((sql: string) => ({
    bind: (...args: unknown[]) => ({
      run: async () => {
        if (sql.includes('INSERT INTO auth_007_mfa_operation_receipts')) {
          const [receiptId, resourceId, operationPath, isChallenge, status, startedAt, correlationId, causationId] = args
          receipts.set(String(receiptId), {
            receiptId: String(receiptId),
            resourceId: String(resourceId),
            operationPath: String(operationPath),
            isChallenge: isChallenge as number | boolean,
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
            status: 'PENDING',
          })
          expect(String(journalId)).toBeTruthy()
          expect(String(eventType)).toMatch(/^auth\.mfa\./)
          expect(schemaVersion).toBe('1.0')
          expect(String(resourceId)).toBeTruthy()
          expect(sourceVersion).toBe(1)
          return { success: true, meta: { changes: 1 } }
        }

        if (sql.includes('UPDATE auth_007_mfa_operation_receipts') &&
            sql.includes('SET event_plan = ?') && sql.includes('AND event_plan = ?')) {
          const [eventPlan, receiptId, priorStatus, previousPlan] = args
          const row = receipts.get(String(receiptId))
          if (!row || row.status !== priorStatus || row.eventPlan !== previousPlan) {
            return { success: true, meta: { changes: 0 } }
          }
          row.eventPlan = String(eventPlan)
          return { success: true, meta: { changes: 1 } }
        }

        if (sql.includes('UPDATE auth_007_mfa_operation_receipts') && sql.includes('SET event_plan = ?')) {
          const [eventPlan, receiptId] = args
          const row = receipts.get(String(receiptId))
          if (!row || !['STARTED', 'READY'].includes(row.status)) return { success: true, meta: { changes: 0 } }
          row.eventPlan = String(eventPlan)
          if (failNextReceiptAppendAfterCommit) {
            failNextReceiptAppendAfterCommit = false
            throw new Error('synthetic D1 response loss after receipt event append')
          }
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

        if (sql.includes("SET status = ?, next_attempt_at = NULL, last_error_code = ? WHERE receipt_id = ? AND status = ?")) {
          const [status, errorCode, receiptId, priorStatus] = args
          const row = receipts.get(String(receiptId))
          if (!row || row.status !== priorStatus) return { success: true, meta: { changes: 0 } }
          row.status = String(status)
          row.lastErrorCode = String(errorCode)
          row.nextAttemptAt = null
          return { success: true, meta: { changes: 1 } }
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
            isChallenge: row.isChallenge,
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
          if (!row) return null
          const payload = JSON.parse(row.payload) as {
            eventType: string
            resourceId: string
            payload: {
              operationId: string
              result: string
              reasonCode?: string
              factorState?: string
              challengeMethod?: string
            }
          }
          return {
            eventId: row.eventId,
            eventType: payload.eventType,
            status: row.status,
            resourceId: payload.resourceId,
            operationId: payload.payload.operationId,
            result: payload.payload.result,
            reasonCode: payload.payload.reasonCode ?? null,
            factorState: payload.payload.factorState ?? null,
            challengeMethod: payload.payload.challengeMethod ?? null,
          }
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
    failNextReceiptAppendAfterCommit: () => { failNextReceiptAppendAfterCommit = true },
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


  it('only permits a nested Better Auth receipt handoff for the same subject, path and challenge mode', async () => {
    const receiptId = await createMfaAuditOperationReceipt(store.db, {
      userId: 'user-123',
      operationPath: '/two-factor/verify-totp',
      isChallenge: false,
      now: startedAt,
    })
    await expect(assertMfaAuditOperationReceiptOwner(store.db, {
      receiptId,
      userId: 'user-123',
      operationPath: '/two-factor/verify-totp',
      isChallenge: false,
    })).resolves.toBeUndefined()
    await expect(assertMfaAuditOperationReceiptOwner(store.db, {
      receiptId,
      userId: 'another-user',
      operationPath: '/two-factor/verify-totp',
      isChallenge: false,
    })).rejects.toThrow('MFA_AUDIT_RECEIPT_CONTEXT_MISMATCH')
    await expect(assertMfaAuditOperationReceiptOwner(store.db, {
      receiptId,
      userId: 'user-123',
      operationPath: '/two-factor/verify-backup-code',
      isChallenge: false,
    })).rejects.toThrow('MFA_AUDIT_RECEIPT_CONTEXT_MISMATCH')
    await expect(assertMfaAuditOperationReceiptOwner(store.db, {
      receiptId,
      userId: 'user-123',
      operationPath: '/two-factor/verify-totp',
      isChallenge: true,
    })).rejects.toThrow('MFA_AUDIT_RECEIPT_CONTEXT_MISMATCH')
  })

  it('read-backs an appended replay event if the D1 response is lost after commit', async () => {
    const receiptId = await createMfaAuditOperationReceipt(store.db, {
      userId: 'user-123',
      operationPath: '/two-factor/verify-totp',
      isChallenge: true,
      now: startedAt,
    })
    store.failNextReceiptAppendAfterCommit()

    await appendMfaAuditOperationReceiptEvent(store.db, receiptId, {
      eventType: 'auth.mfa.replay_rejected',
      result: 'rejected',
      reasonCode: 'TOTP_STEP_ALREADY_ACCEPTED',
      challengeMethod: 'totp',
      idempotencyKey: `mfa-operation:${receiptId}:auth.mfa.replay_rejected`,
      occurredAt: startedAt,
    })

    expect(store.receipts.get(receiptId)?.eventPlan).toContain('auth.mfa.replay_rejected')
  })

  it('rejects a receipt reasonCode that the canonical W06 consumer would reject', async () => {
    const receiptId = await createMfaAuditOperationReceipt(store.db, {
      userId: 'user-123',
      operationPath: '/two-factor/disable',
      isChallenge: false,
      now: startedAt,
    })

    await expect(finalizeMfaAuditOperationReceipt(store.db, receiptId, [{
      eventType: 'auth.mfa.factor_disabled',
      result: 'succeeded',
      reasonCode: 'INVALID:DOWNSTREAM',
    }], startedAt)).rejects.toThrow('INVALID_MFA_AUDIT_RECEIPT_PLAN')
    expect(store.receipts.get(receiptId)?.status).toBe('STARTED')
    expect(store.outbox.size).toBe(0)
  })

  it('rejects a retry that changes the durable result under the same idempotency key', async () => {
    const receiptId = await createMfaAuditOperationReceipt(store.db, {
      userId: 'user-123',
      operationPath: '/two-factor/verify-totp',
      isChallenge: true,
      now: startedAt,
    })
    const idempotencyKey = `mfa-operation:${receiptId}:auth.mfa.challenge_failed`
    await appendMfaAuditOperationReceiptEvent(store.db, receiptId, {
      eventType: 'auth.mfa.challenge_failed',
      result: 'failed',
      reasonCode: 'CHALLENGE_REJECTED',
      challengeMethod: 'totp',
      idempotencyKey,
      occurredAt: startedAt,
    })

    await expect(finalizeMfaAuditOperationReceipt(store.db, receiptId, [{
      eventType: 'auth.mfa.challenge_failed',
      result: 'succeeded',
      reasonCode: 'CHALLENGE_VERIFIED',
      challengeMethod: 'totp',
      idempotencyKey,
      occurredAt: startedAt,
    }], startedAt)).rejects.toThrow('MFA_AUDIT_EVENT_IDEMPOTENCY_CONFLICT')
    expect(store.receipts.get(receiptId)?.status).toBe('STARTED')
    expect(store.outbox.size).toBe(0)
  })

  it('rejects an explicitly supplied malformed eventId instead of replacing it', async () => {
    const receiptId = await createMfaAuditOperationReceipt(store.db, {
      userId: 'user-123',
      operationPath: '/two-factor/verify-totp',
      isChallenge: true,
      now: startedAt,
    })

    await expect(finalizeMfaAuditOperationReceipt(store.db, receiptId, [{
      eventType: 'auth.mfa.challenge_failed',
      eventId: 'evt_not-valid',
      result: 'failed',
      reasonCode: 'CHALLENGE_REJECTED',
      challengeMethod: 'totp',
      occurredAt: startedAt,
    }], startedAt)).rejects.toThrow('INVALID_MFA_AUDIT_RECEIPT_PLAN')
    expect(store.receipts.get(receiptId)?.status).toBe('STARTED')
    expect(store.outbox.size).toBe(0)
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
    const storedPlan = JSON.parse(store.receipts.get(receiptId)?.eventPlan ?? '[]') as Array<{ eventId: string; eventType: string; idempotencyKey: string }>
    const planned = storedPlan[0]
    expect(planned.eventId).toMatch(/^evt_[a-f0-9]{32}$/)
    expect(store.outbox.get(planned.idempotencyKey)?.eventId).toBe(planned.eventId)
    await reconcileMfaAuditOperationReceipts(store.db, '2026-10-26T12:01:00.000Z')
    expect(store.outbox.size).toBe(1)
    expect(store.outbox.get(planned.idempotencyKey)?.eventId).toBe(planned.eventId)
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


  it('reconciles the same lockout window across multiple receipts with one stable event id', async () => {
    const idempotencyKey = 'mfa-lock:user-123:1792850400000'
    const eventId = await deriveMfaAuditEventIdForIdempotencyKey(idempotencyKey)
    const event: MfaAuditReceiptEvent = {
      eventType: 'auth.mfa.locked',
      eventId,
      result: 'rejected',
      reasonCode: 'VERIFICATION_LOCKOUT',
      challengeMethod: 'totp',
      idempotencyKey,
      occurredAt: startedAt,
    }
    const firstReceiptId = await createMfaAuditOperationReceipt(store.db, {
      userId: 'user-123',
      operationPath: '/two-factor/verify-totp',
      isChallenge: true,
      now: startedAt,
    })
    const secondReceiptId = await createMfaAuditOperationReceipt(store.db, {
      userId: 'user-123',
      operationPath: '/two-factor/verify-totp',
      isChallenge: true,
      now: '2026-10-26T12:00:01.000Z',
    })
    await finalizeMfaAuditOperationReceipt(store.db, firstReceiptId, [event], startedAt)
    await finalizeMfaAuditOperationReceipt(store.db, secondReceiptId, [event], '2026-10-26T12:00:01.000Z')

    await expect(reconcileMfaAuditOperationReceipts(store.db, startedAt)).resolves.toEqual({
      selected: 2,
      emitted: 2,
      failed: 0,
      unknown: 0,
    })
    expect(store.receipts.get(firstReceiptId)?.status).toBe('EMITTED')
    expect(store.receipts.get(secondReceiptId)?.status).toBe('EMITTED')
    expect(store.outbox.size).toBe(1)
    expect([...store.outbox.values()][0]?.eventId).toBe(eventId)
  })


  it('adopts a previously published legacy lockout event id and persists it in the receipt plan', async () => {
    const idempotencyKey = 'mfa-lock:user-123:1792850400000'
    const desiredEventId = await deriveMfaAuditEventIdForIdempotencyKey(idempotencyKey)
    const legacyEventId = 'evt_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    const receiptId = await createMfaAuditOperationReceipt(store.db, {
      userId: 'user-123',
      operationPath: '/two-factor/verify-totp',
      isChallenge: true,
      now: startedAt,
    })
    await finalizeMfaAuditOperationReceipt(store.db, receiptId, [{
      eventType: 'auth.mfa.locked',
      // Simulate a receipt persisted by the earlier code before event IDs were
      // normalized for lockout-window idempotency.
      eventId: 'evt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      result: 'rejected',
      reasonCode: 'VERIFICATION_LOCKOUT',
      idempotencyKey,
      occurredAt: startedAt,
    }], startedAt)
    const originalPlan = JSON.parse(store.receipts.get(receiptId)?.eventPlan ?? '[]') as Array<{eventType:string;eventId:string;result:string;reasonCode:string;idempotencyKey:string;occurredAt:string}>
    const legacyPayload = {
      eventId: legacyEventId,
      eventType: 'auth.mfa.locked',
      schemaVersion: '1.0',
      producer: 'W02',
      resourceType: 'User',
      resourceId: 'user-123',
      occurredAt: startedAt,
      publishedAt: startedAt,
      correlationId: 'legacy-correlation',
      causationId: 'legacy-causation',
      idempotencyKey,
      attempt: 1,
      sourceVersion: 1,
      actor: {actorId:'user-123',actorType:'user'},
      payload: {
        operationId: 'authMfaChallengeVerify',
        result: 'rejected',
        reasonCode: 'VERIFICATION_LOCKOUT',
        challengeMethod: 'totp',
      },
    }
    store.outbox.set(idempotencyKey, {
      eventId: legacyEventId,
      payload: JSON.stringify(legacyPayload),
      status: 'PUBLISHED',
    })

    await expect(reconcileMfaAuditOperationReceipts(store.db, startedAt)).resolves.toEqual({
      selected: 1,
      emitted: 1,
      failed: 0,
      unknown: 0,
    })
    expect(originalPlan[0]?.eventId).toBe('evt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(store.receipts.get(receiptId)?.status).toBe('EMITTED')
    const persistedPlan = JSON.parse(store.receipts.get(receiptId)?.eventPlan ?? '[]') as Array<{eventId:string;idempotencyKey:string}>
    expect(persistedPlan.find((event) => event.idempotencyKey === idempotencyKey)?.eventId).toBe(legacyEventId)
    expect(store.outbox.get(idempotencyKey)?.eventId).toBe(legacyEventId)
  })


  it('marks a receipt UNKNOWN instead of retrying forever when its outbox row is permanently FAILED', async () => {
    const idempotencyKey = 'mfa-lock:user-123:1792850400000'
    const eventId = await deriveMfaAuditEventIdForIdempotencyKey(idempotencyKey)
    const receiptId = await createMfaAuditOperationReceipt(store.db, {
      userId: 'user-123',
      operationPath: '/two-factor/verify-totp',
      isChallenge: true,
      now: startedAt,
    })
    await finalizeMfaAuditOperationReceipt(store.db, receiptId, [{
      eventType: 'auth.mfa.locked',
      eventId,
      result: 'rejected',
      reasonCode: 'VERIFICATION_LOCKOUT',
      idempotencyKey,
      occurredAt: startedAt,
    }], startedAt)
    store.outbox.set(idempotencyKey, {
      eventId,
      status: 'FAILED',
      payload: JSON.stringify({
        eventId,
        eventType: 'auth.mfa.locked',
        resourceId: 'user-123',
        payload: {
          operationId: 'authMfaChallengeVerify',
          result: 'rejected',
          reasonCode: 'VERIFICATION_LOCKOUT',
        },
      }),
    })

    await expect(reconcileMfaAuditOperationReceipts(store.db, startedAt)).resolves.toEqual({
      selected: 1,
      emitted: 0,
      failed: 0,
      unknown: 1,
    })
    expect(store.receipts.get(receiptId)?.status).toBe('UNKNOWN')
    expect(store.receipts.get(receiptId)?.lastErrorCode).toBe('OUTBOX_PREVIOUSLY_FAILED')
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
