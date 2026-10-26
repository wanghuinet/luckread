import { describe, expect, it, vi } from 'vitest'
import { consumeMfaAuditEvent } from './mfa-audit-queue-consumer'

const event = {
  eventId: 'evt_01234567890123456789012345678901',
  eventType: 'auth.mfa.enrollment_started',
  schemaVersion: '1.0',
  producer: 'W02',
  resourceType: 'User',
  resourceId: 'user-1',
  occurredAt: '2026-10-24T14:00:00.000Z',
  publishedAt: '2026-10-24T14:00:00.000Z',
  correlationId: 'corr-1',
  causationId: 'cause-1',
  idempotencyKey: 'mfa-evt_01234567890123456789012345678901',
  attempt: 1,
  sourceVersion: 1,
  actor: { actorId: 'user-1', actorType: 'user' },
  payload: { operationId: 'authMfaEnrollmentStart', result: 'started', factorState: 'PENDING_VERIFICATION' },
}

function createDb(existing = false, writeSuccess = true, existingOverrides: Record<string, unknown> = {}) {
  const existingRow = {
    eventId: event.eventId,
    requestId: event.correlationId,
    traceId: event.causationId,
    actorJson: JSON.stringify(event.actor),
    action: event.eventType,
    targetType: 'User',
    targetId: event.resourceId,
    beforeJson: '{}',
    afterJson: JSON.stringify(event.payload),
    reason: event.payload.reasonCode ?? null,
    occurredAt: event.occurredAt,
    ...existingOverrides,
  }
  const first = vi.fn().mockResolvedValue(existing ? existingRow : null)
  const run = vi.fn().mockResolvedValue({ success: writeSuccess })
  const bind = vi.fn(() => ({ first, run }))
  const prepare = vi.fn((sql: string) => ({ bind, sql }))
  return { db: { prepare } as unknown as D1Database, prepare, first, run, bind }
}

describe('AUTH-007 W06 MFA audit queue consumer', () => {

  it('rejects malformed event IDs before touching canonical audit storage', async () => {
    const malformed = { ...event, eventId: 'evt_0123456789abcdef' }
    const prepare = vi.fn()
    await expect(consumeMfaAuditEvent({ prepare } as unknown as D1Database, malformed))
      .rejects.toThrow('INVALID_AUTH_007_MFA_EVENT')
    expect(prepare).not.toHaveBeenCalled()
  })

  it('rejects malformed or oversized idempotency keys before touching canonical audit storage', async () => {
    for (const idempotencyKey of ['mfa bad key', 'x'.repeat(256)]) {
      const malformed = { ...event, idempotencyKey }
      const prepare = vi.fn()
      await expect(consumeMfaAuditEvent({ prepare } as unknown as D1Database, malformed))
        .rejects.toThrow('INVALID_AUTH_007_MFA_EVENT')
      expect(prepare).not.toHaveBeenCalled()
    }
  })

  it('persists a safe MFA event into canonical AuditEvent storage', async () => {
    const { db, prepare, run } = createDb()
    await expect(consumeMfaAuditEvent(db, event)).resolves.toBe('persisted')
    expect(prepare).toHaveBeenCalledTimes(2)
    expect(run).toHaveBeenCalledTimes(1)
    expect(prepare).toHaveBeenLastCalledWith(expect.stringContaining('INSERT INTO audit_events'))
  })

  it('deduplicates repeated delivery by eventId', async () => {
    const { db, prepare, run } = createDb(true)
    await expect(consumeMfaAuditEvent(db, event)).resolves.toBe('duplicate')
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects a reused eventId whose action or target user differs', async () => {
    const wrongAction = createDb(true, true, { action: 'auth.mfa.factor_disabled' })
    await expect(consumeMfaAuditEvent(wrongAction.db, event))
      .rejects.toThrow('MFA_AUDIT_EVENT_IDENTITY_CONFLICT')

    const wrongSubject = createDb(true, true, { targetId: 'user-2' })
    await expect(consumeMfaAuditEvent(wrongSubject.db, event))
      .rejects.toThrow('MFA_AUDIT_EVENT_IDENTITY_CONFLICT')
  })

  it('rejects a reused eventId whose persisted event payload differs', async () => {
    const wrongPayload = createDb(true, true, {
      afterJson: JSON.stringify({ ...event.payload, result: 'succeeded' }),
    })
    await expect(consumeMfaAuditEvent(wrongPayload.db, event))
      .rejects.toThrow('MFA_AUDIT_EVENT_IDENTITY_CONFLICT')
  })

  it('rejects client-injected actor identity and payload secrets', async () => {
    const wrongActor = { ...event, actor: { actorId: 'other-user', actorType: 'user' } }
    await expect(consumeMfaAuditEvent({ prepare: vi.fn() } as unknown as D1Database, wrongActor))
      .rejects.toThrow('INVALID_AUTH_007_MFA_EVENT')

    const secretPayload = { ...event, payload: { ...event.payload, code: '123456' } }
    await expect(consumeMfaAuditEvent({ prepare: vi.fn() } as unknown as D1Database, secretPayload))
      .rejects.toThrow('INVALID_AUTH_007_MFA_EVENT')
  })

  it('rejects event names or operation IDs outside the canonical mapping', async () => {
    const invalidEvent = { ...event, eventType: 'auth.mfa.unknown' }
    await expect(consumeMfaAuditEvent({ prepare: vi.fn() } as unknown as D1Database, invalidEvent))
      .rejects.toThrow('INVALID_AUTH_007_MFA_EVENT')
    const inheritedPropertyEvent = { ...event, eventType: 'toString' }
    const prepare = vi.fn()
    await expect(consumeMfaAuditEvent({ prepare } as unknown as D1Database, inheritedPropertyEvent))
      .rejects.toThrow('INVALID_AUTH_007_MFA_EVENT')
    expect(prepare).not.toHaveBeenCalled()
    const invalidOperation = { ...event, payload: { ...event.payload, operationId: 'adminGrantL8' } }
    await expect(consumeMfaAuditEvent({ prepare: vi.fn() } as unknown as D1Database, invalidOperation))
      .rejects.toThrow('INVALID_AUTH_007_MFA_EVENT')
  })

  it('fails the queue attempt when AuditEvent persistence fails', async () => {
    const { db } = createDb(false, false)
    await expect(consumeMfaAuditEvent(db, event)).rejects.toThrow('AUDIT_EVENT_PERSISTENCE_FAILED')
  })
})
