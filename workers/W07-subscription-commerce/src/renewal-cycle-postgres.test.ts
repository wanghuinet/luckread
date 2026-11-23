import { describe, expect, it, vi } from 'vitest'
import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'
import {
  acquireRenewalSubmissionLeasePostgres,
  finishRenewalSubmissionLeasePostgres,
  insertRenewalCyclePostgres,
  listPendingRenewalCycleIdsPostgres,
  markRenewalCycleSyncStatePostgres,
  readRenewalCycleByIdPostgres,
  readRenewalCycleByPaymentPostgres,
  readRenewalCycleByPeriodPostgres,
  readRenewalSchedulerCursorPostgres,
  retryFailedRenewalCyclePostgres,
  transitionRenewalCycleToPaymentReadyPostgres,
  updateRenewalCyclePostgres,
  writeRenewalSchedulerCursorPostgres,
  type RenewalCycleRow,
  type RenewalCursorRow,
} from './renewal-cycle-postgres.js'

const cycleId = 'rcy_' + 'a'.repeat(26)
const subscriptionId = 'sub_renewal_01'
const subscriberId = 'user_renewal_01'
const merchantId = 'merchant_01'
const paymentId = 'pay_' + 'b'.repeat(26)
const periodStart = '2026-11-01T00:00:00.000Z'
const periodEnd = '2026-12-01T00:00:00.000Z'
const now = '2026-11-18T12:00:00.000Z'
const later = '2026-11-18T12:00:01.000Z'

function cycleRow(overrides: Partial<RenewalCycleRow> = {}): RenewalCycleRow {
  return {
    cycle_id: cycleId,
    provider: 'hyperswitch',
    merchant_id: merchantId,
    subscription_id: subscriptionId,
    subscriber_id: subscriberId,
    plan_id: 'plan_' + 'c'.repeat(64),
    plan_version: 2,
    cycle_start: periodStart,
    cycle_end: periodEnd,
    billing_interval: 'MONTHLY',
    currency: 'USD',
    offer_snapshot_json: JSON.stringify({ planId: 'plan_example' }),
    amount_minor: 900,
    pricing_snapshot_json: JSON.stringify({ currency: 'USD', items: [] }),
    payment_method_id: 'pm_01',
    mandate_record_id: 'mnd_' + 'd'.repeat(26),
    order_id: 'ord_01',
    payment_id: paymentId,
    state: 'PREPARED',
    subscription_sync_state: 'PENDING',
    subscription_sync_updated_at: null,
    subscription_sync_error_code: null,
    attempt_number: 1,
    provider_response_status: null,
    outcome_code: null,
    lease_token: null,
    lease_expires_at: null,
    version: 3,
    created_at: '2026-11-01T00:00:00.000Z',
    updated_at: now,
    ...overrides,
  }
}

function cursorRow(overrides: Partial<RenewalCursorRow> = {}): RenewalCursorRow {
  return {
    state_id: 'subscription-renewals',
    cursor_period_end: periodEnd,
    cursor_subscription_id: subscriptionId,
    version: 2,
    updated_at: now,
    ...overrides,
  }
}

function poolWith(
  handler: (sql: string, values: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>,
) {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values })
    return handler(sql, values)
  })
  return {
    pool: { query, connect: vi.fn() } as unknown as W07WebhookPostgresPool,
    query,
    calls,
  }
}

describe('native PostgreSQL D1-04 renewal cycle persistence', () => {
  it('reads a cycle by ID with canonical UTC timestamps and numeric fields', async () => {
    const row = cycleRow()
    const f = poolWith(async () => ({ rows: [row as unknown as Record<string, unknown>], rowCount: 1 }))

    await expect(readRenewalCycleByIdPostgres(f.pool, cycleId)).resolves.toEqual(row)

    expect(f.calls[0]?.sql).toContain('cycle_id = $1 LIMIT 1')
    expect(f.calls[0]?.sql).toContain("to_char(cycle_start AT TIME ZONE 'UTC'")
    expect(f.calls[0]?.sql).toContain('version::double precision AS version')
    expect(f.calls[0]?.values).toEqual([cycleId])
  })

  it('reads the unique subscription/period cycle using a timestamptz predicate', async () => {
    const row = cycleRow()
    const f = poolWith(async () => ({ rows: [row as unknown as Record<string, unknown>], rowCount: 1 }))

    await expect(readRenewalCycleByPeriodPostgres(f.pool, subscriptionId, periodStart)).resolves.toEqual(row)

    expect(f.calls[0]?.sql).toContain('subscription_id = $1 AND cycle_start = $2::timestamptz')
    expect(f.calls[0]?.values).toEqual([subscriptionId, periodStart])
  })

  it('inserts only an initial AWAITING_PRICING cycle and relies on the subscription-period unique key', async () => {
    const f = poolWith(async () => ({ rows: [{ cycle_id: cycleId }], rowCount: 1 }))
    const input = {
      cycleId,
      merchantId,
      subscriptionId,
      subscriberId,
      planId: 'plan_' + 'c'.repeat(64),
      planVersion: 2,
      cycleStart: periodStart,
      cycleEnd: periodEnd,
      billingInterval: 'MONTHLY' as const,
      currency: 'USD',
      offerSnapshotJson: JSON.stringify({ subscriptionId, subscriberId }),
      now,
    }

    await expect(insertRenewalCyclePostgres(f.pool, input)).resolves.toBe(true)

    expect(f.calls[0]?.sql).toContain("'hyperswitch'")
    expect(f.calls[0]?.sql).toContain("'AWAITING_PRICING'")
    expect(f.calls[0]?.sql).toContain('ON CONFLICT (subscription_id, cycle_start) DO NOTHING RETURNING cycle_id')
    expect(f.calls[0]?.values).toEqual([
      cycleId, merchantId, subscriptionId, subscriberId, input.planId, 2,
      periodStart, periodEnd, 'MONTHLY', 'USD', input.offerSnapshotJson, now, now,
    ])
  })

  it('updates trusted cycle fields through version CAS and returns the canonical reread', async () => {
    const row = cycleRow({ state: 'RECONCILIATION_REQUIRED', outcome_code: 'MANDATE_NOT_ACTIVE', version: 4, updated_at: later })
    const f = poolWith(async (sql) => sql.startsWith('UPDATE')
      ? { rows: [{ cycle_id: cycleId }], rowCount: 1 }
      : { rows: [row as unknown as Record<string, unknown>], rowCount: 1 })

    await expect(updateRenewalCyclePostgres(
      f.pool, cycleRow(), later,
      "state = ?, outcome_code = ?, lease_token = NULL",
      ['RECONCILIATION_REQUIRED', 'MANDATE_NOT_ACTIVE'],
    )).resolves.toEqual(row)

    expect(f.calls[0]?.sql).toContain('state = $1, outcome_code = $2, lease_token = NULL')
    expect(f.calls[0]?.sql).toContain('WHERE cycle_id = $4 AND version = $5')
    expect(f.calls[0]?.values).toEqual([
      'RECONCILIATION_REQUIRED', 'MANDATE_NOT_ACTIVE', later, cycleId, 3,
    ])
    expect(f.calls[1]?.sql).toContain('SELECT')
    expect(f.calls[1]?.values).toEqual([cycleId])
  })

  it('transitions to PAYMENT_READY only when order and payment references are already bound', async () => {
    const row = cycleRow({ state: 'PAYMENT_READY', version: 4, updated_at: later })
    const f = poolWith(async (sql) => sql.startsWith('UPDATE')
      ? { rows: [{ cycle_id: cycleId }], rowCount: 1 }
      : { rows: [row as unknown as Record<string, unknown>], rowCount: 1 })

    await expect(transitionRenewalCycleToPaymentReadyPostgres(f.pool, cycleRow(), later)).resolves.toEqual(row)

    expect(f.calls[0]?.sql).toContain("SET state = 'PAYMENT_READY'")
    expect(f.calls[0]?.sql).toContain('order_id IS NOT NULL AND payment_id IS NOT NULL')
    expect(f.calls[0]?.values).toEqual([later, cycleId, 3, 'PREPARED'])
  })

  it('returns null when payment-ready transition loses its version CAS', async () => {
    const f = poolWith(async () => ({ rows: [], rowCount: 0 }))

    await expect(transitionRenewalCycleToPaymentReadyPostgres(
      f.pool, cycleRow(), later,
    )).resolves.toBeNull()

    expect(f.calls).toHaveLength(1)
    expect(f.calls[0]?.sql).toContain('RETURNING cycle_id')
  })

  it('acquires a submission lease with a state/version CAS and expiry predicate', async () => {
    const row = cycleRow({ state: 'SUBMITTING', lease_token: 'lease_1', lease_expires_at: later, version: 4, updated_at: later })
    const f = poolWith(async (sql) => sql.startsWith('UPDATE')
      ? { rows: [{ cycle_id: cycleId }], rowCount: 1 }
      : { rows: [row as unknown as Record<string, unknown>], rowCount: 1 })
    const result = await acquireRenewalSubmissionLeasePostgres(
      f.pool, cycleRow({ state: 'PAYMENT_READY' }), 'lease_1', later, now, now,
    )
    expect(result).toEqual(row)
    expect(f.calls[0]?.sql).toContain("SET state = 'SUBMITTING'")
    expect(f.calls[0]?.sql).toContain("state = 'PAYMENT_READY' OR (state = 'SUBMITTING' AND lease_expires_at <= $6::timestamptz)")
    expect(f.calls[0]?.values).toEqual(['lease_1', later, now, cycleId, 3, now])
    expect(f.calls[1]?.values).toEqual([cycleId])
  })

  it('finishes a submission only while the exact unexpired lease token is held', async () => {
    const f = poolWith(async () => ({ rows: [], rowCount: 0 }))

    await expect(finishRenewalSubmissionLeasePostgres(
      f.pool, cycleId, 'lease_old', now, later, {
        state: 'SUBMITTED',
        providerResponseStatus: 'processing',
        outcomeCode: 'AWAITING_SIGNED_WEBHOOK',
      },
    )).resolves.toBe(false)

    expect(f.calls).toHaveLength(1)
    expect(f.calls[0]?.sql).toContain("state = 'SUBMITTING'")
    expect(f.calls[0]?.sql).toContain('lease_token = $6')
    expect(f.calls[0]?.sql).toContain('lease_expires_at > $7::timestamptz')
    expect(f.calls[0]?.values).toEqual([
      'SUBMITTED', 'processing', 'AWAITING_SIGNED_WEBHOOK', later, cycleId, 'lease_old', now,
    ])
  })

  it('reopens a failed synchronized cycle only via retry backoff and attempt CAS', async () => {
    const f = poolWith(async () => ({ rows: [{ cycle_id: cycleId }], rowCount: 1 }))

    await expect(retryFailedRenewalCyclePostgres(
      f.pool, cycleRow({ state: 'FAILED', subscription_sync_state: 'APPLIED' }), later, now, 20,
    )).resolves.toBe(true)

    expect(f.calls[0]?.sql).toContain("state = 'PREPARED'")
    expect(f.calls[0]?.sql).toContain("subscription_sync_state = 'PENDING'")
    expect(f.calls[0]?.sql).toContain("state = 'FAILED' AND subscription_sync_state = 'APPLIED'")
    expect(f.calls[0]?.sql).toContain('attempt_number < $4 AND updated_at <= $5::timestamptz')
    expect(f.calls[0]?.values).toEqual([later, cycleId, 3, 20, now])
  })

  it('returns null when the scheduler singleton has not been initialized', async () => {
    const f = poolWith(async () => ({ rows: [], rowCount: 0 }))

    await expect(readRenewalSchedulerCursorPostgres(f.pool)).resolves.toBeNull()
  })

  it('reads and advances the scheduler singleton through version CAS', async () => {
    const row = cursorRow()
    const f = poolWith(async (sql) => sql.startsWith('SELECT')
      ? { rows: [row as unknown as Record<string, unknown>], rowCount: 1 }
      : { rows: [{ state_id: 'subscription-renewals' }], rowCount: 1 })

    await expect(readRenewalSchedulerCursorPostgres(f.pool)).resolves.toEqual(row)
    await expect(writeRenewalSchedulerCursorPostgres(f.pool, row, null, null, later)).resolves.toBe(true)

    expect(f.calls[0]?.sql).toContain("state_id = 'subscription-renewals'")
    expect(f.calls[1]?.sql).toContain('cursor_period_end = $1::timestamptz')
    expect(f.calls[1]?.sql).toContain('AND version = $4 RETURNING state_id')
    expect(f.calls[1]?.values).toEqual([null, null, later, 2])
  })

  it('marks terminal outcome synchronization with a cycle-version CAS and safely handles a race replay', async () => {
    const applied = cycleRow({
      state: 'SUCCEEDED',
      subscription_sync_state: 'APPLIED',
      subscription_sync_updated_at: later,
      version: 4,
      updated_at: later,
    })
    const f = poolWith(async (sql) => sql.startsWith('UPDATE')
      ? { rows: [], rowCount: 0 }
      : { rows: [applied as unknown as Record<string, unknown>], rowCount: 1 })

    await expect(markRenewalCycleSyncStatePostgres(
      f.pool, cycleRow({ state: 'SUCCEEDED' }), 'APPLIED', null, later, later,
    )).resolves.toBe(true)

    expect(f.calls[0]?.sql).toContain("subscription_sync_state = 'PENDING'")
    expect(f.calls[0]?.sql).toContain('WHERE cycle_id = $5 AND version = $6 AND state = $7')
    expect(f.calls[0]?.values).toEqual(['APPLIED', later, null, later, cycleId, 3, 'SUCCEEDED'])
  })

  it('does not treat a concurrent reconciliation with a different reason as this request succeeding', async () => {
    const latest = cycleRow({
      state: 'SUCCEEDED',
      subscription_sync_state: 'RECONCILIATION_REQUIRED',
      subscription_sync_error_code: 'OTHER_WORKER_REASON',
      version: 4,
      updated_at: later,
    })
    const f = poolWith(async (sql) => sql.startsWith('UPDATE')
      ? { rows: [], rowCount: 0 }
      : { rows: [latest as unknown as Record<string, unknown>], rowCount: 1 })

    await expect(markRenewalCycleSyncStatePostgres(
      f.pool, cycleRow({ state: 'SUCCEEDED' }), 'RECONCILIATION_REQUIRED',
      'THIS_WORKER_REASON', later, later,
    )).resolves.toBe(false)

    expect(f.calls).toHaveLength(2)
    expect(f.calls[1]?.sql).toContain('SELECT')
  })

  it('lists pending terminal outcomes with a bounded stable order and reads payment mapping', async () => {
    const f = poolWith(async (sql) => sql.includes('WHERE provider')
      ? { rows: [{ cycle_id: cycleId }], rowCount: 1 }
      : { rows: [{ cycle_id: cycleId }], rowCount: 1 })

    await expect(listPendingRenewalCycleIdsPostgres(f.pool, 12)).resolves.toEqual([{ cycle_id: cycleId }])
    await expect(readRenewalCycleByPaymentPostgres(f.pool, merchantId, paymentId)).resolves.toEqual({ cycle_id: cycleId })

    expect(f.calls[0]?.sql).toContain("state IN ('SUCCEEDED','FAILED')")
    expect(f.calls[0]?.sql).toContain('ORDER BY updated_at ASC, cycle_id ASC LIMIT $1')
    expect(f.calls[0]?.values).toEqual([12])
    expect(f.calls[1]?.sql).toContain('merchant_id = $1 AND payment_id = $2')
    expect(f.calls[1]?.values).toEqual([merchantId, paymentId])
  })

  it('treats an absent renewal-cycle table as no renewal cycle for ordinary signed payments', async () => {
    const pool = {
      query: vi.fn(async () => {
        throw Object.assign(new Error('relation does not exist'), { code: '42P01' })
      }),
      connect: vi.fn(),
    } as unknown as W07WebhookPostgresPool

    await expect(readRenewalCycleByPaymentPostgres(pool, merchantId, paymentId)).resolves.toBeNull()
  })
})
