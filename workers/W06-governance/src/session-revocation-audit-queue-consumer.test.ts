import { describe, expect, it, vi } from 'vitest'
import { consumeSessionRevokedAuditEvent } from './session-revocation-audit-queue-consumer'

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

function createDb(
  existing = false,
  writeSuccess = true,
  existingOverrides: Record<string, unknown> = {},
  auditReason = 'USER_INITIATED',
) {
  const existingRow = {
    eventId: event.eventId,
    requestId: event.correlationId,
    traceId: event.causationId,
    actorJson: JSON.stringify(event.actor),
    action: event.eventType,
    targetType: 'Session',
    targetId: event.resourceId,
    beforeJson: JSON.stringify({ status: 'ACTIVE' }),
    afterJson: JSON.stringify({ status: 'REVOKED' }),
    reason: auditReason,
    occurredAt: event.occurredAt,
    ...existingOverrides,
  }
  const first = vi.fn().mockResolvedValue(existing ? existingRow : null)
  const run = vi.fn().mockResolvedValue({ success: writeSuccess, meta: { changes: writeSuccess ? 1 : 0 } })
  const bind = vi.fn(() => ({ first, run }))
  const prepare = vi.fn((sql: string) => ({ bind, sql }))
  return { db: { prepare } as unknown as D1Database, prepare, first, run, bind }
}

describe('AUTH-010 W06 session revocation audit consumer', () => {
  it('persists a safe immutable AuditEvent with the session as target', async () => {
    const { db, prepare, run } = createDb()
    await expect(consumeSessionRevokedAuditEvent(db, event)).resolves.toBe('persisted')
    expect(prepare).toHaveBeenCalledTimes(2)
    expect(run).toHaveBeenCalledTimes(1)
    expect(prepare).toHaveBeenLastCalledWith(expect.stringContaining('INSERT INTO audit_events'))
  })

  it('deduplicates repeated queue delivery by the canonical eventId', async () => {
    const { db, prepare, run } = createDb(true)
    await expect(consumeSessionRevokedAuditEvent(db, event)).resolves.toBe('duplicate')
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(run).not.toHaveBeenCalled()
  })

  it('treats a concurrent identical insert winner as a duplicate delivery', async () => {
    const existingRow = {
      eventId: event.eventId,
      requestId: event.correlationId,
      traceId: event.causationId,
      actorJson: JSON.stringify(event.actor),
      action: event.eventType,
      targetType: 'Session',
      targetId: event.resourceId,
      beforeJson: JSON.stringify({ status: 'ACTIVE' }),
      afterJson: JSON.stringify({ status: 'REVOKED' }),
      reason: 'USER_INITIATED',
      occurredAt: event.occurredAt,
    }
    const db = createDb(false, false)
    db.first
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingRow)

    await expect(consumeSessionRevokedAuditEvent(db.db, event)).resolves.toBe('duplicate')
    expect(db.prepare).toHaveBeenCalledTimes(3)
    expect(db.run).toHaveBeenCalledTimes(1)
  })

  it('rejects a concurrent insert winner with conflicting event identity', async () => {
    const db = createDb(false, false)
    db.first
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        eventId: event.eventId,
        requestId: event.correlationId,
        traceId: event.causationId,
        actorJson: JSON.stringify({ actorId: 'attacker', actorType: 'user' }),
        action: event.eventType,
        targetType: 'Session',
        targetId: event.resourceId,
        beforeJson: JSON.stringify({ status: 'ACTIVE' }),
        afterJson: JSON.stringify({ status: 'REVOKED' }),
        reason: 'USER_INITIATED',
        occurredAt: event.occurredAt,
      })

    await expect(consumeSessionRevokedAuditEvent(db.db, event))
      .rejects.toThrow('SESSION_AUDIT_EVENT_IDENTITY_CONFLICT')
  })

  it('rejects reused event IDs whose actor, action, target or state differs', async () => {
    for (const overrides of [
      { action: 'identity.account_state_changed' },
      { targetType: 'User' },
      { targetId: 'session-2' },
      { afterJson: JSON.stringify({ status: 'ACTIVE' }) },
      { actorJson: JSON.stringify({ actorId: 'user-2', actorType: 'user' }) },
    ]) {
      const db = createDb(true, true, overrides)
      await expect(consumeSessionRevokedAuditEvent(db.db, event))
        .rejects.toThrow('SESSION_AUDIT_EVENT_IDENTITY_CONFLICT')
    }
  })

  it('rejects malformed envelope, injected actor and secret payload before D1 access', async () => {
    const malformed = [
      { ...event, eventType: 'auth.mfa.enrollment_started' },
      { ...event, actor: { actorId: 'user-2', actorType: 'user' } },
      { ...event, payload: { ...event.payload, token: 'secret' } },
      { ...event, resourceType: 'User' },
      { ...event, attempt: 2 },
    ]
    for (const value of malformed) {
      const prepare = vi.fn()
      await expect(consumeSessionRevokedAuditEvent({ prepare } as unknown as D1Database, value))
        .rejects.toThrow('INVALID_AUTH_010_SESSION_EVENT')
      expect(prepare).not.toHaveBeenCalled()
    }
  })

  it('fails the queue attempt when canonical AuditEvent persistence fails', async () => {
    const { db } = createDb(false, false)
    await expect(consumeSessionRevokedAuditEvent(db, event))
      .rejects.toThrow('AUDIT_EVENT_PERSISTENCE_FAILED')
  })
  it('persists the distinct logout audit reason without changing event identity', async () => {
    const logoutEvent = {
      ...event,
      payload: { operationId: 'authLogout', result: 'succeeded', reasonCode: 'USER_LOGOUT' },
    }
    const { db, bind, run } = createDb(false, true, {}, 'USER_LOGOUT')
    await expect(consumeSessionRevokedAuditEvent(db, logoutEvent)).resolves.toBe('persisted')
    expect(run).toHaveBeenCalledTimes(1)
    expect(bind.mock.calls[1]?.[9]).toBe('USER_LOGOUT')
    const duplicate = createDb(true, true, {}, 'USER_LOGOUT')
    await expect(consumeSessionRevokedAuditEvent(duplicate.db, logoutEvent)).resolves.toBe('duplicate')
  })

  it('rejects logout events whose operation and reason do not match', async () => {
    const malformed = {
      ...event,
      payload: { operationId: 'authLogout', result: 'succeeded', reasonCode: 'USER_INITIATED' },
    }
    const prepare = vi.fn()
    await expect(consumeSessionRevokedAuditEvent(
      { prepare } as unknown as D1Database,
      malformed,
    )).rejects.toThrow('INVALID_AUTH_010_SESSION_EVENT')
    expect(prepare).not.toHaveBeenCalled()
  })

})
