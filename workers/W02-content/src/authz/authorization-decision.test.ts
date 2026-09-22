import { describe, expect, it } from 'vitest'
import { evaluateAuthorization, type AuthorizationEvaluationInput } from './authorization-decision.js'

const baseInput = (): AuthorizationEvaluationInput => ({
  subject: { type: 'USER', id: 'user-1' },
  action: 'content.update',
  resource: {
    type: 'content',
    id: 'content-1',
    scopeType: 'user',
    scopeId: 'user-1',
  },
  checks: {
    authentication: 'PASS',
    accountState: 'PASS',
    permission: 'PASS',
    scope: 'PASS',
    resource: 'PASS',
    entitlement: 'NOT_APPLICABLE',
    workflow: 'NOT_APPLICABLE',
    businessState: 'NOT_APPLICABLE',
    credential: 'NOT_APPLICABLE',
    policy: 'PASS',
  },
  policyVersion: 'policy-2026-09-22',
  authorizationVersion: '42',
})

describe('canonical authorization decision', () => {
  it('returns ALLOW when every mandatory check passes', () => {
    expect(evaluateAuthorization(baseInput())).toEqual({
      decision: 'ALLOW',
      subject: { type: 'USER', id: 'user-1' },
      action: 'content.update',
      resource: {
        type: 'content',
        id: 'content-1',
        scopeType: 'user',
        scopeId: 'user-1',
      },
      checks: baseInput().checks,
      policyVersion: 'policy-2026-09-22',
      authorizationVersion: '42',
    })
  })

  it('denies before permission when account security fails', () => {
    const input = baseInput()
    input.checks.accountState = 'FAIL'
    expect(evaluateAuthorization(input).decision).toBe('DENY')
    expect(evaluateAuthorization(input).reasonCode).toBe('ACCOUNT_SECURITY_DENY')
  })

  it('denies when permission fails even when the resource id and ownership checks pass', () => {
    const input = baseInput()
    input.checks.permission = 'FAIL'
    expect(evaluateAuthorization(input)).toMatchObject({
      decision: 'DENY',
      reasonCode: 'PERMISSION_DENIED',
    })
  })

  it('denies when any mandatory check is missing', () => {
    const input = baseInput()
    // @ts-expect-error Intentional incomplete boundary input for fail-closed behavior.
    delete input.checks.policy
    expect(evaluateAuthorization(input)).toMatchObject({
      decision: 'DENY',
      reasonCode: 'MISSING_AUTHORIZATION_INPUT',
    })
  })

  it('does not treat a role name as an authorization authority', () => {
    const input = {
      ...baseInput(),
      role: 'admin',
    } as AuthorizationEvaluationInput & { role: string }
    expect(evaluateAuthorization(input)).toMatchObject({ decision: 'ALLOW' })

    input.checks.permission = 'FAIL'
    expect(evaluateAuthorization(input)).toMatchObject({
      decision: 'DENY',
      reasonCode: 'PERMISSION_DENIED',
    })
  })

  it('fails closed on evaluation exceptions', () => {
    const input = baseInput()
    input.checks = undefined as never
    expect(evaluateAuthorization(input)).toMatchObject({
      decision: 'DENY',
      reasonCode: 'AUTHORIZATION_EVALUATION_FAILED',
    })
  })
})
