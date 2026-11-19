import { describe, expect, it, vi } from 'vitest'
import type { W07WebhookPostgresClient, W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'
import { fulfillPaidMembershipOrder } from './paid-membership-order-fulfillment.js'

const paymentId = 'pay_' + 'b'.repeat(26)
const merchantId = 'merchant_1'
const orderId = 'ord_purchase_01'
const lineId = 'line_01'
const subscriberId = 'user_1'
const creatorId = 'creator_1'
const targetPlanId = 'plan_' + 'a'.repeat(64)
const previousPlanId = 'plan_' + 'c'.repeat(64)
const attemptId = 'suca_' + 'd'.repeat(64)
const orderConfirmedAt = '2026-11-18T12:00:00.000Z'
const currentPeriodStart = '2026-11-01T12:00:00.000Z'
const currentPeriodEnd = '2026-12-01T12:00:00.000Z'
const attemptUpdatedAt = '2026-11-18T11:00:00.000Z'
const expiresAt = '2026-11-18T13:00:00.000Z'
const benefits = ['Member posts']

function snapshot(subscriptionChange?: Record<string, unknown>) {
  return {
    planId: targetPlanId,
    planVersion: 2,
    creatorId,
    name: 'Supporter',
    tier: 'supporter',
    billingInterval: 'MONTHLY',
    priceMinor: 500,
    chargedAmountMinor: subscriptionChange ? 300 : 500,
    currency: 'USD',
    benefits,
    ...(subscriptionChange ? { subscriptionChange } : {}),
  }
}

function paidOrder(totalMinor: number) {
  return {
    payment_id: paymentId,
    order_id: orderId,
    customer_id: subscriberId,
    provider: 'hyperswitch',
    merchant_id: merchantId,
    payment_status: 'succeeded',
    amount_minor: totalMinor,
    payment_currency: 'USD',
    order_status: 'CONFIRMED',
    order_currency: 'USD',
    total_minor: totalMinor,
    confirmed_at: orderConfirmedAt,
  }
}

function orderLine(itemSnapshot: Record<string, unknown>, unitAmount: number) {
  return {
    order_line_id: lineId,
    item_type: 'MEMBERSHIP_PLAN',
    item_ref: targetPlanId,
    item_version: '2',
    quantity: 1,
    unit_amount_minor: unitAmount,
    line_total_minor: unitAmount,
    item_snapshot_json: JSON.stringify(itemSnapshot),
  }
}

function planRow() {
  return {
    plan_id: targetPlanId,
    owner_type: 'CREATOR',
    owner_id: creatorId,
    plan_version: 2,
    name: 'Supporter',
    tier: 'supporter',
    billing_interval: 'MONTHLY',
    price_minor: 500,
    currency: 'USD',
    benefits_json: JSON.stringify(benefits),
  }
}

function nativePool(
  queryHandler: (sql: string, values: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>,
  connect?: () => Promise<W07WebhookPostgresClient>,
) {
  const query = vi.fn((sql: string, values: unknown[] = []) => queryHandler(sql, values))
  return {
    pool: {
      query,
      connect: vi.fn(connect),
    } as unknown as W07WebhookPostgresPool,
    query,
  }
}

function envFixture() {
  const auditFetch = vi.fn(async (request: Request) => {
    const body = await request.json() as Record<string, unknown>
    return new Response(JSON.stringify({
      eventId: body.eventId,
      action: 'subscription.plan_upgraded',
      targetType: 'Subscription',
      targetId: body.subscriptionId,
    }), { status: 201 })
  })
  const env = {
    D1_04: {} as D1Database,
    W07_DATABASE_DRIVER: 'neon',
    W07_MEMBERSHIP_DATABASE_DRIVER: 'neon',
    W06_GOVERNANCE: { fetch: auditFetch } as unknown as Fetcher,
  }
  return { env, auditFetch }
}

describe('native PostgreSQL paid membership order fulfillment', () => {
  it('creates a first paid subscription with separate D1-04 finance and D1-01 Neon pools', async () => {
    const offer = snapshot()
    const line = orderLine(offer, 500)
    const finance = nativePool(async (sql) => {
      if (sql.includes('FROM payments AS p')) return { rows: [paidOrder(500)], rowCount: 1 }
      if (sql.includes('FROM order_lines WHERE order_id = $1')) return { rows: [line], rowCount: 1 }
      throw new Error('unexpected finance query')
    })

    let insertedRow: Record<string, unknown> | null = null
    let subscriptionReadCount = 0
    const membership = nativePool(async (sql, values) => {
      if (sql.includes('FROM membership_plans AS p')) return { rows: [planRow()], rowCount: 1 }
      if (sql.includes('FROM membership_subscriptions WHERE subscription_id = $1 LIMIT 1')) {
        subscriptionReadCount += 1
        return { rows: insertedRow ? [insertedRow] : [], rowCount: insertedRow ? 1 : 0 }
      }
      if (sql.includes('INSERT INTO membership_subscriptions')) {
        const [subscriptionId, sub, planId, version, creator, startedAt, periodStart, periodEnd, entitlementRef] = values
        insertedRow = {
          subscription_id: subscriptionId,
          subscriber_id: sub,
          plan_id: planId,
          plan_version: version,
          creator_id: creator,
          status: 'ACTIVE',
          started_at: startedAt,
          current_period_start: periodStart,
          current_period_end: periodEnd,
          entitlement_snapshot_ref: entitlementRef,
        }
        return { rows: [{ subscription_id: subscriptionId as string }], rowCount: 1 }
      }
      throw new Error('unexpected membership query')
    })

    const { env } = envFixture()
    const result = await fulfillPaidMembershipOrder(env, paymentId, merchantId, {
      getFinancePostgresPool: () => finance.pool,
      getMembershipPostgresPool: () => membership.pool,
    })

    expect(result).toEqual({ outcome: 'APPLIED', fulfilledCount: 1 })
    expect(finance.query).toHaveBeenCalledTimes(2)
    expect(finance.query.mock.calls[0]?.[0]).toContain('p.amount_minor::double precision')
    expect(finance.query.mock.calls[0]?.[1]).toEqual([paymentId, merchantId])
    expect(membership.query).toHaveBeenCalledTimes(4)
    expect(membership.query.mock.calls[2]?.[0]).toContain('ON CONFLICT (subscription_id) DO NOTHING RETURNING subscription_id')
    expect(membership.query.mock.calls[2]?.[1]).toEqual(expect.arrayContaining([subscriberId, targetPlanId, creatorId]))
    expect(subscriptionReadCount).toBe(2)
  })

  it('applies a paid plan upgrade with one PostgreSQL transaction before the W06 audit', async () => {
    const change = {
      kind: 'PLAN_UPGRADE',
      attemptId,
      subscriberId,
      subscriptionId: 'sub_upgrade_01',
      expectedSubscriptionVersion: 4,
      expectedPlanId: previousPlanId,
      expectedPlanVersion: 1,
      targetPlanId,
      targetPlanVersion: 2,
      currentPeriodStart,
      currentPeriodEnd,
      expiresAt,
    }
    const offer = snapshot(change)
    const line = orderLine(offer, 300)
    const finance = nativePool(async (sql) => {
      if (sql.includes('FROM payments AS p')) return { rows: [paidOrder(300)], rowCount: 1 }
      if (sql.includes('FROM order_lines WHERE order_id = $1')) return { rows: [line], rowCount: 1 }
      throw new Error('unexpected finance query')
    })
    const attempt = {
      attempt_id: attemptId,
      subscriber_id: subscriberId,
      subscription_id: 'sub_upgrade_01',
      expected_subscription_version: 4,
      expected_plan_id: previousPlanId,
      expected_plan_version: 1,
      target_plan_id: targetPlanId,
      target_plan_version: 2,
      current_period_start: currentPeriodStart,
      current_period_end: currentPeriodEnd,
      order_id: orderId,
      status: 'PENDING_PAYMENT',
      expires_at: expiresAt,
      updated_at: attemptUpdatedAt,
    }
    const subscription = {
      subscription_id: 'sub_upgrade_01',
      subscriber_id: subscriberId,
      plan_id: previousPlanId,
      plan_version: 1,
      creator_id: creatorId,
      status: 'ACTIVE',
      current_period_start: currentPeriodStart,
      current_period_end: currentPeriodEnd,
      cancel_at: null,
      entitlement_snapshot_ref: 'commerce-order:original:line:original',
      updated_at: '2026-11-18T10:00:00.000Z',
      version: 4,
    }
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const membership = nativePool(async (sql, values) => {
      if (sql.includes('FROM membership_plans AS p')) return { rows: [planRow()], rowCount: 1 }
      if (sql.includes('FROM membership_subscription_plan_change_attempts WHERE attempt_id = $1 LIMIT 1')) return { rows: [attempt], rowCount: 1 }
      if (sql.includes('FROM membership_subscriptions WHERE subscription_id = $1 AND subscriber_id = $2 LIMIT 1')) return { rows: [subscription], rowCount: 1 }
      throw new Error('unexpected membership pool query: ' + sql)
    }, async () => ({
      query: vi.fn(async (sql: string, values: unknown[] = []) => {
        calls.push({ sql, values })
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: null }
        if (sql.includes('UPDATE membership_subscriptions SET plan_id')) return { rows: [{ subscription_id: subscription.subscription_id }], rowCount: 1 }
        if (sql.includes("UPDATE membership_subscription_plan_change_attempts SET status = 'APPLIED'")) return { rows: [{ attempt_id: attemptId }], rowCount: 1 }
        throw new Error('unexpected transaction SQL')
      }),
      release: vi.fn(),
    } as unknown as W07WebhookPostgresClient))
    const { env, auditFetch } = envFixture()

    const result = await fulfillPaidMembershipOrder(env, paymentId, merchantId, {
      getFinancePostgresPool: () => finance.pool,
      getMembershipPostgresPool: () => membership.pool,
    })

    expect(result).toEqual({ outcome: 'APPLIED', fulfilledCount: 1 })
    expect(calls.map((call) => call.sql)).toEqual(['BEGIN', expect.stringContaining('UPDATE membership_subscriptions SET plan_id'), expect.stringContaining("UPDATE membership_subscription_plan_change_attempts SET status = 'APPLIED'"), 'COMMIT'])
    expect(calls[1]?.sql).toContain('current_period_start = $11::timestamptz')
    expect(calls[2]?.sql).toContain('expires_at >= $15::timestamptz')
    expect(auditFetch).toHaveBeenCalledTimes(1)
    expect(auditFetch.mock.invocationCallOrder[0]).toBeGreaterThan(0)
  })

  it('rolls back the subscription CAS when the paired upgrade-attempt CAS loses', async () => {
    const change = {
      kind: 'PLAN_UPGRADE',
      attemptId,
      subscriberId,
      subscriptionId: 'sub_upgrade_01',
      expectedSubscriptionVersion: 4,
      expectedPlanId: previousPlanId,
      expectedPlanVersion: 1,
      targetPlanId,
      targetPlanVersion: 2,
      currentPeriodStart,
      currentPeriodEnd,
      expiresAt,
    }
    const offer = snapshot(change)
    const line = orderLine(offer, 300)
    const finance = nativePool(async (sql) => {
      if (sql.includes('FROM payments AS p')) return { rows: [paidOrder(300)], rowCount: 1 }
      if (sql.includes('FROM order_lines WHERE order_id = $1')) return { rows: [line], rowCount: 1 }
      throw new Error('unexpected finance query')
    })
    const attempt = {
      attempt_id: attemptId,
      subscriber_id: subscriberId,
      subscription_id: 'sub_upgrade_01',
      expected_subscription_version: 4,
      expected_plan_id: previousPlanId,
      expected_plan_version: 1,
      target_plan_id: targetPlanId,
      target_plan_version: 2,
      current_period_start: currentPeriodStart,
      current_period_end: currentPeriodEnd,
      order_id: orderId,
      status: 'PENDING_PAYMENT',
      expires_at: expiresAt,
      updated_at: attemptUpdatedAt,
    }
    const subscription = {
      subscription_id: 'sub_upgrade_01',
      subscriber_id: subscriberId,
      plan_id: previousPlanId,
      plan_version: 1,
      creator_id: creatorId,
      status: 'ACTIVE',
      current_period_start: currentPeriodStart,
      current_period_end: currentPeriodEnd,
      cancel_at: null,
      entitlement_snapshot_ref: 'commerce-order:original:line:original',
      updated_at: '2026-11-18T10:00:00.000Z',
      version: 4,
    }
    const transactionSql: string[] = []
    const membership = nativePool(async (sql) => {
      if (sql.includes('FROM membership_plans AS p')) return { rows: [planRow()], rowCount: 1 }
      if (sql.includes('FROM membership_subscription_plan_change_attempts WHERE attempt_id = $1 LIMIT 1')) return { rows: [attempt], rowCount: 1 }
      if (sql.includes('FROM membership_subscriptions WHERE subscription_id = $1 AND subscriber_id = $2 LIMIT 1')) return { rows: [subscription], rowCount: 1 }
      if (sql.includes("UPDATE membership_subscription_plan_change_attempts SET status = 'RECONCILIATION_REQUIRED'")) return { rows: [], rowCount: 1 }
      throw new Error('unexpected membership pool query')
    }, async () => ({
      query: vi.fn(async (sql: string) => {
        transactionSql.push(sql)
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [], rowCount: null }
        if (sql.includes('UPDATE membership_subscriptions SET plan_id')) return { rows: [{ subscription_id: subscription.subscription_id }], rowCount: 1 }
        if (sql.includes("UPDATE membership_subscription_plan_change_attempts SET status = 'APPLIED'")) return { rows: [], rowCount: 0 }
        throw new Error('unexpected transaction SQL')
      }),
      release: vi.fn(),
    } as unknown as W07WebhookPostgresClient))
    const { env, auditFetch } = envFixture()

    const result = await fulfillPaidMembershipOrder(env, paymentId, merchantId, {
      getFinancePostgresPool: () => finance.pool,
      getMembershipPostgresPool: () => membership.pool,
    })

    expect(result).toEqual({
      outcome: 'RECONCILIATION_REQUIRED',
      fulfilledCount: 0,
      reasonCode: 'UPGRADE_SUBSCRIPTION_CAS_LOST',
    })
    expect(transactionSql).toContain('ROLLBACK')
    expect(transactionSql).not.toContain('COMMIT')
    expect(auditFetch).not.toHaveBeenCalled()
  })
})
