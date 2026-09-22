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

  it('returns ALLOW when an optional check is omitted', () => {
    const input = baseInput()
    delete input.checks.entitlement
    delete input.checks.workflow
    delete input.checks.businessState
    delete input.checks.credential
    expect(evaluateAuthorization(input).decision).toBe('ALLOW')
  })

  it('uses account security as the first denial precedence', () => {
    const input = baseInput()
    input.checks.accountState = 'FAIL'
    input.checks.permission = 'FAIL'
    expect(evaluateAuthorization(input)).toMatchObject({
      decision: 'DENY',
      reasonCode: 'ACCOUNT_SECURITY_DENY',
    })
  })

  it('uses credential denial before permission denial', () => {
    const input = baseInput()
    input.checks.credential = 'FAIL'
    input.checks.permission = 'FAIL'
    expect(evaluateAuthorization(input)).toMatchObject({
      decision: 'DENY',
      reasonCode: 'CREDENTIAL_DENIED',
    })
  })

  it('uses authentication denial before permission denial', () => {
    const input = baseInput()
    input.checks.authentication = 'FAIL'
    input.checks.permission = 'FAIL'
    expect(evaluateAuthorization(input)).toMatchObject({
      decision: 'DENY',
      reasonCode: 'AUTHENTICATION_DENIED',
    })
  })

  it('uses subject-type denial before permission denial', () => {
    const input = baseInput()
    input.subject.type = 'UNKNOWN' as never
    input.checks.permission = 'FAIL'
    expect(evaluateAuthorization(input)).toMatchObject({
      decision: 'DENY',
      reasonCode: 'SUBJECT_TYPE_CHECK',
    })
    expect(evaluateAuthorization(input).subject).toEqual({
      type: 'ANONYMOUS',
      id: null,
    })
  })

  it('uses account security precedence over malformed subject type', () => {
    const input = baseInput()
    input.subject.type = 'UNKNOWN' as never
    input.checks.accountState = 'FAIL'
    expect(evaluateAuthorization(input)).toMatchObject({
      decision: 'DENY',
      reasonCode: 'ACCOUNT_SECURITY_DENY',
    })
  })

  it('denies when permission fails even when the resource id and ownership checks pass', () => {
    const input = baseInput()
    input.checks.permission = 'FAIL'
    expect(evaluateAuthorization(input)).toMatchObject({
      decision: 'DENY',
      reasonCode: 'PERMISSION_DENIED',
    })
  })

  it('denies when any required check is missing', () => {
    const input = baseInput()
    delete (input.checks as Partial<AuthorizationEvaluationInput['checks']>).policy
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

  it('denies a failed policy check even when the other checks pass', () => {
    const input = baseInput()
    input.checks.policy = 'FAIL'
    expect(evaluateAuthorization(input)).toMatchObject({
      decision: 'DENY',
      reasonCode: 'POLICY_DENIED',
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
