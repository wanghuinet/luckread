import { describe, expect, it, vi } from 'vitest'
import { consumeMfaAuditEvent } from './mfa-audit-queue-consumer'
import type { AuditEvent } from './audit-event.js'
import type { AuditEventStore } from './audit-event-store.js'

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

function storedEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    eventId: event.eventId,
    requestId: event.correlationId,
    traceId: event.causationId,
    actor: { actorId: event.resourceId, actorType: 'user' },
    action: event.eventType,
    targetType: 'User',
    targetId: event.resourceId,
    before: {},
    after: { ...event.payload },
    occurredAt: event.occurredAt,
    ...overrides,
  }
}

function createStore(
  existing: AuditEvent | null = null,
  appendError?: Error,
) {
  const findByEventId = vi.fn(async () => existing)
  const append = vi.fn(async (_event: AuditEvent) => {
    if (appendError) throw appendError
  })
  const store: AuditEventStore = { findByEventId, append }
  return { store, findByEventId, append }
}

describe('AUTH-007 W06 MFA audit queue consumer', () => {
  it('rejects malformed event IDs before touching canonical audit storage', async () => {
    const malformed = { ...event, eventId: 'evt_0123456789abcdef' }
    const { store, findByEventId, append } = createStore()
    await expect(consumeMfaAuditEvent(store, malformed)).rejects.toThrow('INVALID_AUTH_007_MFA_EVENT')
    expect(findByEventId).not.toHaveBeenCalled()
    expect(append).not.toHaveBeenCalled()
  })

  it('rejects malformed or oversized idempotency keys before touching canonical audit storage', async () => {
    const { store, findByEventId } = createStore()
    for (const idempotencyKey of ['mfa bad key', 'x'.repeat(256)]) {
      const malformed = { ...event, idempotencyKey }
      await expect(consumeMfaAuditEvent(store, malformed)).rejects.toThrow('INVALID_AUTH_007_MFA_EVENT')
    }
    expect(findByEventId).not.toHaveBeenCalled()
  })

  it('persists a safe MFA event into canonical AuditEvent storage', async () => {
    const { store, findByEventId, append } = createStore()
    await expect(consumeMfaAuditEvent(store, event)).resolves.toBe('persisted')
    expect(findByEventId).toHaveBeenCalledWith(event.eventId)
    expect(append).toHaveBeenCalledOnce()
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      eventId: event.eventId,
      action: event.eventType,
      targetType: 'User',
      targetId: event.resourceId,
      actor: { actorId: event.resourceId, actorType: 'user' },
      before: {},
      after: event.payload,
    }))
  })

  it('deduplicates repeated delivery by eventId', async () => {
    const { store, findByEventId, append } = createStore(storedEvent())
    await expect(consumeMfaAuditEvent(store, event)).resolves.toBe('duplicate')
    expect(findByEventId).toHaveBeenCalledOnce()
    expect(append).not.toHaveBeenCalled()
  })

  it('deduplicates timestamps with PostgreSQL microseconds beyond JavaScript Date precision', async () => {
    const microsecondEvent = {
      ...event,
      occurredAt: '2026-10-24T14:00:00.123456Z',
    }
    const existing = storedEvent({ occurredAt: '2026-10-24T14:00:00.123Z' })
    const { store, append } = createStore(existing)

    await expect(consumeMfaAuditEvent(store, microsecondEvent)).resolves.toBe('duplicate')
    expect(append).not.toHaveBeenCalled()
  })

  it('rejects a reused eventId whose action or target user differs', async () => {
    const wrongAction = createStore(storedEvent({ action: 'auth.mfa.factor_disabled' }))
    await expect(consumeMfaAuditEvent(wrongAction.store, event))
      .rejects.toThrow('MFA_AUDIT_EVENT_IDENTITY_CONFLICT')

    const wrongSubject = createStore(storedEvent({ targetId: 'user-2' }))
    await expect(consumeMfaAuditEvent(wrongSubject.store, event))
      .rejects.toThrow('MFA_AUDIT_EVENT_IDENTITY_CONFLICT')
  })

  it('rejects a reused eventId whose persisted event payload differs', async () => {
    const wrongPayload = createStore(storedEvent({
      after: { ...event.payload, result: 'succeeded' },
    }))
    await expect(consumeMfaAuditEvent(wrongPayload.store, event))
      .rejects.toThrow('MFA_AUDIT_EVENT_IDENTITY_CONFLICT')
  })

  it('rejects client-injected actor identity and payload secrets before Store access', async () => {
    const { store, findByEventId } = createStore()
    const wrongActor = { ...event, actor: { actorId: 'other-user', actorType: 'user' } }
    await expect(consumeMfaAuditEvent(store, wrongActor)).rejects.toThrow('INVALID_AUTH_007_MFA_EVENT')

    const secretPayload = { ...event, payload: { ...event.payload, code: '123456' } }
    await expect(consumeMfaAuditEvent(store, secretPayload)).rejects.toThrow('INVALID_AUTH_007_MFA_EVENT')
    expect(findByEventId).not.toHaveBeenCalled()
  })

  it('rejects event names or operation IDs outside the canonical mapping', async () => {
    const { store, findByEventId } = createStore()
    const invalidEvent = { ...event, eventType: 'auth.mfa.unknown' }
    await expect(consumeMfaAuditEvent(store, invalidEvent)).rejects.toThrow('INVALID_AUTH_007_MFA_EVENT')
    const inheritedPropertyEvent = { ...event, eventType: 'toString' }
    await expect(consumeMfaAuditEvent(store, inheritedPropertyEvent)).rejects.toThrow('INVALID_AUTH_007_MFA_EVENT')
    const invalidOperation = { ...event, payload: { ...event.payload, operationId: 'adminGrantL8' } }
    await expect(consumeMfaAuditEvent(store, invalidOperation)).rejects.toThrow('INVALID_AUTH_007_MFA_EVENT')
    expect(findByEventId).not.toHaveBeenCalled()
  })

  it('fails the queue attempt when AuditEvent persistence fails', async () => {
    const { store } = createStore(null, new Error('AUDIT_EVENT_PERSISTENCE_FAILED'))
    await expect(consumeMfaAuditEvent(store, event)).rejects.toThrow('AUDIT_EVENT_PERSISTENCE_FAILED')
  })
})
