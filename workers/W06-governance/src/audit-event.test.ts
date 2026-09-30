import { describe, expect, it } from 'vitest'
import { buildAccountStateChangedAuditEvent } from './audit-event.js'

describe('W06 canonical AUTH-013 AuditEvent construction', () => {
  it('builds an immutable account-state audit record from the accepted transition result', () => {
    const event = buildAccountStateChangedAuditEvent({
      eventId: 'evt-001',
      requestId: 'req-001',
      traceId: 'trace-001',
      actor: {
        actorId: 'admin-001',
        actorType: 'admin',
        layer: 'L7',
      },
      userId: 'user-001',
      beforeState: 'ACTIVE',
      beforeVersion: 7,
      afterState: 'SUSPENDED',
      afterVersion: 8,
      occurredAt: '2026-09-24T01:00:00.000Z',
      reason: 'policy-enforcement',
    })

    expect(event).toEqual({
      eventId: 'evt-001',
      requestId: 'req-001',
      traceId: 'trace-001',
      actor: {
        actorId: 'admin-001',
        actorType: 'admin',
        layer: 'L7',
      },
      action: 'identity.account_state_changed',
      targetType: 'User',
      targetId: 'user-001',
      before: {
        account_state: 'ACTIVE',
        account_state_version: 7,
      },
      after: {
        account_state: 'SUSPENDED',
        account_state_version: 8,
      },
      reason: 'policy-enforcement',
      occurredAt: '2026-09-24T01:00:00.000Z',
    })
  })

  it('fails closed when the lifecycle version does not increment exactly once', () => {
    expect(() =>
      buildAccountStateChangedAuditEvent({
        eventId: 'evt-002',
        actor: { actorId: 'system-001', actorType: 'system' },
        userId: 'user-001',
        beforeState: 'SUSPENDED',
        beforeVersion: 8,
        afterState: 'ACTIVE',
        afterVersion: 10,
        occurredAt: '2026-09-24T01:00:00.000Z',
      }),
    ).toThrow('account_state_version must increment exactly once')
  })

  it('fails closed when a required identity field is empty', () => {
    expect(() =>
      buildAccountStateChangedAuditEvent({
        eventId: 'evt-003',
        actor: { actorId: '', actorType: 'system' },
        userId: 'user-001',
        beforeState: 'ACTIVE',
        beforeVersion: 1,
        afterState: 'FROZEN',
        afterVersion: 2,
        occurredAt: '2026-09-24T01:00:00.000Z',
      }),
    ).toThrow('actor.actorId is required')
  })
})
