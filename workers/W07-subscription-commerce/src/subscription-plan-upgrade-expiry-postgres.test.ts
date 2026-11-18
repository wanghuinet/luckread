import { describe, expect, it, vi } from 'vitest';
import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js';
import { SubscriptionRuntimeError } from './subscription-runtime.js';
import { expirePendingSubscriptionPlanUpgradeForPaymentPostgres } from './subscription-plan-upgrade-expiry-postgres.js';

function poolWith(results: Array<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>) {
  const query = vi.fn(async () => results.shift() ?? { rows: [], rowCount: 0 });
  return { pool: { query, connect: vi.fn() } as unknown as W07WebhookPostgresPool, query };
}

const paymentId = 'pay_' + 'p'.repeat(26);
const merchantId = 'merchant_test';
const orderId = 'order_upgrade_test';
const attemptId = 'suca_' + 'a'.repeat(64);

describe('native PostgreSQL plan-upgrade payment expiry', () => {
  it('reads a terminal finance outcome and expires only its matching pending membership attempt', async () => {
    const finance = poolWith([
      { rows: [{ order_id: orderId, status: 'failed' }], rowCount: 1 },
      {
        rows: [{
          item_snapshot_json: JSON.stringify({
            subscriptionChange: { attemptId },
          }),
        }],
        rowCount: 1,
      },
    ]);
    const membership = poolWith([{ rows: [], rowCount: 1 }]);
    const now = new Date('2026-11-18T12:34:56.000Z');

    await expirePendingSubscriptionPlanUpgradeForPaymentPostgres(
      finance.pool, membership.pool, paymentId, merchantId, () => now,
    );

    expect(finance.query).toHaveBeenCalledTimes(2);
    expect(finance.query.mock.calls[0]).toEqual([
      expect.stringContaining('merchant_id = $1 AND payment_id = $2'),
      [merchantId, paymentId],
    ]);
    expect(finance.query.mock.calls[1]).toEqual([
      expect.stringContaining("item_type = 'MEMBERSHIP_PLAN' LIMIT 2"),
      [orderId],
    ]);
    expect(membership.query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'PENDING_PAYMENT'"),
      [now.toISOString(), attemptId, orderId],
    );
  });

  it('does not write membership state for successful or missing payments', async () => {
    const finance = poolWith([{ rows: [{ order_id: orderId, status: 'succeeded' }], rowCount: 1 }]);
    const membership = poolWith([]);

    await expirePendingSubscriptionPlanUpgradeForPaymentPostgres(
      finance.pool, membership.pool, paymentId, merchantId,
    );

    expect(finance.query).toHaveBeenCalledTimes(1);
    expect(membership.query).not.toHaveBeenCalled();
  });

  it('does not expire when the order has zero or multiple membership snapshots', async () => {
    const finance = poolWith([
      { rows: [{ order_id: orderId, status: 'cancelled' }], rowCount: 1 },
      { rows: [{ item_snapshot_json: '{}' }, { item_snapshot_json: '{}' }], rowCount: 2 },
    ]);
    const membership = poolWith([]);

    await expirePendingSubscriptionPlanUpgradeForPaymentPostgres(
      finance.pool, membership.pool, paymentId, merchantId,
    );

    expect(membership.query).not.toHaveBeenCalled();
  });

  it('rejects malformed identifiers and sanitizes PostgreSQL failures', async () => {
    const finance = poolWith([]);
    const membership = poolWith([]);

    await expect(expirePendingSubscriptionPlanUpgradeForPaymentPostgres(
      finance.pool, membership.pool, 'invalid', merchantId,
    )).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const broken = {
      query: vi.fn(async () => { throw new Error('database credentials leaked'); }),
      connect: vi.fn(),
    } as unknown as W07WebhookPostgresPool;
    await expect(expirePendingSubscriptionPlanUpgradeForPaymentPostgres(
      broken, membership.pool, paymentId, merchantId,
    )).rejects.toBeInstanceOf(SubscriptionRuntimeError);
    await expect(expirePendingSubscriptionPlanUpgradeForPaymentPostgres(
      broken, membership.pool, paymentId, merchantId,
    )).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
  });
});
