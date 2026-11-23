import { describe, expect, it, vi } from 'vitest'
import type { W07WebhookPostgresClient, W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'
import type { ScheduledSubscriptionPlanDowngrade } from './subscription-plan-change-schedule.js'
import {
  applyRenewalSubscriptionUpdatePostgres,
  readSubscriptionOutcomePostgres,
  type ApplyRenewalSubscriptionUpdateInput,
} from './subscription-renewal-outcome-postgres.js'
import type { SubscriptionOutcomeRow } from './subscription-renewal-outcome.js'

const subscriptionId = 'sub_renewal_01'
const subscriberId = 'user_renewal_01'
const originalPlanId = 'plan_' + 'a'.repeat(64)
const targetPlanId = 'plan_' + 'b'.repeat(64)
const changeId = 'sudc_' + 'c'.repeat(64)
const cycleStart = '2026-12-01T12:00:00.000Z'
const cycleEnd = '2027-01-01T12:00:00.000Z'
const oldStart = '2026-11-01T12:00:00.000Z'
const oldEnd = cycleStart
const updatedAt = '2026-12-01T12:00:01.000Z'

function subscriptionRow(): SubscriptionOutcomeRow {
  return {
    subscription_id: subscriptionId,
    subscriber_id: subscriberId,
    plan_id: originalPlanId,
    plan_version: 1,
    creator_id: 'creator_01',
    billing_interval: 'MONTHLY',
    tier: 'supporter',
    price_minor: 900,
    currency: 'USD',
    status: 'ACTIVE',
    current_period_start: oldStart,
    current_period_end: oldEnd,
    trial_started_at: null,
    trial_ends_at: null,
    trial_converted_at: null,
    cancel_at: null,
    updated_at: '2026-11-01T12:00:00.000Z',
    version: 4,
  }
}

function scheduledChange(): ScheduledSubscriptionPlanDowngrade {
  return {
    changeId,
    subscriberId,
    subscriptionId,
    changeType: 'DOWNGRADE',
    expectedSubscriptionVersion: 4,
    expectedPlanId: originalPlanId,
    expectedPlanVersion: 1,
    targetPlanId,
    targetPlanVersion: 2,
    effectiveAt: cycleStart,
    status: 'SCHEDULED',
    appliedAt: null,
    appliedSubscriptionVersion: null,
  }
}

function input(scheduled = true): ApplyRenewalSubscriptionUpdateInput {
  return {
    cycle: { subscription_id: subscriptionId, subscriber_id: subscriberId, cycle_start: cycleStart, cycle_id: 'rcy_' + 'd'.repeat(26), cycle_end: cycleEnd },
    subscription: subscriptionRow(),
    nextStatus: 'ACTIVE',
    nextPeriodStart: cycleStart,
    nextPeriodEnd: cycleEnd,
    updatedAt,
    convertedAt: null,
    ...(scheduled ? { scheduledChange: scheduledChange() } : {}),
  }
}

function postgresPool(
  handler: (sql: string, values: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>,
  options: { receiptRow?: Record<string, unknown> | null; receiptInsertRows?: Array<Record<string, unknown>>; receiptUpdateRows?: Array<Record<string, unknown>> } = {},
) {
  const transactionCalls: Array<{ sql: string; values: unknown[] }> = []
  const query = vi.fn(async (sql: string, values: unknown[] = []) => handler(sql, values))
  const client = {
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      transactionCalls.push({ sql, values })
      if (sql.includes('FROM membership_subscription_renewal_cycle_applications')) return { rows: options.receiptRow ? [options.receiptRow] : [], rowCount: options.receiptRow ? 1 : 0 }
      if (sql.includes('INSERT INTO membership_subscription_renewal_cycle_applications')) { const rows = options.receiptInsertRows ?? [{ cycle_id: 'rcy_' + 'd'.repeat(26) }]; return { rows, rowCount: rows.length } }
      if (sql.includes('UPDATE membership_subscription_renewal_cycle_applications SET outcome')) { const rows = options.receiptUpdateRows ?? [{ cycle_id: 'rcy_' + 'd'.repeat(26) }]; return { rows, rowCount: rows.length } }
      return handler(sql, values)
    }),
    release: vi.fn(),
  } as unknown as W07WebhookPostgresClient
  const pool = {
    query,
    connect: vi.fn(async () => client),
  } as unknown as W07WebhookPostgresPool
  return { pool, query, client, transactionCalls }
}

describe('native PostgreSQL renewal outcome synchronization', () => {
  it('reads the authoritative subscription with canonical UTC timestamps', async () => {
    const row = {
      ...subscriptionRow(),
      current_period_start: oldStart,
      current_period_end: oldEnd,
      trial_started_at: null,
      trial_ends_at: null,
      trial_converted_at: null,
      cancel_at: null,
    }
    const f = postgresPool(async () => ({ rows: [row as unknown as Record<string, unknown>], rowCount: 1 }))

    await expect(readSubscriptionOutcomePostgres(f.pool, subscriptionId, subscriberId)).resolves.toEqual(row)
    expect(f.query.mock.calls[0]?.[0]).toContain('subscription_id = $1 AND s.subscriber_id = $2')
    expect(f.query.mock.calls[0]?.[0]).toContain("to_char(s.current_period_start AT TIME ZONE 'UTC'")
    expect(f.query.mock.calls[0]?.[1]).toEqual([subscriptionId, subscriberId])
  })

  it('commits the subscription period update and scheduled-change APPLIED marker together', async () => {
    const f = postgresPool(async (sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: null }
      if (sql.includes('UPDATE membership_subscriptions SET plan_id')) return { rows: [{ subscription_id: subscriptionId }], rowCount: 1 }
      if (sql.includes("UPDATE membership_subscription_scheduled_plan_changes SET status = 'APPLIED'")) return { rows: [{ change_id: changeId }], rowCount: 1 }
      throw new Error('unexpected PostgreSQL statement')
    })

    await expect(applyRenewalSubscriptionUpdatePostgres(f.pool, input(true))).resolves.toBe('APPLIED')

    expect(f.transactionCalls.map(x => x.sql)).toEqual([
      'BEGIN', expect.stringContaining('FROM membership_subscription_renewal_cycle_applications'),
      expect.stringContaining('UPDATE membership_subscriptions SET plan_id'),
      expect.stringContaining("UPDATE membership_subscription_scheduled_plan_changes SET status = 'APPLIED'"),
      expect.stringContaining('INSERT INTO membership_subscription_renewal_cycle_applications'), 'COMMIT',
    ])
    expect(f.transactionCalls[2]?.sql).toContain('version = $13')
    expect(f.transactionCalls[2]?.sql).toContain("c.status = 'SCHEDULED'")
    expect(f.transactionCalls[3]?.sql).toContain('applied_subscription_version = $2')
    expect(f.transactionCalls[3]?.sql).toContain('s.version = $16')
    expect(f.transactionCalls[3]?.values).toEqual(expect.arrayContaining([changeId, cycleStart, cycleEnd]))
    expect(f.client.release).toHaveBeenCalledTimes(1)
  })

  it('rolls back the subscription update when the scheduled-change CAS loses', async () => {
    const f = postgresPool(async (sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [], rowCount: null }
      if (sql.includes('UPDATE membership_subscriptions SET plan_id')) return { rows: [{ subscription_id: subscriptionId }], rowCount: 1 }
      if (sql.includes("UPDATE membership_subscription_scheduled_plan_changes SET status = 'APPLIED'")) return { rows: [], rowCount: 0 }
      throw new Error('unexpected PostgreSQL statement')
    })

    await expect(applyRenewalSubscriptionUpdatePostgres(f.pool, input(true))).resolves.toBe('CAS_LOST')
    expect(f.transactionCalls.map(x => x.sql)).toEqual([
      'BEGIN', expect.stringContaining('FROM membership_subscription_renewal_cycle_applications'),
      expect.stringContaining('UPDATE membership_subscriptions SET plan_id'),
      expect.stringContaining("UPDATE membership_subscription_scheduled_plan_changes SET status = 'APPLIED'"), 'ROLLBACK',
    ])
    expect(f.transactionCalls.some(x => x.sql === 'COMMIT')).toBe(false)
  })

  it('uses one native CAS update when no scheduled plan change is due', async () => {
    const f = postgresPool(async (sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: null }
      if (sql.includes('UPDATE membership_subscriptions SET plan_id')) return { rows: [{ subscription_id: subscriptionId }], rowCount: 1 }
      throw new Error('unexpected PostgreSQL statement')
    })

    await expect(applyRenewalSubscriptionUpdatePostgres(f.pool, input(false))).resolves.toBe('APPLIED')
    expect(f.transactionCalls.map(x => x.sql)).toEqual([
      'BEGIN', expect.stringContaining('FROM membership_subscription_renewal_cycle_applications'),
      expect.stringContaining('UPDATE membership_subscriptions SET plan_id'),
      expect.stringContaining('INSERT INTO membership_subscription_renewal_cycle_applications'), 'COMMIT',
    ])
  })

  it('accepts an exact existing cycle receipt as ALREADY_APPLIED without mutating subscription state', async () => {
    const receipt = { cycle_id: 'rcy_' + 'd'.repeat(26), subscription_id: subscriptionId, subscriber_id: subscriberId, cycle_start: cycleStart, cycle_end: cycleEnd, outcome: 'ACTIVE', applied_subscription_version: 5, plan_id: targetPlanId, plan_version: 2 }
    const f = postgresPool(async (sql) => { if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: null }; throw new Error('unexpected mutation') }, { receiptRow: receipt })
    await expect(applyRenewalSubscriptionUpdatePostgres(f.pool, input(true))).resolves.toBe('ALREADY_APPLIED')
    expect(f.transactionCalls.map(x => x.sql)).toEqual(['BEGIN', expect.stringContaining('FROM membership_subscription_renewal_cycle_applications'), 'COMMIT'])
  })

  it('rejects an existing receipt whose applied version does not match the CAS version', async () => {
    const receipt = { cycle_id: 'rcy_' + 'd'.repeat(26), subscription_id: subscriptionId, subscriber_id: subscriberId, cycle_start: cycleStart, cycle_end: cycleEnd, outcome: 'ACTIVE', applied_subscription_version: 6, plan_id: targetPlanId, plan_version: 2 }
    const f = postgresPool(async (sql) => { if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: null }; throw new Error('unexpected mutation') }, { receiptRow: receipt })
    await expect(applyRenewalSubscriptionUpdatePostgres(f.pool, input(true))).resolves.toBe('CAS_LOST')
    expect(f.transactionCalls.map(x => x.sql)).toEqual(['BEGIN', expect.stringContaining('FROM membership_subscription_renewal_cycle_applications'), 'ROLLBACK'])
  })

  it('rejects an existing receipt with mismatched cycle identity or plan and rolls back', async () => {
    const receipt = { cycle_id: 'rcy_' + 'd'.repeat(26), subscription_id: subscriptionId, subscriber_id: subscriberId, cycle_start: cycleStart, cycle_end: cycleEnd, outcome: 'ACTIVE', applied_subscription_version: 5, plan_id: originalPlanId, plan_version: 1 }
    const f = postgresPool(async (sql) => { if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: null }; throw new Error('unexpected mutation') }, { receiptRow: receipt })
    await expect(applyRenewalSubscriptionUpdatePostgres(f.pool, input(true))).resolves.toBe('CAS_LOST')
    expect(f.transactionCalls.map(x => x.sql)).toEqual(['BEGIN', expect.stringContaining('FROM membership_subscription_renewal_cycle_applications'), 'ROLLBACK'])
  })

  it('promotes an exact PAST_DUE receipt after a successful same-cycle retry using subscription-version CAS', async () => {
    const failedSubscription = {
      ...subscriptionRow(), status: 'PAST_DUE' as const, version: 5,
    }
    const receipt = {
      cycle_id: 'rcy_' + 'd'.repeat(26), subscription_id: subscriptionId, subscriber_id: subscriberId,
      cycle_start: cycleStart, cycle_end: cycleEnd, outcome: 'PAST_DUE',
      applied_subscription_version: 5, plan_id: originalPlanId, plan_version: 1,
    }
    const retryInput = { ...input(false), subscription: failedSubscription, nextStatus: 'ACTIVE' as const }
    const f = postgresPool(async (sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: null }
      if (sql.includes('UPDATE membership_subscriptions SET plan_id')) return { rows: [{ subscription_id: subscriptionId }], rowCount: 1 }
      throw new Error('unexpected PostgreSQL statement')
    }, { receiptRow: receipt })
    await expect(applyRenewalSubscriptionUpdatePostgres(f.pool, retryInput)).resolves.toBe('APPLIED')
    expect(f.transactionCalls.map(x => x.sql)).toEqual([
      'BEGIN', expect.stringContaining('FROM membership_subscription_renewal_cycle_applications'),
      expect.stringContaining('UPDATE membership_subscriptions SET plan_id'),
      expect.stringContaining("UPDATE membership_subscription_renewal_cycle_applications SET outcome = 'ACTIVE'"),
      'COMMIT',
    ])
    expect(f.transactionCalls[3]?.values).toEqual([6, originalPlanId, 1, updatedAt, 'rcy_' + 'd'.repeat(26), 5])
  })

  it('rejects PAST_DUE receipt promotion when the subscription period start is not before the cycle', async () => {
    const invalidSubscription = {
      ...subscriptionRow(), status: 'PAST_DUE' as const, version: 5, current_period_start: cycleStart,
    }
    const receipt = {
      cycle_id: 'rcy_' + 'd'.repeat(26), subscription_id: subscriptionId, subscriber_id: subscriberId,
      cycle_start: cycleStart, cycle_end: cycleEnd, outcome: 'PAST_DUE',
      applied_subscription_version: 5, plan_id: originalPlanId, plan_version: 1,
    }
    const retryInput = { ...input(false), subscription: invalidSubscription, nextStatus: 'ACTIVE' as const }
    const f = postgresPool(async (sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: null }
      throw new Error('unexpected subscription mutation')
    }, { receiptRow: receipt })
    await expect(applyRenewalSubscriptionUpdatePostgres(f.pool, retryInput)).resolves.toBe('CAS_LOST')
    expect(f.transactionCalls.map(x => x.sql)).toEqual([
      'BEGIN', expect.stringContaining('FROM membership_subscription_renewal_cycle_applications'), 'ROLLBACK',
    ])
  })

  it('rolls back the successful subscription CAS when receipt promotion loses its own CAS', async () => {
    const failedSubscription = {
      ...subscriptionRow(), status: 'PAST_DUE' as const, version: 5,
    }
    const receipt = {
      cycle_id: 'rcy_' + 'd'.repeat(26), subscription_id: subscriptionId, subscriber_id: subscriberId,
      cycle_start: cycleStart, cycle_end: cycleEnd, outcome: 'PAST_DUE',
      applied_subscription_version: 5, plan_id: originalPlanId, plan_version: 1,
    }
    const retryInput = { ...input(false), subscription: failedSubscription, nextStatus: 'ACTIVE' as const }
    const f = postgresPool(async (sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [], rowCount: null }
      if (sql.includes('UPDATE membership_subscriptions SET plan_id')) return { rows: [{ subscription_id: subscriptionId }], rowCount: 1 }
      throw new Error('unexpected PostgreSQL statement')
    }, { receiptRow: receipt, receiptUpdateRows: [] })
    await expect(applyRenewalSubscriptionUpdatePostgres(f.pool, retryInput)).resolves.toBe('CAS_LOST')
    expect(f.transactionCalls.map(x => x.sql)).toEqual([
      'BEGIN', expect.stringContaining('FROM membership_subscription_renewal_cycle_applications'),
      expect.stringContaining('UPDATE membership_subscriptions SET plan_id'),
      expect.stringContaining("UPDATE membership_subscription_renewal_cycle_applications SET outcome = 'ACTIVE'"),
      'ROLLBACK',
    ])
    expect(f.transactionCalls.some(x => x.sql === 'COMMIT')).toBe(false)
  })

  it('rolls back when cycle receipt insertion conflicts after subscription CAS', async () => {
    const f = postgresPool(async (sql) => { if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [], rowCount: null }; if (sql.includes('UPDATE membership_subscriptions SET plan_id')) return { rows: [{ subscription_id: subscriptionId }], rowCount: 1 }; throw new Error('unexpected PostgreSQL statement') }, { receiptInsertRows: [] })
    await expect(applyRenewalSubscriptionUpdatePostgres(f.pool, input(false))).resolves.toBe('CAS_LOST')
    expect(f.transactionCalls.map(x => x.sql)).toEqual(['BEGIN', expect.stringContaining('FROM membership_subscription_renewal_cycle_applications'), expect.stringContaining('UPDATE membership_subscriptions SET plan_id'), expect.stringContaining('INSERT INTO membership_subscription_renewal_cycle_applications'), 'ROLLBACK'])
    expect(f.transactionCalls.some(x => x.sql === 'COMMIT')).toBe(false)
  })

  it('rolls back and sanitizes database errors', async () => {
    const f = postgresPool(async (sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [], rowCount: null }
      throw new Error('private connection string')
    })

    await expect(applyRenewalSubscriptionUpdatePostgres(f.pool, input(true)))
      .rejects.toThrow('W07_RENEWAL_OUTCOME_POSTGRES_UNAVAILABLE')
    expect(f.transactionCalls.map(x => x.sql)).toContain('ROLLBACK')
  })
})
