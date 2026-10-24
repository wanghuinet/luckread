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

function createDb(existing = false, writeSuccess = true) {
  const first = vi.fn().mockResolvedValue(existing ? { eventId: event.eventId } : null)
  const run = vi.fn().mockResolvedValue({ success: writeSuccess })
  const bind = vi.fn(() => ({ first, run }))
  const prepare = vi.fn((sql: string) => ({ bind, sql }))
  return { db: { prepare } as unknown as D1Database, prepare, first, run, bind }
}

describe('AUTH-007 W06 MFA audit queue consumer', () => {
  it('persists a safe MFA event into canonical AuditEvent storage', async () => {
    const { db, prepare, run, bind } = createDb()
    await expect(consumeMfaAuditEvent(db, event)).resolves.toBe('persisted')
    expect(prepare).toHaveBeenCalledTimes(2)
    expect(run).toHaveBeenCalledTimes(1)
    const inserted = bind.mock.calls[1]
    expect(inserted).toBeDefined()
  })

  it('deduplicates repeated delivery by eventId', async () => {
    const { db, prepare, run } = createDb(true)
    await expect(consumeMfaAuditEvent(db, event)).resolves.toBe('duplicate')
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(run).not.toHaveBeenCalled()
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
    const invalidOperation = { ...event, payload: { ...event.payload, operationId: 'adminGrantL8' } }
    await expect(consumeMfaAuditEvent({ prepare: vi.fn() } as unknown as D1Database, invalidOperation))
      .rejects.toThrow('INVALID_AUTH_007_MFA_EVENT')
  })

  it('fails the queue attempt when AuditEvent persistence fails', async () => {
    const { db } = createDb(false, false)
    await expect(consumeMfaAuditEvent(db, event)).rejects.toThrow('AUDIT_EVENT_PERSISTENCE_FAILED')
  })
})
