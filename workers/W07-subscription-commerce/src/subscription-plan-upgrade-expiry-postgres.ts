import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js';
import { SubscriptionRuntimeError } from './subscription-runtime.js';

const PAYMENT_ID_PATTERN = /^pay_[A-Za-z0-9]{26}$/;
const ATTEMPT_ID_PATTERN = /^suca_[a-f0-9]{64}$/;

function isBoundedText(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function failUnavailable(): never {
  throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
}

/**
 * Release one unpaid plan-upgrade attempt after its signed provider payment
 * has reached a terminal failure state. Finance facts stay in D1-04; only the
 * matching membership reservation is updated in D1-01. The update is an
 * idempotent compare-and-set and does not span a cross-database transaction.
 */
export async function expirePendingSubscriptionPlanUpgradeForPaymentPostgres(
  financePool: W07WebhookPostgresPool,
  membershipPool: W07WebhookPostgresPool,
  paymentId: string,
  merchantId: string,
  now: () => Date = () => new Date(),
): Promise<void> {
  if (!PAYMENT_ID_PATTERN.test(paymentId) || !isBoundedText(merchantId)) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
  }

  let payment: { order_id: string; status: string } | undefined;
  try {
    const result = await financePool.query<{ order_id: string; status: string }>(
      "SELECT order_id, status FROM payments WHERE provider = 'hyperswitch' AND merchant_id = $1 AND payment_id = $2 LIMIT 1",
      [merchantId, paymentId],
    );
    payment = result.rows[0];
  } catch {
    failUnavailable();
  }

  if (!payment || !isBoundedText(payment.order_id, 255) ||
      !['failed', 'cancelled', 'expired'].includes(payment.status)) return;

  let lines: Array<{ item_snapshot_json: string }>;
  try {
    const result = await financePool.query<{ item_snapshot_json: string }>(
      "SELECT item_snapshot_json FROM order_lines WHERE order_id = $1 AND item_type = 'MEMBERSHIP_PLAN' LIMIT 2",
      [payment.order_id],
    );
    lines = result.rows;
  } catch {
    failUnavailable();
  }
  if (lines.length !== 1 || typeof lines[0]?.item_snapshot_json !== 'string') return;

  let snapshot: unknown;
  try {
    snapshot = JSON.parse(lines[0].item_snapshot_json) as unknown;
  } catch {
    failUnavailable();
  }
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return;
  const change = (snapshot as Record<string, unknown>).subscriptionChange;
  if (!change || typeof change !== 'object' || Array.isArray(change)) return;
  const attemptId = (change as Record<string, unknown>).attemptId;
  if (typeof attemptId !== 'string' || !ATTEMPT_ID_PATTERN.test(attemptId)) return;

  const updatedAt = now().toISOString();
  try {
    await membershipPool.query(
      "UPDATE membership_subscription_plan_change_attempts SET status = 'EXPIRED', updated_at = $1::timestamptz, version = version + 1 WHERE attempt_id = $2 AND order_id = $3 AND status = 'PENDING_PAYMENT'",
      [updatedAt, attemptId, payment.order_id],
    );
  } catch {
    failUnavailable();
  }
}
