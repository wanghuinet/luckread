import { describe, expect, it } from 'vitest'
import {
  W02MembershipClientError,
  parseW02MembershipSnapshot,
} from './w02-membership-client.js'

const valid = {
  subscriptionId: 'sub_123',
  subscriberId: 'user_123',
  planId: 'plan_basic',
  planVersion: 2,
  status: 'ACTIVE',
  version: 7,
  currentPeriodStart: '2026-10-01T00:00:00.000Z',
  currentPeriodEnd: '2026-11-01T00:00:00.000Z',
  cancelAt: null,
}

describe('W07 W02 authoritative subscription snapshot validation', () => {
  it('accepts the full contracted snapshot shape', () => {
    expect(parseW02MembershipSnapshot(valid, {
      subscriptionId: 'sub_123',
      actorUserId: 'user_123',
    })).toEqual(valid)
  })

  it('rejects unknown lifecycle states', () => {
    expect(() => parseW02MembershipSnapshot(
      { ...valid, status: 'PAUSED' },
      { subscriptionId: 'sub_123', actorUserId: 'user_123' },
    )).toThrow(W02MembershipClientError)
  })

  it('rejects malformed period timestamps', () => {
    expect(() => parseW02MembershipSnapshot(
      { ...valid, currentPeriodEnd: 'not-a-date' },
      { subscriptionId: 'sub_123', actorUserId: 'user_123' },
    )).toThrow(W02MembershipClientError)

    expect(() => parseW02MembershipSnapshot(
      { ...valid, cancelAt: 'not-a-date' },
      { subscriptionId: 'sub_123', actorUserId: 'user_123' },
    )).toThrow(W02MembershipClientError)
  })

  it('rejects non-positive versions and cross-principal snapshots', () => {
    expect(() => parseW02MembershipSnapshot(
      { ...valid, version: 0 },
      { subscriptionId: 'sub_123', actorUserId: 'user_123' },
    )).toThrow(W02MembershipClientError)

    expect(() => parseW02MembershipSnapshot(
      valid,
      { subscriptionId: 'sub_123', actorUserId: 'another-user' },
    )).toThrow(W02MembershipClientError)
  })
})
