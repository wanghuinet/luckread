import { describe, expect, it } from 'vitest'
import { deriveW01MembershipTransition } from './w01-transition-boundary.js'

describe('W01 membership transition boundary', () => {
  it('derives only self-service cancellation and its entitlement revoke', () => {
    expect(deriveW01MembershipTransition('ACTIVE', 'CANCELED')).toEqual({
      actor: 'user',
      entitlementAction: 'REVOKE',
    })
  })

  it('blocks lifecycle transitions that require a trusted non-W01 authority', () => {
    expect(() => deriveW01MembershipTransition('PENDING', 'ACTIVE'))
      .toThrow('TRANSITION_REQUIRES_TRUSTED_AUTHORITY')
    expect(() => deriveW01MembershipTransition('ACTIVE', 'EXPIRED'))
      .toThrow('TRANSITION_REQUIRES_TRUSTED_AUTHORITY')
    expect(() => deriveW01MembershipTransition('PAST_DUE', 'CANCELED'))
      .toThrow('TRANSITION_REQUIRES_TRUSTED_AUTHORITY')
  })
})
