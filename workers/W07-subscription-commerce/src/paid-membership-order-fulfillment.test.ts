import { describe, expect, it } from 'vitest';
import {
  fulfillPaidMembershipOrder,
  PaidMembershipPurchaseFulfillmentError,
} from './paid-membership-order-fulfillment.js';

type FakeState = {
  order: Record<string, unknown> | null;
  lines: Array<Record<string, unknown>>;
  plan: Record<string, unknown> | null;
  subscriptions: Map<string, Record<string, unknown>>;
  insertCount: number;
};

function fakeDb(kind: 'D1_01' | 'D1_04', state: FakeState): D1Database {
  return {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...args: unknown[]) { values = args; return statement; },
        async first<T>() {
          if (kind === 'D1_04' && sql.includes('FROM payments AS p')) {
            return (state.order ? { ...state.order } : null) as T | null;
          }
          if (kind === 'D1_04') return null;
          if (sql.includes('FROM membership_plans AS p')) {
            return (state.plan ? { ...state.plan } : null) as T | null;
          }
          if (sql.includes('FROM membership_subscriptions WHERE subscription_id = ?')) {
            const row = state.subscriptions.get(String(values[0]));
            return (row ? { ...row } : null) as T | null;
          }
          return null;
        },
        async all<T>() {
          if (kind === 'D1_04' && sql.includes('FROM order_lines WHERE order_id = ?')) {
            return { results: state.lines.map((line) => ({ ...line })) as T[] };
          }
          return { results: [] as T[] };
        },
        async run() {
          if (kind === 'D1_01' && sql.includes('INSERT INTO membership_subscriptions')) {
            const [
              subscriptionId, subscriberId, planId, planVersion, creatorId,
              periodStart, currentPeriodStart, periodEnd, entitlementSnapshotRef, createdAt, updatedAt,
            ] = values as [string, string, string, number, string, string, string, string, string, string, string];
            if (state.subscriptions.has(subscriptionId)) throw new Error('UNIQUE constraint failed');
            state.subscriptions.set(subscriptionId, {
              subscription_id: subscriptionId,
              subscriber_id: subscriberId,
              plan_id: planId,
              plan_version: planVersion,
              creator_id: creatorId,
              status: 'ACTIVE',
              started_at: periodStart,
              current_period_start: currentPeriodStart,
              current_period_end: periodEnd,
              cancel_at: null,
              entitlement_snapshot_ref: entitlementSnapshotRef,
              created_at: createdAt,
              updated_at: updatedAt,
            });
            state.insertCount += 1;
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
      };
      return statement as unknown as D1PreparedStatement;
    },
    async batch() { return []; },
  } as unknown as D1Database;
}

const planId = 'plan_' + 'a'.repeat(64);
const orderConfirmedAt = '2026-10-29T10:00:00.000Z';
const benefits = ['member-posts'];

function fixture(overrides: {
  order?: Partial<Record<string, unknown>>;
  line?: Partial<Record<string, unknown>>;
  plan?: Partial<Record<string, unknown>> | null;
  lines?: Array<Record<string, unknown>>;
} = {}) {
  const snapshot = {
    planId,
    planVersion: 1,
    creatorId: 'creator_1',
    name: 'Supporter',
    tier: 'supporter',
    billingInterval: 'MONTHLY',
    priceMinor: 500,
    currency: 'USD',
    benefits,
  };
  const baseLine = {
    order_line_id: 'line_01',
    item_type: 'MEMBERSHIP_PLAN',
    item_ref: planId,
    item_version: '1',
    quantity: 1,
    unit_amount_minor: 500,
    line_total_minor: 500,
    line_discount_minor: 0,
    item_snapshot_json: JSON.stringify(snapshot),
    ...overrides.line,
  };
  const state: FakeState = {
    order: {
      payment_id: 'pay_' + 'b'.repeat(26),
      order_id: 'ord_purchase_01',
      customer_id: 'user_1',
      provider: 'hyperswitch',
      merchant_id: 'merchant_1',
      payment_status: 'succeeded',
      amount_minor: 500,
      payment_currency: 'USD',
      order_status: 'CONFIRMED',
      order_currency: 'USD',
      total_minor: 500,
      confirmed_at: orderConfirmedAt,
      ...overrides.order,
    },
    lines: overrides.lines ?? [baseLine],
    plan: overrides.plan === null ? null : {
      plan_id: planId,
      owner_type: 'CREATOR',
      owner_id: 'creator_1',
      plan_version: 1,
      name: 'Supporter',
      tier: 'supporter',
      billing_interval: 'MONTHLY',
      price_minor: 500,
      currency: 'USD',
      benefits_json: JSON.stringify(benefits),
      ...overrides.plan,
    },
    subscriptions: new Map(),
    insertCount: 0,
  };
  const env = {
    D1_01: fakeDb('D1_01', state),
    D1_04: fakeDb('D1_04', state),
  };
  return { env, state };
}

describe('paid membership order fulfillment', () => {
  it('activates only the subscription tied to a confirmed, successful order and immutable plan snapshot', async () => {
    const f = fixture();
    const result = await fulfillPaidMembershipOrder(f.env, 'pay_' + 'b'.repeat(26), 'merchant_1');

    expect(result).toEqual({ outcome: 'APPLIED', fulfilledCount: 1 });
    expect(f.state.insertCount).toBe(1);
    const [row] = [...f.state.subscriptions.values()];
    expect(row).toMatchObject({
      subscriber_id: 'user_1',
      plan_id: planId,
      plan_version: 1,
      creator_id: 'creator_1',
      status: 'ACTIVE',
      started_at: orderConfirmedAt,
      current_period_start: orderConfirmedAt,
      current_period_end: '2026-11-29T10:00:00.000Z',
      entitlement_snapshot_ref: 'commerce-order:ord_purchase_01:line:line_01',
    });
  });

  it('replays the same paid order without duplicate subscriptions or reactivating a later cancellation', async () => {
    const f = fixture();
    const paymentId = 'pay_' + 'b'.repeat(26);
    await fulfillPaidMembershipOrder(f.env, paymentId, 'merchant_1');
    const [subscriptionId, row] = [...f.state.subscriptions.entries()][0]!;
    row.status = 'CANCELED';
    // Later renewal, cancellation, or plan change may have altered mutable
    // fields. Replaying the original purchase must converge without resetting
    // the current status, plan version or billing period.
    row.plan_id = 'plan_' + 'c'.repeat(64);
    row.plan_version = 2;
    row.current_period_start = '2026-11-29T10:00:00.000Z';
    row.current_period_end = '2026-12-29T10:00:00.000Z';

    const replay = await fulfillPaidMembershipOrder(f.env, paymentId, 'merchant_1');
    expect(replay).toEqual({ outcome: 'ALREADY_APPLIED', fulfilledCount: 1 });
    expect(f.state.insertCount).toBe(1);
    expect(f.state.subscriptions.get(subscriptionId)?.status).toBe('CANCELED');
  });

  it('fails closed for an unpaid or amount-mismatched order before touching D1-01', async () => {
    for (const order of [
      { payment_status: 'processing' },
      { amount_minor: 499 },
      { payment_currency: 'EUR' },
      { order_status: 'CANCELLED' },
      { order_status: 'PROCESSING' },
      { confirmed_at: null },
    ]) {
      const f = fixture({ order });
      await expect(
        fulfillPaidMembershipOrder(f.env, 'pay_' + 'b'.repeat(26), 'merchant_1'),
      ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
      expect(f.state.insertCount).toBe(0);
    }
  });

  it('does not activate against a changed or mismatched immutable membership offer', async () => {
    const cases = [
      fixture({ line: { item_version: '2' } }),
      fixture({ line: { unit_amount_minor: 700 } }),
      fixture({ plan: { price_minor: 700 } }),
      fixture({ plan: { owner_id: 'creator_2' } }),
      fixture({ plan: { benefits_json: '["other-benefit"]' } }),
      fixture({ line: { quantity: 2 } }),
      fixture({ line: { line_total_minor: 0 } }),
    ];
    for (const f of cases) {
      await expect(
        fulfillPaidMembershipOrder(f.env, 'pay_' + 'b'.repeat(26), 'merchant_1'),
      ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
      expect(f.state.insertCount).toBe(0);
    }
  });

  it('does not create a membership subscription for orders with no membership-plan lines', async () => {
    const f = fixture({
      line: { item_type: 'DIGITAL_GOOD' },
    });
    const result = await fulfillPaidMembershipOrder(f.env, 'pay_' + 'b'.repeat(26), 'merchant_1');

    expect(result).toEqual({ outcome: 'NOT_APPLICABLE', fulfilledCount: 0 });
    expect(f.state.insertCount).toBe(0);
  });

  it('does not partially fulfill a paid order containing a membership and another item family', async () => {
    const f = fixture({
      order: {
        amount_minor: 750,
        total_minor: 750,
      },
      lines: [
        {
          order_line_id: 'line_01',
          item_type: 'MEMBERSHIP_PLAN',
          item_ref: planId,
          item_version: '1',
          quantity: 1,
          unit_amount_minor: 500,
          line_total_minor: 500,
          item_snapshot_json: JSON.stringify({
            planId, planVersion: 1, creatorId: 'creator_1', name: 'Supporter',
            tier: 'supporter', billingInterval: 'MONTHLY', priceMinor: 500,
            currency: 'USD', benefits,
          }),
        },
        {
          order_line_id: 'line_02',
          item_type: 'DIGITAL_GOOD',
          item_ref: 'digital_good_1',
          item_version: '1',
          quantity: 1,
          unit_amount_minor: 250,
          line_total_minor: 250,
          item_snapshot_json: JSON.stringify({ itemId: 'digital_good_1' }),
        },
      ],
    });

    await expect(
      fulfillPaidMembershipOrder(f.env, 'pay_' + 'b'.repeat(26), 'merchant_1'),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    expect(f.state.insertCount).toBe(0);
  });

  it('does not partially fulfill an order with multiple membership lines', async () => {
    const f = fixture({ lines: [
      {
        order_line_id: 'line_01', item_type: 'MEMBERSHIP_PLAN', item_ref: planId, item_version: '1',
        quantity: 1, unit_amount_minor: 500, line_total_minor: 250,
        item_snapshot_json: JSON.stringify({ planId, planVersion: 1, creatorId: 'creator_1', name: 'Supporter', tier: 'supporter', billingInterval: 'MONTHLY', priceMinor: 500, currency: 'USD', benefits }),
      },
      {
        order_line_id: 'line_02', item_type: 'MEMBERSHIP_PLAN', item_ref: planId, item_version: '1',
        quantity: 1, unit_amount_minor: 500, line_total_minor: 250,
        item_snapshot_json: JSON.stringify({ planId, planVersion: 1, creatorId: 'creator_1', name: 'Supporter', tier: 'supporter', billingInterval: 'MONTHLY', priceMinor: 500, currency: 'USD', benefits }),
      },
    ] });

    await expect(
      fulfillPaidMembershipOrder(f.env, 'pay_' + 'b'.repeat(26), 'merchant_1'),
    ).rejects.toBeInstanceOf(PaidMembershipPurchaseFulfillmentError);
    expect(f.state.insertCount).toBe(0);
  });
  it('fails closed when a deterministic subscription lineage has a different creator identity', async () => {
    const f = fixture();
    const paymentId = 'pay_' + 'b'.repeat(26);
    await fulfillPaidMembershipOrder(f.env, paymentId, 'merchant_1');
    const [subscriptionId, row] = [...f.state.subscriptions.entries()][0]!;
    row.creator_id = 'creator_attacker';

    await expect(
      fulfillPaidMembershipOrder(f.env, paymentId, 'merchant_1'),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    expect(f.state.insertCount).toBe(1);
    expect(f.state.subscriptions.get(subscriptionId)?.creator_id).toBe('creator_attacker');
  });

});
