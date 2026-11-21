import { describe, expect, it } from 'vitest'
import { buildSessionRevokedEvent, assertSessionRevokedEvent } from './session-revocation-events'

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

  it('rejects event envelopes with mismatched identity or client-injected fields', async () => {
    const event = await buildSessionRevokedEvent({ sessionId: 'session-1', userId: 'user-1' })
    await expect(assertSessionRevokedEvent(event)).resolves.toEqual(event)
    await expect(assertSessionRevokedEvent({ ...event, eventType: 'identity.account_state_changed' }))
      .rejects.toThrow('INVALID_AUTH_010_SESSION_EVENT')
    await expect(assertSessionRevokedEvent({ ...event, actor: { actorId: 'user-2', actorType: 'user' } }))
      .rejects.toThrow('INVALID_AUTH_010_SESSION_EVENT')
    await expect(assertSessionRevokedEvent({ ...event, payload: { ...event.payload, token: 'secret' } }))
      .rejects.toThrow('INVALID_AUTH_010_SESSION_EVENT')
  })
  it('builds and validates an explicit self-logout audit event', async () => {
    const event = await buildSessionRevokedEvent({
      sessionId: 'session-logout-1',
      userId: 'user-logout-1',
      operationId: 'authLogout',
    })
    expect(event.payload).toEqual({
      operationId: 'authLogout',
      result: 'succeeded',
      reasonCode: 'USER_LOGOUT',
    })
    await expect(assertSessionRevokedEvent(event)).resolves.toEqual(event)
    await expect(assertSessionRevokedEvent({
      ...event,
      payload: { ...event.payload, reasonCode: 'USER_INITIATED' },
    })).rejects.toThrow('INVALID_AUTH_010_SESSION_EVENT')
    await expect(assertSessionRevokedEvent({
      ...event,
      payload: { ...event.payload, operationId: 'authSessionRevoke' },
    })).rejects.toThrow('INVALID_AUTH_010_SESSION_EVENT')
  })

})
