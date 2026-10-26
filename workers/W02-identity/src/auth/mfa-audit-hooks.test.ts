import { describe, expect, it } from 'vitest'
import {
  classifyMfaAuditHookOutcome,
  getMfaAuditHookState,
  isMfaAuditFailureOutcome,
  setMfaAuditHookState,
} from './mfa-audit-hooks'

describe('AUTH-007 Better Auth hook outcome classification', () => {
  it('records successful and failed TOTP login challenges without recording user-entered codes', () => {
    expect(classifyMfaAuditHookOutcome({
      path: '/two-factor/verify-totp', isChallenge: true, failed: false,
    })).toEqual([{
      eventType: 'auth.mfa.challenge_succeeded',
      result: 'succeeded',
      reasonCode: 'CHALLENGE_VERIFIED',
      challengeMethod: 'totp',
    }])
    expect(classifyMfaAuditHookOutcome({
      path: '/two-factor/verify-totp', isChallenge: true, failed: true,
    })).toEqual([{
      eventType: 'auth.mfa.challenge_failed',
      result: 'failed',
      reasonCode: 'CHALLENGE_REJECTED',
      challengeMethod: 'totp',
    }])
  })

  it('records successful recovery challenge and recovery credential consumption separately', () => {
    expect(classifyMfaAuditHookOutcome({
      path: '/two-factor/verify-backup-code', isChallenge: true, failed: false,
    })).toEqual([
      {
        eventType: 'auth.mfa.challenge_succeeded',
        result: 'succeeded',
        reasonCode: 'CHALLENGE_VERIFIED',
        challengeMethod: 'recovery_code',
      },
      {
        eventType: 'auth.mfa.recovery_code_consumed',
        result: 'succeeded',
        reasonCode: 'RECOVERY_CREDENTIAL_CONSUMED',
        challengeMethod: 'recovery_code',
      },
    ])
  })

  it('records recovery-code consumption for an authenticated recovery operation but never for a rejected code', () => {
    expect(classifyMfaAuditHookOutcome({
      path: '/two-factor/verify-backup-code', isChallenge: false, failed: false,
    }).map((event) => event.eventType)).toEqual(['auth.mfa.recovery_code_consumed'])
    expect(classifyMfaAuditHookOutcome({
      path: '/two-factor/verify-backup-code', isChallenge: false, failed: true,
    })).toEqual([])
  })

  it('records factor disable and recovery-code rotation only after successful Better Auth responses', () => {
    expect(classifyMfaAuditHookOutcome({
      path: '/two-factor/disable', isChallenge: false, failed: false,
    })).toEqual([{
      eventType: 'auth.mfa.factor_disabled',
      result: 'succeeded',
      reasonCode: 'USER_INITIATED',
      factorState: 'DISABLED',
    }])
    expect(classifyMfaAuditHookOutcome({
      path: '/two-factor/disable', isChallenge: false, failed: true,
    })).toEqual([])
    expect(classifyMfaAuditHookOutcome({
      path: '/two-factor/generate-backup-codes', isChallenge: false, failed: false,
    })).toEqual([{
      eventType: 'auth.mfa.recovery_codes_rotated',
      result: 'succeeded',
      reasonCode: 'USER_INITIATED',
    }])
    expect(classifyMfaAuditHookOutcome({
      path: '/two-factor/generate-backup-codes', isChallenge: false, failed: true,
    })).toEqual([])
  })

  it('ignores unrelated Better Auth paths and never promotes a session verification into a login challenge', () => {
    expect(classifyMfaAuditHookOutcome({
      path: '/sign-in/email', isChallenge: true, failed: true,
    })).toEqual([])
    expect(classifyMfaAuditHookOutcome({
      path: '/two-factor/verify-totp', isChallenge: false, failed: false,
    })).toEqual([])
  })

  it('preserves trusted enrollment receipt defer-finalization state for the owning route', () => {
    const context: Record<string, unknown> = {}
    setMfaAuditHookState(context, {
      userId: 'user-123',
      isChallenge: false,
      receiptId: 'mfaop_0123456789abcdef0123456789abcdef',
      deferFinalization: true,
    })
    expect(getMfaAuditHookState(context)).toEqual({
      userId: 'user-123',
      isChallenge: false,
      receiptId: 'mfaop_0123456789abcdef0123456789abcdef',
      deferFinalization: true,
    })
    expect(() => setMfaAuditHookState({}, {
      userId: 'user-123',
      isChallenge: false,
      deferFinalization: 'true' as unknown as boolean,
    })).toThrow('invalid MFA audit defer-finalization flag')
  })

  it('recognizes Better Auth error outcomes and failed HTTP responses', () => {
    expect(isMfaAuditFailureOutcome(new Error('rejected'))).toBe(true)
    expect(isMfaAuditFailureOutcome(new Response(null, { status: 401 }))).toBe(true)
    expect(isMfaAuditFailureOutcome(new Response(null, { status: 204 }))).toBe(false)
    expect(isMfaAuditFailureOutcome({ statusCode: 503 })).toBe(true)
    expect(isMfaAuditFailureOutcome({ data: { ok: true } })).toBe(false)
  })

  it('stores only a validated server-derived principal in the request context', () => {
    const context: Record<string, unknown> = {}
    setMfaAuditHookState(context, { userId: 'user-123', isChallenge: true })
    expect(getMfaAuditHookState(context)).toEqual({ userId: 'user-123', isChallenge: true })
    expect(getMfaAuditHookState({})).toBeNull()
    expect(getMfaAuditHookState({})).toBeNull()
    expect(() => setMfaAuditHookState({}, { userId: 'bad subject!', isChallenge: false })).toThrow()
  })
})
