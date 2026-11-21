import { describe, expect, it, vi } from 'vitest'
import { consumeAccountStateChanged, type IdentityAccountStateChangedEvent } from './auth-013-queue-consumer'
import type { AuditEventStore } from './audit-event-store.js'
import type { AuditEvent } from './audit-event.js'

const event: IdentityAccountStateChangedEvent = {
  eventId: 'evt-auth013-1',
  eventType: 'identity.account_state_changed',
  schemaVersion: '1.0',
  producer: 'W02',
  resourceType: 'User',
  resourceId: 'user-001',
  occurredAt: '2026-09-24T08:30:00.000Z',
  publishedAt: '2026-09-24T08:30:00.000Z',
  correlationId: 'corr-1',
  causationId: 'cause-1',
  idempotencyKey: 'auth013-user-001-1',
  attempt: 1,
  sourceVersion: 2,
  actor: {
    actorId: 'operator-1',
    actorType: 'user',
    operationalRole: 'PLATFORM_OPERATOR',
  },
  before: { accountState: 'ACTIVE', accountStateVersion: 1 },
  after: { accountState: 'RESTRICTED', accountStateVersion: 2 },
  reason: 'policy restriction',
}

function createStore(existing: AuditEvent | null = null) {
  const findByEventId = vi.fn(async () => existing)
  const append = vi.fn(async (_auditEvent: AuditEvent) => undefined)
  const store: AuditEventStore = { findByEventId, append }
  return { store, findByEventId, append }
}

describe('AUTH-013 W06 queue consumer', () => {
  it('persists a canonical event and retains PLATFORM_OPERATOR role', async () => {
    const { store, findByEventId, append } = createStore()

    await expect(consumeAccountStateChanged(store, event)).resolves.toBe('persisted')

    expect(findByEventId).toHaveBeenCalledWith(event.eventId)
    expect(append).toHaveBeenCalledOnce()
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      eventId: event.eventId,
      actor: expect.objectContaining({
        actorId: 'operator-1',
        actorType: 'user',
        operationalRole: 'PLATFORM_OPERATOR',
      }),
      action: 'identity.account_state_changed',
      targetType: 'User',
      targetId: 'user-001',
      before: { account_state: 'ACTIVE', account_state_version: 1 },
      after: { account_state: 'RESTRICTED', account_state_version: 2 },
    }))
  })

  it('acknowledges duplicates by eventId without a second write', async () => {
    const existing: AuditEvent = {
      eventId: event.eventId,
      requestId: event.correlationId,
      traceId: event.causationId,
      actor: { actorId: 'operator-1', actorType: 'user' },
      action: 'identity.account_state_changed',
      targetType: 'User',
      targetId: 'user-001',
      before: { account_state: 'ACTIVE', account_state_version: 1 },
      after: { account_state: 'RESTRICTED', account_state_version: 2 },
      reason: 'policy restriction',
      occurredAt: event.occurredAt,
    }
    const { store, findByEventId, append } = createStore(existing)

    await expect(consumeAccountStateChanged(store, event)).resolves.toBe('duplicate')

    expect(findByEventId).toHaveBeenCalledWith(event.eventId)
    expect(append).not.toHaveBeenCalled()
  })

  it('rejects a non-canonical producer envelope before Store access', async () => {
    const { store, findByEventId, append } = createStore()

    await expect(
      consumeAccountStateChanged(store, { ...event, producer: 'W06' }),
    ).rejects.toThrow('INVALID_AUTH_013_EVENT')

    expect(findByEventId).not.toHaveBeenCalled()
    expect(append).not.toHaveBeenCalled()
  })
})
