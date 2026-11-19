import { describe, expect, it, vi } from 'vitest'
import { consumeSessionRevokedAuditEvent } from './session-revocation-audit-queue-consumer'
import type { AuditEvent } from './audit-event.js'
import type { AuditEventStore } from './audit-event-store.js'

const event = {
  eventId: 'evt_211a595ebdce47b1d5295d0af937dc4a',
  eventType: 'user.session.revoked',
  schemaVersion: '1.0',
  producer: 'W02',
  resourceType: 'Session',
  resourceId: 'session-1',
  occurredAt: '2026-11-06T00:00:00.000Z',
  publishedAt: '2026-11-06T00:00:01.000Z',
  correlationId: 'req_session_revocation_1',
  causationId: 'trace-session-1',
  idempotencyKey: 'AUTH010_SESSION_REVOKE_211a595ebdce47b1d5295d0af937dc4a',
  attempt: 1,
  sourceVersion: 1,
  actor: { actorId: 'user-1', actorType: 'user' },
  payload: { operationId: 'authSessionRevoke', result: 'succeeded', reasonCode: 'USER_INITIATED' },
}

function storedEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    eventId: event.eventId,
    requestId: event.correlationId,
    traceId: event.causationId,
    actor: { actorId: 'user-1', actorType: 'user' },
    action: event.eventType,
    targetType: 'Session',
    targetId: event.resourceId,
    before: { status: 'ACTIVE' },
    after: { status: 'REVOKED' },
    reason: 'USER_INITIATED',
    occurredAt: event.occurredAt,
    ...overrides,
  }
}

function createStore(
  existing: AuditEvent | null = null,
  appendError?: Error,
  raced: AuditEvent | null = null,
) {
  const findByEventId = vi.fn()
    .mockResolvedValueOnce(existing)
  if (raced !== null) findByEventId.mockResolvedValueOnce(raced)
  const append = vi.fn(async (_auditEvent: AuditEvent) => {
    if (appendError) throw appendError
  })
  const store: AuditEventStore = { findByEventId, append }
  return { store, findByEventId, append }
}

describe('AUTH-010 W06 session revocation audit consumer', () => {
  it('persists a safe immutable AuditEvent with the session as target', async () => {
    const { store, findByEventId, append } = createStore()
    await expect(consumeSessionRevokedAuditEvent(store, event)).resolves.toBe('persisted')
    expect(findByEventId).toHaveBeenCalledOnce()
    expect(append).toHaveBeenCalledOnce()
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      eventId: event.eventId,
      action: event.eventType,
      targetType: 'Session',
      targetId: event.resourceId,
      before: { status: 'ACTIVE' },
      after: { status: 'REVOKED' },
      reason: 'USER_INITIATED',
    }))
  })

  it('deduplicates repeated queue delivery by the canonical eventId', async () => {
    const { store, findByEventId, append } = createStore(storedEvent())
    await expect(consumeSessionRevokedAuditEvent(store, event)).resolves.toBe('duplicate')
    expect(findByEventId).toHaveBeenCalledOnce()
    expect(append).not.toHaveBeenCalled()
  })

  it('treats a concurrent identical insert winner as a duplicate delivery', async () => {
    const { store, findByEventId, append } = createStore(
      null,
      new Error('AUDIT_EVENT_PERSISTENCE_FAILED'),
      storedEvent(),
    )

    await expect(consumeSessionRevokedAuditEvent(store, event)).resolves.toBe('duplicate')
    expect(findByEventId).toHaveBeenCalledTimes(2)
    expect(append).toHaveBeenCalledOnce()
  })

  it('rejects a concurrent insert winner with conflicting event identity', async () => {
    const conflict = storedEvent({ actor: { actorId: 'attacker', actorType: 'user' } })
    const { store } = createStore(null, new Error('AUDIT_EVENT_PERSISTENCE_FAILED'), conflict)

    await expect(consumeSessionRevokedAuditEvent(store, event))
      .rejects.toThrow('SESSION_AUDIT_EVENT_IDENTITY_CONFLICT')
  })

  it('deduplicates timestamps with PostgreSQL microseconds beyond JavaScript Date precision', async () => {
    const microsecondEvent = {
      ...event,
      occurredAt: '2026-11-06T00:00:00.123456Z',
    }
    const existing = storedEvent({ occurredAt: '2026-11-06T00:00:00.123Z' })
    const { store, append } = createStore(existing)

    await expect(consumeSessionRevokedAuditEvent(store, microsecondEvent)).resolves.toBe('duplicate')
    expect(append).not.toHaveBeenCalled()
  })

  it('rejects reused event IDs whose actor, action, target or state differs', async () => {
    const conflicts: Partial<AuditEvent>[] = [
      { action: 'identity.account_state_changed' },
      { targetType: 'User' },
      { targetId: 'session-2' },
      { after: { status: 'ACTIVE' } },
      { actor: { actorId: 'user-2', actorType: 'user' } },
    ]
    for (const override of conflicts) {
      const { store } = createStore(storedEvent(override))
      await expect(consumeSessionRevokedAuditEvent(store, event))
        .rejects.toThrow('SESSION_AUDIT_EVENT_IDENTITY_CONFLICT')
    }
  })

  it('rejects malformed envelope, injected actor and secret payload before Store access', async () => {
    const malformed = [
      { ...event, eventType: 'auth.mfa.enrollment_started' },
      { ...event, actor: { actorId: 'user-2', actorType: 'user' } },
      { ...event, payload: { ...event.payload, token: 'secret' } },
      { ...event, resourceType: 'User' },
      { ...event, attempt: 2 },
    ]
    const { store, findByEventId, append } = createStore()
    for (const value of malformed) {
      await expect(consumeSessionRevokedAuditEvent(store, value))
        .rejects.toThrow('INVALID_AUTH_010_SESSION_EVENT')
    }
    expect(findByEventId).not.toHaveBeenCalled()
    expect(append).not.toHaveBeenCalled()
  })

  it('fails the queue attempt when canonical AuditEvent persistence fails', async () => {
    const { store } = createStore(null, new Error('AUDIT_EVENT_PERSISTENCE_FAILED'))
    await expect(consumeSessionRevokedAuditEvent(store, event))
      .rejects.toThrow('AUDIT_EVENT_PERSISTENCE_FAILED')
  })

  it('persists the distinct logout audit reason without changing event identity', async () => {
    const logoutEvent = {
      ...event,
      payload: { operationId: 'authLogout', result: 'succeeded', reasonCode: 'USER_LOGOUT' },
    }
    const { store, append } = createStore()
    await expect(consumeSessionRevokedAuditEvent(store, logoutEvent)).resolves.toBe('persisted')
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ reason: 'USER_LOGOUT' }))

    const duplicate = createStore(storedEvent({ reason: 'USER_LOGOUT' }))
    await expect(consumeSessionRevokedAuditEvent(duplicate.store, logoutEvent)).resolves.toBe('duplicate')
  })

  it('rejects logout events whose operation and reason do not match', async () => {
    const malformed = {
      ...event,
      payload: { operationId: 'authLogout', result: 'succeeded', reasonCode: 'USER_INITIATED' },
    }
    const { store, findByEventId } = createStore()
    await expect(consumeSessionRevokedAuditEvent(store, malformed))
      .rejects.toThrow('INVALID_AUTH_010_SESSION_EVENT')
    expect(findByEventId).not.toHaveBeenCalled()
  })
})
