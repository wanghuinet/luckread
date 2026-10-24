import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const contract = JSON.parse(
  readFileSync(new URL('../../../../contracts/state-machines/AUTH-007-mfa-lifecycle.v1.json', import.meta.url), 'utf8'),
) as {
  status: string
  featureId: string
  'x-luckread': {
    stateDomains: Array<{ name: string; states: string[]; derivedStateRules: Array<{ state: string; when: string }> }>
    securityInvariants: string[]
  }
  'x-transitions': Array<{ domain: string; from: string; to: string; transition?: string; guards: string[]; effects: string[] }>
  'x-forbidden': Array<{ domain: string; from: string; to: string; reason: string }>
}

describe('AUTH-007 MFA lifecycle contract', () => {
  it('keeps the proposed lifecycle contract explicit and not falsely production-verified', () => {
    expect(contract.featureId).toBe('AUTH-007')
    expect(contract.status).toBe('CONTRACTED_NOT_VERIFIED')
    expect(contract['x-luckread'].stateDomains.map((domain) => domain.name)).toEqual([
      'factor',
      'signInChallenge',
    ])
    expect(contract['x-luckread'].securityInvariants).toContain(
      'Every accepted TOTP time-step is atomically consumed once per factor.',
    )
    expect(contract['x-luckread'].securityInvariants).toContain(
      'A privileged session must be created after verified MFA activation; pre-existing sessions are revoked on enable and disable.',
    )
  })

  it('requires a verified pending-factor transition and forbids direct enablement', () => {
    const directEnable = contract['x-transitions'].find((transition) =>
      transition.domain === 'factor' && transition.from === 'DISABLED' && transition.to === 'ENABLED',
    )
    expect(directEnable).toBeUndefined()

    const activation = contract['x-transitions'].find((transition) =>
      transition.domain === 'factor' && transition.from === 'PENDING_VERIFICATION' && transition.to === 'ENABLED',
    )
    expect(activation).toBeDefined()
    expect(activation?.guards).toContain('six_digit_TOTP_valid')
    expect(activation?.guards).toContain('TOTP_time_step_atomically_consumed')
    expect(activation?.effects).toContain('revoke all pre-existing sessions')
    expect(contract['x-forbidden']).toContainEqual(expect.objectContaining({
      domain: 'factor',
      from: 'DISABLED',
      to: 'ENABLED',
    }))
  })

  it('makes sign-in challenge consumption single-use and rejects expired/replayed challenges', () => {
    const consume = contract['x-transitions'].find((transition) =>
      transition.domain === 'signInChallenge' && transition.from === 'ISSUED' && transition.to === 'CONSUMED',
    )
    expect(consume?.guards).toContain('challenge unexpired and bound to this identity')
    expect(consume?.guards).toContain('valid fresh TOTP time-step or unused recovery code')
    expect(contract['x-forbidden']).toEqual(expect.arrayContaining([
      expect.objectContaining({ domain: 'signInChallenge', from: 'CONSUMED', to: 'CONSUMED' }),
      expect.objectContaining({ domain: 'signInChallenge', from: 'EXPIRED', to: 'CONSUMED' }),
      expect.objectContaining({ domain: 'signInChallenge', from: 'REJECTED', to: 'CONSUMED' }),
    ]))
  })

  it('requires bounded resource budgets and anti-abuse policy while retaining missing production security E2E evidence', () => {
    const policy = JSON.parse(
      readFileSync(new URL('../../../../contracts/api/auth-operation-policy.v1.json', import.meta.url), 'utf8'),
    ) as { operations: Array<{
      operationId: string
      resource?: { d1ReadMax?: number; d1WriteMax?: number; rpcMax?: number; outboundMax?: number }
      cache?: { mode?: string; shared?: boolean }
      antiAbuse?: { required?: boolean; scopes?: string[]; actions?: string[] }
      evidence?: { securityE2E?: string }
    }> }
    const expected = [
      'authMfaStatus',
      'authMfaEnrollmentStart',
      'authMfaEnrollmentConfirm',
      'authMfaChallengeVerify',
      'authMfaDisable',
      'authMfaRecoveryCodesRotate',
    ]
    const records = policy.operations.filter((operation) => expected.includes(operation.operationId))
    expect(records.map((operation) => operation.operationId).sort()).toEqual([...expected].sort())
    for (const operation of records) {
      expect(operation.resource).toBeDefined()
      expect(Number.isInteger(operation.resource?.d1ReadMax)).toBe(true)
      expect(Number.isInteger(operation.resource?.d1WriteMax)).toBe(true)
      expect(Number.isInteger(operation.resource?.rpcMax)).toBe(true)
      expect(Number.isInteger(operation.resource?.outboundMax)).toBe(true)
      expect(operation.cache?.mode).toBe('NO_STORE')
      expect(operation.cache?.shared).toBe(false)
      expect(operation.antiAbuse?.required).toBe(true)
      expect(operation.antiAbuse?.scopes?.length).toBeGreaterThan(0)
      expect(operation.antiAbuse?.actions).toEqual(expect.arrayContaining(['ALLOW', 'THROTTLE', 'BLOCK']))
      // Static policy and local tests do not substitute for production security E2E.
      expect(operation.evidence?.securityE2E).toBe('MISSING')
    }
  })

  it('keeps the TOTP replay guard, verified status, encrypted recovery codes and no-trust-device runtime bindings', () => {
    const betterAuth = readFileSync(new URL('./better-auth.ts', import.meta.url), 'utf8')
    const replayGuard = readFileSync(new URL('./totp-replay-guard.ts', import.meta.url), 'utf8')
    const enrollmentConfirm = readFileSync(new URL('./mfa-enrollment-confirm.ts', import.meta.url), 'utf8')
    const roleAssignment = readFileSync(new URL('../authz/role-assignment.ts', import.meta.url), 'utf8')

    expect(betterAuth).toContain('consumeTotpTimeStep')
    expect(betterAuth).toContain("trustDeviceMaxAge: 0")
    expect(betterAuth).toContain("storeBackupCodes: 'encrypted'")
    expect(replayGuard).toContain('UPDATE "twoFactor" SET lastAcceptedTotpTimeStep')
    expect(enrollmentConfirm).toContain('readAuthoritativeMfaStatus')
    expect(roleAssignment).toContain('requireMfaForPrivilegedAction')
    expect(roleAssignment).toContain('mfa_enrolled_at')
    expect(roleAssignment).toContain('mfaEnabled')
    expect(roleAssignment).toContain('mfaRequired ? mfaEnabled : true')
  })
})
