import { describe, expect, it, vi } from 'vitest'
import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'
import { SubscriptionRuntimeError } from './subscription-runtime.js'
import {
  hasPendingScheduledPlanDowngradePostgres,
  insertScheduledPlanChangePostgres,
  readScheduledChangeByIdempotencyPostgres,
  readScheduledDowngradeTargetPlanPostgres,
  readScheduledSubscriptionPlanDowngradeForPeriodPostgres,
} from './subscription-plan-change-schedule-postgres.js'
import type { ScheduledPlanChangeRow, ScheduledSubscriptionPlanDowngrade } from './subscription-plan-change-schedule.js'

const subscriberId = 'user_01'
const subscriptionId = 'sub_01'
const changeId = 'sudc_' + 'a'.repeat(64)
const planId = 'plan_' + 'b'.repeat(64)
const targetPlanId = 'plan_' + 'c'.repeat(64)
const effectiveAt = '2026-12-01T00:00:00.000Z'
const now = '2026-11-18T12:00:00.000Z'

function scheduledRow(): ScheduledPlanChangeRow {
  return {
    change_id: changeId,
    subscriber_id: subscriberId,
    subscription_id: subscriptionId,
    change_type: 'DOWNGRADE',
    expected_subscription_version: 3,
    expected_plan_id: planId,
    expected_plan_version: 1,
    target_plan_id: targetPlanId,
    target_plan_version: 2,
    effective_at: effectiveAt,
    idempotency_key_hash: 'd'.repeat(64),
    status: 'SCHEDULED',
    applied_at: null,
    applied_subscription_version: null,
    created_at: now,
    updated_at: now,
    version: 1,
  }
}

function scheduledChange(): ScheduledSubscriptionPlanDowngrade {
  return {
    changeId,
    subscriberId,
    subscriptionId,
    changeType: 'DOWNGRADE',
    expectedSubscriptionVersion: 3,
    expectedPlanId: planId,
    expectedPlanVersion: 1,
    targetPlanId,
    targetPlanVersion: 2,
    effectiveAt,
    status: 'SCHEDULED',
    appliedAt: null,
    appliedSubscriptionVersion: null,
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

describe('native PostgreSQL scheduled subscription plan changes', () => {
  it('reads idempotency rows with native positional parameters and canonical timestamps', async () => {
    const row = scheduledRow()
    const f = poolWith([{ rows: [row as unknown as Record<string, unknown>], rowCount: 1 }])

    const result = await readScheduledChangeByIdempotencyPostgres(f.pool, subscriberId, row.idempotency_key_hash)

    expect(result).toEqual(row)
    expect(f.calls[0]?.sql).toContain('subscriber_id = $1 AND idempotency_key_hash = $2')
    expect(f.calls[0]?.sql).toContain("to_char(effective_at AT TIME ZONE 'UTC'")
    expect(f.calls[0]?.values).toEqual([subscriberId, row.idempotency_key_hash])
  })

  it('reads only the scheduled or applied record for the matching subscription period and subscriber', async () => {
    const row = scheduledRow()
    const f = poolWith([{ rows: [row as unknown as Record<string, unknown>], rowCount: 1 }])

    const result = await readScheduledSubscriptionPlanDowngradeForPeriodPostgres(
      f.pool, subscriptionId, subscriberId, effectiveAt, true,
    )

    expect(result).toEqual(row)
    expect(f.calls[0]?.sql).toContain('effective_at = $2::timestamptz')
    expect(f.calls[0]?.sql).toContain('subscriber_id = $3')
    expect(f.calls[0]?.sql).toContain("status IN ('SCHEDULED', 'APPLIED')")
    expect(f.calls[0]?.values).toEqual([subscriptionId, effectiveAt, subscriberId])
  })

  it('detects pending schedule conflicts without reading unrelated membership data', async () => {
    const f = poolWith([{ rows: [{ change_id: changeId }], rowCount: 1 }])

    await expect(hasPendingScheduledPlanDowngradePostgres(f.pool, subscriptionId)).resolves.toBe(true)

    expect(f.calls[0]?.sql).toContain("status IN ('SCHEDULED', 'RECONCILIATION_REQUIRED')")
    expect(f.calls[0]?.values).toEqual([subscriptionId])
  })

  it('reads and validates the exact immutable target plan version', async () => {
    const f = poolWith([{
      rows: [{
        plan_id: targetPlanId,
        plan_version: 2,
        owner_type: 'CREATOR',
        owner_id: 'creator_01',
        name: 'Supporter',
        tier: 'supporter',
        billing_interval: 'MONTHLY',
        price_minor: 500,
        currency: 'USD',
        benefits_json: JSON.stringify(['Member posts']),
      }],
      rowCount: 1,
    }])

    const result = await readScheduledDowngradeTargetPlanPostgres(f.pool, scheduledChange())

    expect(result).toEqual({
      planId: targetPlanId,
      planVersion: 2,
      name: 'Supporter',
      tier: 'supporter',
      billingInterval: 'MONTHLY',
      priceMinor: 500,
      currency: 'USD',
      benefits: ['Member posts'],
      creatorId: 'creator_01',
    })
    expect(f.calls[0]?.sql).toContain('v.plan_version = $1')
    expect(f.calls[0]?.sql).toContain('p.plan_id = $2')
    expect(f.calls[0]?.values).toEqual([2, targetPlanId])
  })

  it('inserts with the original membership CAS, owner, pending-upgrade and one-pending-change guards', async () => {
    const f = poolWith([{ rows: [{ change_id: changeId }], rowCount: 1 }])
    const input = {
      changeId,
      subscriberId,
      subscriptionId,
      changeType: 'DOWNGRADE' as const,
      expectedVersion: 3,
      currentPlanId: planId,
      currentPlanVersion: 1,
      targetPlanId,
      targetPlanVersion: 2,
      effectiveAt,
      idempotencyKeyHash: 'd'.repeat(64),
      now,
      currentPeriodStart: '2026-11-01T00:00:00.000Z',
      currentPeriodEnd: effectiveAt,
    }

    await expect(insertScheduledPlanChangePostgres(f.pool, input)).resolves.toBe(true)

    expect(f.calls[0]?.sql).toContain('RETURNING change_id')
    expect(f.calls[0]?.sql).toContain("s.status = 'ACTIVE' AND s.cancel_at IS NULL AND s.version = $16")
    expect(f.calls[0]?.sql).toContain("p.status = 'ACTIVE' AND p.visibility = 'PUBLIC'")
    expect(f.calls[0]?.sql).toContain("a.status IN ('PENDING_PAYMENT', 'RECONCILIATION_REQUIRED')")
    expect(f.calls[0]?.sql).toContain("c.status IN ('SCHEDULED', 'RECONCILIATION_REQUIRED')")
    expect(f.calls[0]?.values).toHaveLength(25)
    expect(f.calls[0]?.values).toEqual([
      changeId, subscriberId, subscriptionId, 'DOWNGRADE', 3, planId, 1, targetPlanId, 2,
      effectiveAt, 'd'.repeat(64), now, now,
      subscriptionId, subscriberId, 3, planId, 1, input.currentPeriodStart, effectiveAt,
      targetPlanId, subscriptionId, subscriberId, subscriptionId, subscriptionId,
    ])
  })

  it('maps PostgreSQL uniqueness conflicts to a sanitized 409', async () => {
    const pool = {
      query: vi.fn(async () => {
        throw Object.assign(new Error('private constraint detail'), { code: '23505' })
      }),
      connect: vi.fn(),
    } as unknown as W07WebhookPostgresPool

    await expect(insertScheduledPlanChangePostgres(pool, {
      changeId,
      subscriberId,
      subscriptionId,
      changeType: 'DOWNGRADE',
      expectedVersion: 3,
      currentPlanId: planId,
      currentPlanVersion: 1,
      targetPlanId,
      targetPlanVersion: 2,
      effectiveAt,
      idempotencyKeyHash: 'd'.repeat(64),
      now,
      currentPeriodStart: '2026-11-01T00:00:00.000Z',
      currentPeriodEnd: effectiveAt,
    })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
  })
})
