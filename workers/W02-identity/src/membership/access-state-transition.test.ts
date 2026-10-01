import { describe, expect, it } from 'vitest'
import {
  MembershipAccessStateError,
  mapMembershipError,
  validateCreateSubscription,
  validateTransition,
} from './access-state-transition.js'

const principal = {
  caller: 'W07',
  transportVersion: '1.0',
  correlationId: 'corr-1',
  actorUserId: 'user-a',
  idempotencyKey: 'sub-1:create',
}

describe('W02 membership access-state boundary', () => {
  it('accepts only trusted W07 subscription creation for the authenticated subscriber', () => {
    expect(() => validateCreateSubscription({
      ...principal,
      subscriptionId: 'sub-1',
      subscriberId: 'user-a',
      planId: 'plan-1',
      planVersion: 1,
      startedAt: new Date().toISOString(),
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: new Date(Date.now() + 86400000).toISOString(),
    })).not.toThrow()
  })

  it('fails closed when the caller or subscriber scope is forged', () => {
    expect(() => validateCreateSubscription({
      ...principal,
      caller: 'W01',
      subscriptionId: 'sub-1',
      subscriberId: 'user-a',
      planId: 'plan-1',
      planVersion: 1,
      startedAt: '2026-10-01T00:00:00.000Z',
      currentPeriodStart: '2026-10-01T00:00:00.000Z',
      currentPeriodEnd: '2026-11-01T00:00:00.000Z',
    })).toThrow('UNTRUSTED_CALLER')

    expect(() => validateCreateSubscription({
      ...principal,
      subscriptionId: 'sub-1',
      subscriberId: 'user-b',
      planId: 'plan-1',
      planVersion: 1,
      startedAt: '2026-10-01T00:00:00.000Z',
      currentPeriodStart: '2026-10-01T00:00:00.000Z',
      currentPeriodEnd: '2026-11-01T00:00:00.000Z',
    })).toThrow('PRINCIPAL_SCOPE_DENIED')
  })

  it('requires a valid optimistic-concurrency transition', () => {
    expect(() => validateTransition({
      ...principal,
      subscriptionId: 'sub-1',
      from: 'ACTIVE',
      to: 'CANCELED',
      expectedVersion: 3,
      actor: 'user',
      entitlementAction: 'NONE',
    })).toThrow()
  })

  it('maps the boundary errors without leaking storage internals', () => {
    const error = new MembershipAccessStateError('VERSION_CONFLICT')
    expect(mapMembershipError(error)).toEqual({ status: 409, code: 'VERSION_CONFLICT' })
  })
})
