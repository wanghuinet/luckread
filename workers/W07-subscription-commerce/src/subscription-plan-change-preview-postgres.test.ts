import { describe, expect, it, vi } from 'vitest'
import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'
import { SubscriptionRuntimeError } from './subscription-runtime.js'
import { previewSubscriptionPlanChange } from './subscription-plan-change-preview.js'

const subscriberId = 'user_01'
const subscriptionId = 'sub_01'
const creatorId = 'creator_01'
const currentPlanId = 'plan_' + 'a'.repeat(64)
const targetPlanId = 'plan_' + 'b'.repeat(64)
const periodStart = '2026-11-01T00:00:00.000Z'
const periodEnd = '2026-12-01T00:00:00.000Z'
const now = new Date('2026-11-18T12:00:00.000Z')

function subscriptionRow() {
  return {
    subscription_id: subscriptionId,
    subscriber_id: subscriberId,
    plan_id: currentPlanId,
    plan_version: 1,
    creator_id: creatorId,
    status: 'ACTIVE',
    current_period_start: periodStart,
    current_period_end: periodEnd,
    cancel_at: null,
    version: 4,
    current_name: 'Premium',
    current_tier: 'supporter',
    current_billing_interval: 'MONTHLY',
    current_price_minor: 1200,
    current_currency: 'USD',
  }
}

function targetRow() {
  return {
    plan_id: targetPlanId,
    owner_type: 'CREATOR',
    owner_id: creatorId,
    current_version: 2,
    status: 'ACTIVE',
    visibility: 'PUBLIC',
    name: 'Basic',
    tier: 'supporter',
    billing_interval: 'MONTHLY',
    price_minor: 500,
    currency: 'USD',
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

describe('native PostgreSQL subscription plan-change preview', () => {
  it('reads the current subscription and target plan with bounded parameterized SQL', async () => {
    const f = poolWith([
      { rows: [subscriptionRow()], rowCount: 1 },
      { rows: [targetRow()], rowCount: 1 },
    ])

    const result = await previewSubscriptionPlanChange(
      f.pool, subscriberId, subscriptionId, targetPlanId, { now: () => now },
    )

    expect(result).toMatchObject({
      subscriptionId,
      currentPlan: { planId: currentPlanId, planVersion: 1, priceMinor: 1200 },
      targetPlan: { planId: targetPlanId, planVersion: 2, priceMinor: 500 },
      changeType: 'DOWNGRADE',
      effectiveAt: periodEnd,
      paymentRequired: false,
      etag: '"lr-v4"',
    })
    expect(f.calls).toHaveLength(2)
    expect(f.calls[0]?.sql).toContain('s.subscription_id = $1 AND s.subscriber_id = $2')
    expect(f.calls[0]?.sql).toContain("to_char(s.current_period_start AT TIME ZONE 'UTC'")
    expect(f.calls[0]?.values).toEqual([subscriptionId, subscriberId])
    expect(f.calls[1]?.sql).toContain('p.plan_id = $1')
    expect(f.calls[1]?.values).toEqual([targetPlanId])
  })

  it('sanitizes PostgreSQL read failures as a retryable service error', async () => {
    const pool = {
      query: vi.fn(async () => { throw new Error('private connection details') }),
      connect: vi.fn(),
    } as unknown as W07WebhookPostgresPool

    await expect(previewSubscriptionPlanChange(
      pool, subscriberId, subscriptionId, targetPlanId, { now: () => now },
    )).rejects.toBeInstanceOf(SubscriptionRuntimeError)
    await expect(previewSubscriptionPlanChange(
      pool, subscriberId, subscriptionId, targetPlanId, { now: () => now },
    )).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })
})
