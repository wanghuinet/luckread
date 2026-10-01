import { describe, expect, it } from 'vitest'
import {
  isTerminal,
  reconcileSubscriptionEvent,
  transitionSubscription,
} from './subscription-state-machine.js'

describe('Membership subscription state machine', () => {
  it('accepts contract-defined transitions', () => {
    expect(transitionSubscription(
      { status: 'PENDING', version: 1 },
      { to: 'ACTIVE', actor: 'payment', expectedVersion: 1, idempotencyKey: 'a' },
    )).toEqual({ status: 'ACTIVE', version: 2 })

    expect(transitionSubscription(
      { status: 'ACTIVE', version: 2 },
      { to: 'PAST_DUE', actor: 'system', expectedVersion: 2, idempotencyKey: 'b' },
    )).toEqual({ status: 'PAST_DUE', version: 3 })

    expect(transitionSubscription(
      { status: 'PAST_DUE', version: 3 },
      { to: 'ACTIVE', actor: 'payment', expectedVersion: 3, idempotencyKey: 'c' },
    )).toEqual({ status: 'ACTIVE', version: 4 })
  })

  it('rejects forbidden transitions and unauthorized actors', () => {
    expect(() => transitionSubscription(
      { status: 'CANCELED', version: 1 },
      { to: 'ACTIVE', actor: 'system', expectedVersion: 1, idempotencyKey: 'x' },
    )).toThrow('INVALID_STATE_TRANSITION')

    expect(() => transitionSubscription(
      { status: 'PAST_DUE', version: 1 },
      { to: 'CANCELED', actor: 'user', expectedVersion: 1, idempotencyKey: 'y' },
    )).toThrow('INVALID_STATE_TRANSITION')
  })

  it('rejects stale optimistic concurrency', () => {
    expect(() => transitionSubscription(
      { status: 'ACTIVE', version: 4 },
      { to: 'EXPIRED', actor: 'system', expectedVersion: 3, idempotencyKey: 'stale' },
    )).toThrow('VERSION_CONFLICT')
  })

  it('reconciles stale and duplicate replay without a second transition', () => {
    const current = { status: 'ACTIVE' as const, version: 7 }

    expect(reconcileSubscriptionEvent(
      current,
      { to: 'PAST_DUE', actor: 'system', expectedVersion: 6, idempotencyKey: 'stale' },
    )).toEqual({ state: current, applied: false })

    expect(reconcileSubscriptionEvent(
      current,
      { to: 'PAST_DUE', actor: 'system', expectedVersion: 7, idempotencyKey: 'already-applied' },
      new Set(['already-applied']),
    )).toEqual({ state: current, applied: false })

    expect(isTerminal('CANCELED')).toBe(true)
    expect(isTerminal('ACTIVE')).toBe(false)
  })
})
