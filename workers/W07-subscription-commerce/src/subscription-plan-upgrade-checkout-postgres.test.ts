import { describe, expect, it, vi } from 'vitest'
import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'
import { SubscriptionRuntimeError } from './subscription-runtime.js'
import {
  attachPlanUpgradeOrderPostgres,
  expirePlanUpgradeAttemptPostgres,
  expireStalePlanUpgradeAttemptsPostgres,
  insertPlanUpgradeAttemptPostgres,
  readPlanUpgradeAttemptByIdPostgres,
  readPlanUpgradeAttemptByIdempotencyPostgres,
} from './subscription-plan-upgrade-checkout-postgres.js'
import type { PlanChangeAttemptRow } from './subscription-plan-change-checkout.js'

const attemptId = 'suca_' + 'a'.repeat(64)
const subscriberId = 'user_1'
const subscriptionId = 'sub_1'
const currentPlanId = 'plan_' + 'b'.repeat(64)
const targetPlanId = 'plan_' + 'c'.repeat(64)
const keyHash = 'd'.repeat(64)
const periodStart = '2026-11-01T00:00:00.000Z'
const periodEnd = '2026-12-01T00:00:00.000Z'
const now = '2026-11-18T12:00:00.000Z'
const expiresAt = '2026-12-01T00:00:00.000Z'

function attemptRow(): PlanChangeAttemptRow {
  return {
    attempt_id: attemptId,
    subscriber_id: subscriberId,
    subscription_id: subscriptionId,
    expected_subscription_version: 3,
    expected_plan_id: currentPlanId,
    expected_plan_version: 1,
    target_plan_id: targetPlanId,
    target_plan_version: 2,
    current_period_start: periodStart,
    current_period_end: periodEnd,
    idempotency_key_hash: keyHash,
    order_id: null,
    status: 'PENDING_PAYMENT',
    expires_at: expiresAt,
    applied_at: null,
    applied_subscription_version: null,
    created_at: now,
    updated_at: now,
    version: 1,
  }
}

function poolWith(results: Array<{ rows: Array<Record<string, unknown>>; rowCount: number | null }> = []) {
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

describe('native PostgreSQL paid plan-upgrade checkout reservations', () => {
  it('reads idempotency rows with canonical timestamps and a bounded subscriber/key scope', async () => {
    const row = attemptRow()
    const f = poolWith([{ rows: [row as unknown as Record<string, unknown>], rowCount: 1 }])

    await expect(readPlanUpgradeAttemptByIdempotencyPostgres(f.pool, subscriberId, keyHash)).resolves.toEqual(row)

    expect(f.calls[0]?.sql).toContain('subscriber_id = $1 AND idempotency_key_hash = $2')
    expect(f.calls[0]?.sql).toContain("to_char(current_period_start AT TIME ZONE 'UTC'")
    expect(f.calls[0]?.values).toEqual([subscriberId, keyHash])
  })

  it('reads a specific attempt id with parameterized SQL', async () => {
    const row = attemptRow()
    const f = poolWith([{ rows: [row as unknown as Record<string, unknown>], rowCount: 1 }])

    await expect(readPlanUpgradeAttemptByIdPostgres(f.pool, attemptId)).resolves.toEqual(row)

    expect(f.calls[0]?.sql).toContain('WHERE attempt_id = $1')
    expect(f.calls[0]?.values).toEqual([attemptId])
  })

  it('expires one attempt only through status and version compare-and-set', async () => {
    const f = poolWith([{ rows: [], rowCount: 1 }])

    await expirePlanUpgradeAttemptPostgres(f.pool, attemptRow(), now)

    expect(f.calls[0]?.sql).toContain("SET status = 'EXPIRED'")
    expect(f.calls[0]?.sql).toContain('WHERE attempt_id = $2 AND status = $3 AND version = $4')
    expect(f.calls[0]?.values).toEqual([now, attemptId, 'PENDING_PAYMENT', 1])
  })

  it('expires only stale PENDING_PAYMENT attempts for the same subscription', async () => {
    const f = poolWith([{ rows: [], rowCount: 3 }])

    await expireStalePlanUpgradeAttemptsPostgres(f.pool, subscriptionId, now)

    expect(f.calls[0]?.sql).toContain("status = 'PENDING_PAYMENT' AND expires_at <= $1::timestamptz")
    expect(f.calls[0]?.values).toEqual([now, subscriptionId])
  })

  it('inserts a guarded PENDING_PAYMENT reservation with subscription/plan/upgrade/schedule preconditions', async () => {
    const f = poolWith([{ rows: [{ attempt_id: attemptId }], rowCount: 1 }])
    const input = {
      attemptId,
      subscriberId,
      subscriptionId,
      expectedSubscriptionVersion: 3,
      expectedPlanId: currentPlanId,
      expectedPlanVersion: 1,
      targetPlanId,
      targetPlanVersion: 2,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      idempotencyKeyHash: keyHash,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    }

    await expect(insertPlanUpgradeAttemptPostgres(f.pool, input)).resolves.toBe(true)

    expect(f.calls[0]?.sql).toContain("status = 'ACTIVE' AND cancel_at IS NULL AND version = $17")
    expect(f.calls[0]?.sql).toContain("owner_type = 'CREATOR'")
    expect(f.calls[0]?.sql).toContain("current_version = $25 AND status = 'ACTIVE' AND visibility = 'PUBLIC'")
    expect(f.calls[0]?.sql).toContain("status IN ('SCHEDULED', 'RECONCILIATION_REQUIRED')")
    expect(f.calls[0]?.values).toEqual([
      attemptId, subscriberId, subscriptionId, 3, currentPlanId, 1, targetPlanId, 2,
      periodStart, periodEnd, keyHash, expiresAt, now, now,
      subscriptionId, subscriberId, 3, currentPlanId, 1, periodStart, periodEnd,
      targetPlanId, subscriptionId, subscriberId, 2, subscriptionId,
    ])
  })

  it('maps unique reservation conflicts to a sanitized HTTP 409', async () => {
    const pool = {
      query: vi.fn(async () => {
        throw Object.assign(new Error('private unique-index detail'), { code: '23505' })
      }),
      connect: vi.fn(),
    } as unknown as W07WebhookPostgresPool

    await expect(insertPlanUpgradeAttemptPostgres(pool, {
      attemptId,
      subscriberId,
      subscriptionId,
      expectedSubscriptionVersion: 3,
      expectedPlanId: currentPlanId,
      expectedPlanVersion: 1,
      targetPlanId,
      targetPlanVersion: 2,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      idempotencyKeyHash: keyHash,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
  })

  it('binds the finance order id only to the matching pending upgrade attempt', async () => {
    const f = poolWith([{ rows: [{ attempt_id: attemptId }], rowCount: 1 }])

    await expect(attachPlanUpgradeOrderPostgres(f.pool, attemptId, 'order_1', now)).resolves.toBe(true)

    expect(f.calls[0]?.sql).toContain("status = 'PENDING_PAYMENT'")
    expect(f.calls[0]?.sql).toContain('(order_id IS NULL OR order_id = $1)')
    expect(f.calls[0]?.values).toEqual(['order_1', now, attemptId])
  })

  it('maps database failures to a sanitized retryable service error', async () => {
    const pool = {
      query: vi.fn(async () => { throw new Error('private database connection detail') }),
      connect: vi.fn(),
    } as unknown as W07WebhookPostgresPool

    await expect(readPlanUpgradeAttemptByIdPostgres(pool, attemptId))
      .rejects.toBeInstanceOf(SubscriptionRuntimeError)
    await expect(readPlanUpgradeAttemptByIdPostgres(pool, attemptId))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })
})
