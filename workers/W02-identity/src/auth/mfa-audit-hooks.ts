export type MfaAuditHookState = {
  userId: string
  isChallenge: boolean
}

const mfaAuditStateByContext = new WeakMap<object, MfaAuditHookState>()

export type MfaAuditHookEvent = {
  eventType:
    | 'auth.mfa.challenge_succeeded'
    | 'auth.mfa.challenge_failed'
    | 'auth.mfa.factor_disabled'
    | 'auth.mfa.recovery_codes_rotated'
    | 'auth.mfa.recovery_code_consumed'
  result: 'succeeded' | 'failed'
  reasonCode: string
  factorState?: 'DISABLED'
  challengeMethod?: 'totp' | 'recovery_code'
}

const subjectPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

export function setMfaAuditHookState(context: object, state: MfaAuditHookState): void {
  if (!subjectPattern.test(state.userId)) throw new TypeError('invalid MFA audit subject')
  mfaAuditStateByContext.set(context, {
    userId: state.userId,
    isChallenge: state.isChallenge,
  })
}

export function getMfaAuditHookState(context: object): MfaAuditHookState | null {
  return mfaAuditStateByContext.get(context) ?? null
}

/**
 * Better Auth's after hook exposes its returned value; APIError values are
 * Errors, and HTTP Responses can also be returned by custom endpoints.
 */
export function isMfaAuditFailureOutcome(returned: unknown): boolean {
  if (returned instanceof Error) return true
  if (returned instanceof Response) return !returned.ok
  if (!returned || typeof returned !== 'object' || Array.isArray(returned)) return false
  const value = returned as Record<string, unknown>
  if (typeof value.statusCode === 'number' && value.statusCode >= 400) return true
  if (typeof value.status === 'number' && value.status >= 400) return true
  return false
}

export function classifyMfaAuditHookOutcome(input: {
  path: string
  isChallenge: boolean
  failed: boolean
}): MfaAuditHookEvent[] {
  const { path, isChallenge, failed } = input
  if (path === '/two-factor/verify-totp') {
    if (!isChallenge) return []
    return [{
      eventType: failed ? 'auth.mfa.challenge_failed' : 'auth.mfa.challenge_succeeded',
      result: failed ? 'failed' : 'succeeded',
      reasonCode: failed ? 'CHALLENGE_REJECTED' : 'CHALLENGE_VERIFIED',
      challengeMethod: 'totp',
    }]
  }

  if (path === '/two-factor/verify-backup-code') {
    const events: MfaAuditHookEvent[] = []
    if (isChallenge) {
      events.push({
        eventType: failed ? 'auth.mfa.challenge_failed' : 'auth.mfa.challenge_succeeded',
        result: failed ? 'failed' : 'succeeded',
        reasonCode: failed ? 'CHALLENGE_REJECTED' : 'CHALLENGE_VERIFIED',
        challengeMethod: 'recovery_code',
      })
    }
    if (!failed) {
      events.push({
        eventType: 'auth.mfa.recovery_code_consumed',
        result: 'succeeded',
        reasonCode: 'RECOVERY_CREDENTIAL_CONSUMED',
        challengeMethod: 'recovery_code',
      })
    }
    return events
  }

  if (failed) return []
  if (path === '/two-factor/disable') {
    return [{
      eventType: 'auth.mfa.factor_disabled',
      result: 'succeeded',
      reasonCode: 'USER_INITIATED',
      factorState: 'DISABLED',
    }]
  }
  if (path === '/two-factor/generate-backup-codes') {
    return [{
      eventType: 'auth.mfa.recovery_codes_rotated',
      result: 'succeeded',
      reasonCode: 'USER_INITIATED',
    }]
  }
  return []
}

export const MFA_AUDIT_OBSERVED_PATHS = new Set([
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
  '/two-factor/disable',
  '/two-factor/generate-backup-codes',
])
