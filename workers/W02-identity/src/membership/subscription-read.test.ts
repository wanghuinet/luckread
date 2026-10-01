import { describe, expect, it } from 'vitest'
import {
  readMembershipSubscription,
  type MembershipSubscriptionSnapshot,
} from './subscription-read.js'

function fakeDb(row: MembershipSubscriptionSnapshot | null) {
  return {
    prepare() {
      return {
        bind(..._args: unknown[]) {
          return {
            first: async <T>() => row as T | null,
          }
        },
      }
    },
  }
}

const base = {
  caller: 'W07',
  transportVersion: '1.0',
  correlationId: 'corr-read',
  principalUserId: 'user-a',
  subscriptionId: 'sub-1',
}

const row: MembershipSubscriptionSnapshot = {
  subscriptionId: 'sub-1',
  subscriberId: 'user-a',
  planId: 'plan-1',
  planVersion: 1,
  status: 'ACTIVE',
  version: 7,
  currentPeriodStart: '2026-10-01T00:00:00.000Z',
  currentPeriodEnd: '2026-11-01T00:00:00.000Z',
  cancelAt: null,
}

describe('W02 authoritative membership subscription read', () => {
  it('returns the owned canonical subscription snapshot', async () => {
    await expect(readMembershipSubscription(fakeDb(row) as never, base))
      .resolves.toEqual(row)
  })

  it('does not reveal another subscriber subscription', async () => {
    await expect(readMembershipSubscription(
      fakeDb({ ...row, subscriberId: 'user-b' }) as never,
      base,
    )).rejects.toThrow('NOT_FOUND')
  })

  it('does not synthesize state when the subscription is absent', async () => {
    await expect(readMembershipSubscription(fakeDb(null) as never, base))
      .rejects.toThrow('NOT_FOUND')
  })
})
