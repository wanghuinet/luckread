import { describe, expect, it } from 'vitest'
import {
  buildMfaAuditEvent,
  deriveMfaAuditEventIdForIdempotencyKey,
  isAllowedMfaAuditOperationId,
  MFA_AUDIT_EVENT_NAMES,
} from './mfa-audit-events.js'

describe('AUTH-007 MFA audit event contract', () => {
  it('builds a secret-free event with explicit producer, actor and timestamps', () => {
    const event = buildMfaAuditEvent({
      eventType: 'auth.mfa.locked',
      operationId: 'authMfaChallengeVerify',
      userId: 'user-123',
      occurredAt: '2026-10-24T14:00:00.000Z',
      result: 'rejected',
      reasonCode: 'VERIFICATION_LOCKOUT',
      challengeMethod: 'totp',
      idempotencyKey: 'mfa-lock:user-123:1792850400000',
    })

    expect(event).toMatchObject({
      eventType: 'auth.mfa.locked',
      schemaVersion: '1.0',
      producer: 'W02',
      resourceType: 'User',
      resourceId: 'user-123',
      occurredAt: '2026-10-24T14:00:00.000Z',
      idempotencyKey: 'mfa-lock:user-123:1792850400000',
      actor: { actorId: 'user-123', actorType: 'user' },
      payload: { operationId: 'authMfaChallengeVerify', result: 'rejected', reasonCode: 'VERIFICATION_LOCKOUT' },
    })
    expect(JSON.stringify(event)).not.toMatch(/secret|recovery.?code|password|totp.?code/i)
  })

  it('derives stable event identities from bounded idempotency keys', async () => {
    const first = await deriveMfaAuditEventIdForIdempotencyKey('mfa-lock:user-123:window-1')
    const second = await deriveMfaAuditEventIdForIdempotencyKey('mfa-lock:user-123:window-1')
    expect(first).toBe(second)
    expect(first).toMatch(/^evt_[a-f0-9]{32}$/)
  })

  it('keeps the ten canonical event types and operation allow-list explicit', () => {
    expect(MFA_AUDIT_EVENT_NAMES).toHaveLength(10)
    expect(isAllowedMfaAuditOperationId('auth.mfa.enrollment_verified', 'authMfaEnrollmentConfirm')).toBe(true)
    expect(isAllowedMfaAuditOperationId('auth.mfa.enrollment_verified', 'authMfaDisable')).toBe(false)
  })

  it('rejects a mismatched operation id instead of persisting ambiguous audit intent', () => {
    expect(() => buildMfaAuditEvent({
      eventType: 'auth.mfa.enrollment_verified',
      operationId: 'authMfaDisable',
      userId: 'user-123',
      result: 'succeeded',
    })).toThrow('invalid MFA audit operation id for event type')
  })
})
