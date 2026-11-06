import { describe, expect, it, vi } from 'vitest'
import { buildSessionRevocationOutboxInsert, buildSessionRevokedEvent, assertSessionRevokedEvent } from './session-revocation-events'

describe('AUTH-010 session revocation event', () => {
  it('derives a stable, secret-free event identity from the canonical session/user pair', async () => {
    const input = {
      sessionId: 'session-123',
      userId: 'user-123',
      occurredAt: '2026-11-06T00:00:00.000Z',
      correlationId: 'req_1234567890',
      causationId: 'trace-123',
    }
    const first = await buildSessionRevokedEvent(input)
    const second = await buildSessionRevokedEvent(input)

    expect(first.eventId).toMatch(/^evt_[a-f0-9]{32}$/)
    expect(first.idempotencyKey).toMatch(/^AUTH010_SESSION_REVOKE_[a-f0-9]{32}$/)
    expect(first.eventId).toBe(second.eventId)
    expect(first.idempotencyKey).toBe(second.idempotencyKey)
    expect(first.eventType).toBe('user.session.revoked')
    expect(first.resourceType).toBe('Session')
    expect(first.resourceId).toBe('session-123')
    expect(first.actor).toEqual({ actorId: 'user-123', actorType: 'user' })
    expect(first.payload).toEqual({
      operationId: 'authSessionRevoke',
      result: 'succeeded',
      reasonCode: 'USER_INITIATED',
    })
    expect(JSON.stringify(first)).not.toMatch(/token|cookie|secret/i)
  })

  it('rejects malformed identities and timestamps before creating an event', async () => {
    await expect(buildSessionRevokedEvent({ sessionId: 'session with spaces', userId: 'user-1' }))
      .rejects.toThrow('invalid session revocation event subject')
    await expect(buildSessionRevokedEvent({ sessionId: 'session-1', userId: 'user-1', occurredAt: 'not-a-date' }))
      .rejects.toThrow('invalid session revocation event timestamp')
  })

  it('builds an atomic-only outbox insert gated by the preceding session DELETE', async () => {
    const event = await buildSessionRevokedEvent({ sessionId: 'session-1', userId: 'user-1' })
    const statement = { bind: vi.fn().mockReturnThis() }
    const db = { prepare: vi.fn().mockReturnValue(statement) } as unknown as D1Database

    expect(buildSessionRevocationOutboxInsert(db, event)).toBe(statement)
    const sql = vi.mocked(db.prepare).mock.calls[0]?.[0]
    expect(sql).toContain('INSERT INTO auth_010_session_revocation_journal')
    expect(sql).toContain('SELECT')
    expect(sql).toContain('WHERE changes() = 1')
    expect(statement.bind).toHaveBeenCalledWith(
      expect.any(String),
      event.eventId,
      'user.session.revoked',
      '1.0',
      'session-1',
      1,
      event.idempotencyKey,
      JSON.stringify(event),
      'PENDING',
      1,
      null,
      event.publishedAt,
      null,
      null,
    )
  })

  it('rejects event envelopes with a mismatched event type or client-injected actor', async () => {
    const event = await buildSessionRevokedEvent({ sessionId: 'session-1', userId: 'user-1' })
    expect(() => assertSessionRevokedEvent(event)).not.toThrow()
    expect(() => assertSessionRevokedEvent({ ...event, eventType: 'identity.account_state_changed' }))
      .toThrow()
    expect(() => assertSessionRevokedEvent({ ...event, actor: { ...event.actor, clientSupplied: true } }))
      .toThrow('INVALID_AUTH_010_SESSION_EVENT')
  })
})
