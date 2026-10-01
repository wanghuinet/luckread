import type { SubscriptionStatus } from './subscription-state-machine.js'

export type W01MembershipTransition = {
  actor: 'user'
  entitlementAction: 'NONE' | 'REVOKE'
}

export function deriveW01MembershipTransition(
  from: SubscriptionStatus,
  to: SubscriptionStatus,
): W01MembershipTransition {
  if (from !== 'ACTIVE' || to !== 'CANCELED') {
    throw new Error('TRANSITION_REQUIRES_TRUSTED_AUTHORITY')
  }

  return {
    actor: 'user',
    entitlementAction: 'REVOKE',
  }
}
