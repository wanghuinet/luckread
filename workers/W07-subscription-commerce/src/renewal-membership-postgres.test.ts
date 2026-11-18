import { describe, expect, it, vi } from 'vitest'
import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'
import {
  readDueRenewalMembershipsPostgres,
  readRenewalChargeSubscriptionPostgres,
  type RenewalMembershipCandidateRow,
} from './renewal-membership-postgres.js'

const subscriptionId = 'sub_renewal_01'
const subscriberId = 'user_renewal_01'
const planId = 'plan_' + 'a'.repeat(64)
const now = '2026-11-18T12:00:00.000Z'
const periodStart = '2026-11-01T12:00:00.000Z'
const periodEnd = '2026-11-19T12:00:00.000Z'

function candidateRow(): RenewalMembershipCandidateRow {
  return {
    subscription_id: subscriptionId,
    subscriber_id: subscriberId,
    plan_id: planId,
    plan_version: 2,
    creator_id: 'creator_01',
    status: 'ACTIVE',
    current_period_start: periodStart,
    current_period_end: periodEnd,
    trial_started_at: null,
    trial_ends_at: null,
    cancel_at: null,
    billing_interval: 'MONTHLY',
    price_minor: 900,
    currency: 'USD',
    name: 'Supporter',
    tier: 'supporter',
    benefits_json: '[]',
  }
}

function poolWith(results: Array<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>) {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values })
    return results.shift() ?? { rows: [], rowCount: 0 }
  })
  return {
    pool: { query, connect: vi.fn() } as unknown as W07WebhookPostgresPool,
    query,
    calls,
  }
}

describe('native PostgreSQL renewal membership reads', () => {
  it('scans the due renewal window using a stable timestamp/subscription cursor', async () => {
    const row = candidateRow()
    const f = poolWith([{ rows: [row as unknown as Record<string, unknown>], rowCount: 1 }])

    await expect(readDueRenewalMembershipsPostgres(
      f.pool, now, periodStart, 'sub_previous', 17,
    )).resolves.toEqual([row])

    expect(f.calls[0]?.sql).toContain("status IN ('TRIALING','ACTIVE','PAST_DUE')")
    expect(f.calls[0]?.sql).toContain('s.current_period_end <= $1::timestamptz')
    expect(f.calls[0]?.sql).toContain('s.current_period_end > $2::timestamptz')
    expect(f.calls[0]?.sql).toContain('s.subscription_id > $3::text')
    expect(f.calls[0]?.sql).toContain('ORDER BY s.current_period_end ASC, s.subscription_id ASC LIMIT $4')
    expect(f.calls[0]?.sql).toContain("to_char(s.trial_ends_at AT TIME ZONE 'UTC'")
    expect(f.calls[0]?.values).toEqual([now, periodStart, 'sub_previous', 17])
  })

  it('reads a single subscriber-owned subscription for charge eligibility/retry checks', async () => {
    const row = {
      subscription_id: subscriptionId,
      subscriber_id: subscriberId,
      plan_id: planId,
      plan_version: 2,
      creator_id: 'creator_01',
      status: 'PAST_DUE',
      current_period_end: periodEnd,
      trial_started_at: null,
      trial_ends_at: null,
      cancel_at: null,
    }
    const f = poolWith([{ rows: [row], rowCount: 1 }])

    await expect(readRenewalChargeSubscriptionPostgres(
      f.pool, subscriptionId, subscriberId,
    )).resolves.toEqual(row)

    expect(f.calls[0]?.sql).toContain('subscription_id = $1 AND subscriber_id = $2 LIMIT 1')
    expect(f.calls[0]?.sql).toContain("to_char(current_period_end AT TIME ZONE 'UTC'")
    expect(f.calls[0]?.values).toEqual([subscriptionId, subscriberId])
  })

  it('maps PostgreSQL failures to a sanitized renewal membership read error', async () => {
    const pool = {
      query: vi.fn(async () => { throw new Error('private connection string') }),
      connect: vi.fn(),
    } as unknown as W07WebhookPostgresPool

    await expect(readDueRenewalMembershipsPostgres(pool, now, null, null, 20))
      .rejects.toThrow('W07_RENEWAL_MEMBERSHIP_POSTGRES_UNAVAILABLE')
    await expect(readRenewalChargeSubscriptionPostgres(pool, subscriptionId, subscriberId))
      .rejects.toThrow('W07_RENEWAL_MEMBERSHIP_POSTGRES_UNAVAILABLE')
  })
})
