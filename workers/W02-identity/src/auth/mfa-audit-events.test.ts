import { describe, expect, it, vi } from 'vitest'
import { buildMfaAuditEvent, buildMfaAuditOutboxInsert, MFA_AUDIT_EVENT_NAMES, recordMfaAuditEventOnce } from './mfa-audit-events'

const input = {
  eventType: 'auth.mfa.locked' as const,
  userId: 'user-123',
  occurredAt: '2026-10-24T14:00:00.000Z',
  result: 'rejected' as const,
  reasonCode: 'VERIFICATION_LOCKOUT',
  challengeMethod: 'totp' as const,
  idempotencyKey: 'mfa-lock:user-123:1792850400000',
}

function fakeDb(options: {
  existing?: boolean
  insertSuccess?: boolean
  raceAppearsAfterInsert?: boolean
} = {}) {
  let selectCount = 0
  const first = vi.fn(async () => {
    selectCount += 1
    if (options.existing) return { eventId: 'evt_existing', eventType: 'auth.mfa.locked', resourceId: 'user-123', operationId: 'authMfaChallengeVerify', result: 'rejected', reasonCode: 'VERIFICATION_LOCKOUT', factorState: null, challengeMethod: 'totp' }
    if (options.raceAppearsAfterInsert && selectCount >= 2) return { eventId: 'evt_raced', eventType: 'auth.mfa.locked', resourceId: 'user-123', operationId: 'authMfaChallengeVerify', result: 'rejected', reasonCode: 'VERIFICATION_LOCKOUT', factorState: null, challengeMethod: 'totp' }
    return null
  })
  const run = vi.fn().mockResolvedValue({
    success: options.insertSuccess !== false,
    meta: { changes: options.insertSuccess === false ? 0 : 1 },
  })
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((...values: unknown[]) => ({
      first: () => first(),
      run: () => run(),
      sql,
    })),
  }))
  return { db: { prepare } as unknown as D1Database, prepare, first, run }
}

describe('AUTH-007 MFA audit event builder and idempotent writer', () => {
  it('builds a safe MFA lock event with a stable, bounded idempotency key', () => {
    const event = buildMfaAuditEvent(input)
    expect(event.eventType).toBe('auth.mfa.locked')
    expect(event.producer).toBe('W02')
    expect(event.resourceId).toBe('user-123')
    expect(event.idempotencyKey).toBe(input.idempotencyKey)
    expect(event.payload).toEqual({
      operationId: 'authMfaChallengeVerify',
      result: 'rejected',
      reasonCode: 'VERIFICATION_LOCKOUT',
      challengeMethod: 'totp',
    })
    expect(JSON.stringify(event)).not.toMatch(/password|secret|recoveryCodes|backupCodes|\"code\"/)
  })

  it('sets publishedAt to the durable publication-intent time, distinct from occurredAt', () => {
    const event = buildMfaAuditEvent(input)
    expect(Date.parse(event.publishedAt)).toBeGreaterThan(Date.parse(event.occurredAt))
    expect(event.occurredAt).toBe(input.occurredAt)
    expect(event.publishedAt).not.toBe(event.occurredAt)
  })

  it('persists the same immutable publishedAt in the envelope and outbox created_at field', () => {
    const event = buildMfaAuditEvent(input)
    let boundValues: unknown[] = []
    const db = {
      prepare: vi.fn(() => ({
        bind: (...values: unknown[]) => {
          boundValues = values
          return { run: vi.fn() }
        },
      })),
    } as unknown as D1Database

    buildMfaAuditOutboxInsert(db, event)
    const storedPayload = JSON.parse(String(boundValues[7])) as typeof event
    expect(storedPayload).toEqual(event)
    expect(boundValues[11]).toBe(event.publishedAt)
    expect(boundValues[12]).toBeNull()
    expect(storedPayload.publishedAt).not.toBe(storedPayload.occurredAt)
  })

  it('maps all ten canonical MFA event types to a stable action and valid event identity', () => {
    const expectedActions: Record<(typeof MFA_AUDIT_EVENT_NAMES)[number], string> = {
      'auth.mfa.enrollment_started': 'authMfaEnrollmentStart',
      'auth.mfa.enrollment_verified': 'authMfaEnrollmentConfirm',
      'auth.mfa.enrollment_failed': 'authMfaEnrollmentStart',
      'auth.mfa.challenge_succeeded': 'authMfaChallengeVerify',
      'auth.mfa.challenge_failed': 'authMfaChallengeVerify',
      'auth.mfa.factor_disabled': 'authMfaDisable',
      'auth.mfa.recovery_codes_rotated': 'authMfaRecoveryCodesRotate',
      'auth.mfa.recovery_code_consumed': 'authMfaChallengeVerify',
      'auth.mfa.locked': 'authMfaChallengeVerify',
      'auth.mfa.replay_rejected': 'authMfaChallengeVerify',
    }
    expect(Object.keys(expectedActions).sort()).toEqual([...MFA_AUDIT_EVENT_NAMES].sort())
    for (const eventType of MFA_AUDIT_EVENT_NAMES) {
      const event = buildMfaAuditEvent({ ...input, eventType })
      expect(event.eventId).toMatch(/^evt_[a-f0-9]{32}$/)
      expect(event.payload.operationId).toBe(expectedActions[eventType])
      expect(event.publishedAt).not.toBe(event.occurredAt)
    }
  })

  it('preserves a receipt-assigned eventId through the outbox envelope', () => {
    const eventId = 'evt_0123456789abcdef0123456789abcdef'
    const event = buildMfaAuditEvent({ ...input, eventId })
    expect(event.eventId).toBe(eventId)
    expect(() => buildMfaAuditEvent({ ...input, eventId: 'evt_not-a-valid-id' })).toThrow('invalid MFA audit event id')
  })

  it('inserts a lockout event once when its deterministic key is new', async () => {
    const { db, first, run } = fakeDb()
    await expect(recordMfaAuditEventOnce(db, input)).resolves.toBe(true)
    expect(first).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('does not write again if the same lockout window already exists', async () => {
    const { db, first, run } = fakeDb({ existing: true })
    await expect(recordMfaAuditEventOnce(db, input)).resolves.toBe(false)
    expect(first).toHaveBeenCalledTimes(1)
    expect(run).not.toHaveBeenCalled()
  })

  it('treats a concurrent insert of the same lockout key as already recorded after read-back', async () => {
    const { db, first, run } = fakeDb({ insertSuccess: false, raceAppearsAfterInsert: true })
    await expect(recordMfaAuditEventOnce(db, input)).resolves.toBe(false)
    expect(first).toHaveBeenCalledTimes(2)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('rejects a durable idempotency match whose canonical action differs', async () => {
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        first: async () => ({ eventId: 'evt_0123456789abcdef0123456789abcdef', eventType: 'auth.mfa.locked', resourceId: 'user-123', operationId: 'authMfaDisable', result: 'rejected', reasonCode: 'VERIFICATION_LOCKOUT', factorState: null, challengeMethod: 'totp' }),
        run: vi.fn(),
        sql,
      })),
    }))
    const db = { prepare } as unknown as D1Database
    await expect(recordMfaAuditEventOnce(db, {
      ...input,
      eventId: 'evt_0123456789abcdef0123456789abcdef',
    })).rejects.toThrow('MFA_AUDIT_EVENT_ACTION_CONFLICT')
  })

  it('rejects a durable idempotency match with a different stable eventId', async () => {
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        first: async () => ({
          eventId: 'evt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          eventType: 'auth.mfa.locked',
          resourceId: 'user-123',
          operationId: 'authMfaChallengeVerify',
          result: 'rejected',
          reasonCode: 'VERIFICATION_LOCKOUT',
          factorState: null,
          challengeMethod: 'totp',
        }),
        run: vi.fn(),
        sql,
      })),
    }))
    const db = { prepare } as unknown as D1Database
    await expect(recordMfaAuditEventOnce(db, {
      ...input,
      eventId: 'evt_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    })).rejects.toThrow('MFA_AUDIT_EVENT_ID_CONFLICT')
    expect(prepare.mock.calls[0]?.[0]).toContain("json_extract(payload, '$.payload.operationId')")
  })

  it('rejects an idempotency match for a different subject or outcome', async () => {
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        first: async () => ({
          eventId: 'evt_0123456789abcdef0123456789abcdef',
          eventType: 'auth.mfa.locked',
          resourceId: 'another-user',
          operationId: 'authMfaChallengeVerify',
          result: 'rejected',
          reasonCode: 'VERIFICATION_LOCKOUT',
          factorState: null,
          challengeMethod: 'totp',
        }),
        run: vi.fn(),
        sql,
      })),
    }))
    const db = { prepare } as unknown as D1Database
    await expect(recordMfaAuditEventOnce(db, input)).rejects.toThrow('MFA_AUDIT_EVENT_INTENT_CONFLICT')
  })

  it('fails when the insert is rejected and the idempotency key is not present', async () => {
    const { db } = fakeDb({ insertSuccess: false })
    await expect(recordMfaAuditEventOnce(db, input)).rejects.toThrow('MFA_AUDIT_OUTBOX_WRITE_FAILED')
  })
})
