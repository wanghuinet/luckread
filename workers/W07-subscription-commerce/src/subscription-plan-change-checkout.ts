/// <reference types="@cloudflare/workers-types" />

import { sha256BytesToHex } from '../../W10-async/src/canonical-json-idempotency.js';
import {
  createCommerceOrder,
  getCommerceOrder,
  OrderPersistenceError,
  type AuthoritativelyPricedOrder,
  type CommerceOrderData,
} from './order-persistence.js';
import { issueInvoiceForOrder } from './billing-persistence.js';
import {
  etagForVersion,
  SubscriptionRuntimeError,
  validateIfMatch,
  validateIdempotencyKey,
  validatePrincipal,
} from './subscription-runtime.js';
import {
  previewSubscriptionPlanChange,
  type SubscriptionPlanChangePreview,
} from './subscription-plan-change-preview.js';
import { hasPendingScheduledPlanDowngrade } from './subscription-plan-change-schedule.js';

type PlanChangeAttemptRow = Readonly<{
  attempt_id: string;
  subscriber_id: string;
  subscription_id: string;
  expected_subscription_version: number;
  expected_plan_id: string;
  expected_plan_version: number;
  target_plan_id: string;
  target_plan_version: number;
  current_period_start: string;
  current_period_end: string;
  idempotency_key_hash: string;
  order_id: string | null;
  status: 'PENDING_PAYMENT' | 'APPLIED' | 'EXPIRED' | 'RECONCILIATION_REQUIRED';
  expires_at: string;
  applied_at: string | null;
  applied_subscription_version: number | null;
  created_at: string;
  updated_at: string;
  version: number;
}>;

export type SubscriptionPlanUpgradeAttempt = Readonly<{
  attemptId: string;
  subscriberId: string;
  subscriptionId: string;
  expectedSubscriptionVersion: number;
  expectedPlanId: string;
  expectedPlanVersion: number;
  targetPlanId: string;
  targetPlanVersion: number;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  orderId: string | null;
  expiresAt: string;
}>;

export type SubscriptionPlanUpgradePricingContext = Readonly<{
  preview: SubscriptionPlanChangePreview;
  attempt: SubscriptionPlanUpgradeAttempt;
}>;

export type SubscriptionPlanUpgradeCheckoutResult = Readonly<{
  attemptId: string;
  subscriptionId: string;
  status: 'PENDING_PAYMENT' | 'APPLIED';
  order: CommerceOrderData;
  proration: Readonly<{
    amountMinor: number;
    currency: string;
    basis: 'LIST_PRICE_DIFFERENCE_BEFORE_DISCOUNTS_AND_TAX';
    pricingFinalized: true;
  }>;
  effectiveAt: string | null;
  expiresAt: string;
  replayed: boolean;
}>;

export type SubscriptionPlanUpgradeCheckoutEnv = Readonly<{
  D1_01: D1Database;
  D1_04: D1Database;
}>;

export type SubscriptionPlanUpgradeCheckoutDependencies = Readonly<{
  now?: () => Date;
  resolvePricing: (context: SubscriptionPlanUpgradePricingContext) => Promise<AuthoritativelyPricedOrder>;
  createOrder?: typeof createCommerceOrder;
  getOrder?: typeof getCommerceOrder;
  issueInvoice?: typeof issueInvoiceForOrder;
}>;

const PLAN_ID_PATTERN = /^plan_[a-f0-9]{64}$/;
const ATTEMPT_ID_PATTERN = /^suca_[a-f0-9]{64}$/;
const MAX_ID = 256;
const CHECKOUT_TTL_MS = 60 * 60 * 1000;
const MIN_REMAINING_TTL_MS = 60 * 1000;

function isBoundedText(value: unknown, max = MAX_ID): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function isCanonicalUtc(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function validateUpgradeRequest(input: unknown): string {
  if (!isRecord(input) || Object.keys(input).length !== 1 ||
      !Object.prototype.hasOwnProperty.call(input, 'planId') ||
      typeof input.planId !== 'string' || !PLAN_ID_PATTERN.test(input.planId)) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
  }
  return input.planId;
}

function toAttempt(row: PlanChangeAttemptRow): SubscriptionPlanUpgradeAttempt {
  if (!ATTEMPT_ID_PATTERN.test(row.attempt_id) ||
      !isBoundedText(row.subscriber_id) || !isBoundedText(row.subscription_id) ||
      !Number.isSafeInteger(row.expected_subscription_version) || row.expected_subscription_version < 1 ||
      !isBoundedText(row.expected_plan_id) || !Number.isSafeInteger(row.expected_plan_version) || row.expected_plan_version < 1 ||
      !PLAN_ID_PATTERN.test(row.target_plan_id) || !Number.isSafeInteger(row.target_plan_version) || row.target_plan_version < 1 ||
      !isCanonicalUtc(row.current_period_start) || !isCanonicalUtc(row.current_period_end) ||
      !/^[a-f0-9]{64}$/.test(row.idempotency_key_hash) ||
      !(row.order_id === null || isBoundedText(row.order_id, 255)) ||
      !isCanonicalUtc(row.expires_at) || !isCanonicalUtc(row.created_at) || !isCanonicalUtc(row.updated_at) ||
      !Number.isSafeInteger(row.version) || row.version < 1 ||
      !(row.applied_at === null || isCanonicalUtc(row.applied_at)) ||
      !(row.applied_subscription_version === null ||
        (Number.isSafeInteger(row.applied_subscription_version) && row.applied_subscription_version > 0)) ||
      row.current_period_end <= row.current_period_start) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  return {
    attemptId: row.attempt_id,
    subscriberId: row.subscriber_id,
    subscriptionId: row.subscription_id,
    expectedSubscriptionVersion: row.expected_subscription_version,
    expectedPlanId: row.expected_plan_id,
    expectedPlanVersion: row.expected_plan_version,
    targetPlanId: row.target_plan_id,
    targetPlanVersion: row.target_plan_version,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    orderId: row.order_id,
    expiresAt: row.expires_at,
  };
}

async function readAttemptByIdempotency(
  db: D1Database,
  subscriberId: string,
  keyHash: string,
): Promise<PlanChangeAttemptRow | null> {
  try {
    return await db.prepare(
      'SELECT attempt_id, subscriber_id, subscription_id, expected_subscription_version, ' +
      'expected_plan_id, expected_plan_version, target_plan_id, target_plan_version, ' +
      'current_period_start, current_period_end, idempotency_key_hash, order_id, status, ' +
      'expires_at, applied_at, applied_subscription_version, created_at, updated_at, version ' +
      'FROM membership_subscription_plan_change_attempts ' +
      'WHERE subscriber_id = ? AND idempotency_key_hash = ? LIMIT 1',
    ).bind(subscriberId, keyHash).first<PlanChangeAttemptRow>();
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
}

async function readAttemptById(db: D1Database, attemptId: string): Promise<PlanChangeAttemptRow | null> {
  try {
    return await db.prepare(
      'SELECT attempt_id, subscriber_id, subscription_id, expected_subscription_version, ' +
      'expected_plan_id, expected_plan_version, target_plan_id, target_plan_version, ' +
      'current_period_start, current_period_end, idempotency_key_hash, order_id, status, ' +
      'expires_at, applied_at, applied_subscription_version, created_at, updated_at, version ' +
      'FROM membership_subscription_plan_change_attempts WHERE attempt_id = ? LIMIT 1',
    ).bind(attemptId).first<PlanChangeAttemptRow>();
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
}

async function expireAttempt(db: D1Database, row: PlanChangeAttemptRow, now: string): Promise<void> {
  try {
    await db.prepare(
      "UPDATE membership_subscription_plan_change_attempts SET status = 'EXPIRED', updated_at = ?, " +
      'version = version + 1 WHERE attempt_id = ? AND status = ? AND version = ?',
    ).bind(now, row.attempt_id, row.status, row.version).run();
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
}

async function expireStalePendingAttempts(
  db: D1Database,
  subscriptionId: string,
  now: string,
): Promise<void> {
  try {
    await db.prepare(
      "UPDATE membership_subscription_plan_change_attempts SET status = 'EXPIRED', updated_at = ?, " +
      "version = version + 1 WHERE subscription_id = ? AND status = 'PENDING_PAYMENT' AND expires_at <= ?",
    ).bind(now, subscriptionId, now).run();
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
}

function assertAttemptMatches(
  row: PlanChangeAttemptRow,
  subscriberId: string,
  subscriptionId: string,
  targetPlanId: string,
): void {
  if (row.subscriber_id !== subscriberId || row.subscription_id !== subscriptionId ||
      row.target_plan_id !== targetPlanId) {
    throw new SubscriptionRuntimeError('CONFLICT', 409);
  }
}

function assertAttemptMatchesPreview(
  row: PlanChangeAttemptRow,
  preview: SubscriptionPlanChangePreview,
): void {
  if (row.expected_subscription_version !== Number(preview.etag.match(/^"lr-v([1-9]\d*)"$/)?.[1]) ||
      row.expected_plan_id !== preview.currentPlan.planId ||
      row.expected_plan_version !== preview.currentPlan.planVersion ||
      row.target_plan_id !== preview.targetPlan.planId ||
      row.target_plan_version !== preview.targetPlan.planVersion ||
      row.current_period_start !== preview.currentPeriodStart ||
      row.current_period_end !== preview.currentPeriodEnd) {
    throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412);
  }
}

function toCheckoutResult(
  attempt: PlanChangeAttemptRow,
  order: CommerceOrderData,
  replayed: boolean,
): SubscriptionPlanUpgradeCheckoutResult {
  if (!attempt.order_id || order.orderId !== attempt.order_id ||
      order.items.length !== 1 || order.items[0]?.itemRef !== attempt.target_plan_id ||
      order.items[0]?.quantity !== 1 || !Number.isSafeInteger(order.items[0]?.unitAmountMinor) ||
      order.items[0]!.unitAmountMinor <= 0) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  const status = attempt.status === 'APPLIED' ? 'APPLIED' : 'PENDING_PAYMENT';
  return {
    attemptId: attempt.attempt_id,
    subscriptionId: attempt.subscription_id,
    status,
    order,
    proration: {
      amountMinor: order.items[0]!.unitAmountMinor,
      currency: order.currency,
      basis: 'LIST_PRICE_DIFFERENCE_BEFORE_DISCOUNTS_AND_TAX',
      pricingFinalized: true,
    },
    effectiveAt: attempt.applied_at,
    expiresAt: attempt.expires_at,
    replayed,
  };
}

async function createOrReadOrder(
  env: SubscriptionPlanUpgradeCheckoutEnv,
  subscriberId: string,
  row: PlanChangeAttemptRow,
  preview: SubscriptionPlanChangePreview,
  dependencies: SubscriptionPlanUpgradeCheckoutDependencies,
  replayed: boolean,
): Promise<SubscriptionPlanUpgradeCheckoutResult> {
  const attempt = toAttempt(row);
  let order: CommerceOrderData;
  try {
    if (row.order_id) {
      order = await (dependencies.getOrder ?? getCommerceOrder)(env.D1_04, subscriberId, row.order_id);
    } else {
      const orderKey = 'plan-upgrade-' + row.attempt_id;
      const created = await (dependencies.createOrder ?? createCommerceOrder)(
        env.D1_04,
        subscriberId,
        orderKey,
        { items: [{ itemRef: row.target_plan_id, quantity: 1 }] },
        async () => dependencies.resolvePricing({ preview, attempt }),
      );
      order = created.data;
      const updatedAt = new Date().toISOString();
      try {
        const saved = await env.D1_01.prepare(
          'UPDATE membership_subscription_plan_change_attempts SET order_id = ?, updated_at = ?, ' +
          'version = version + 1 WHERE attempt_id = ? AND status = ? AND ' +
          '(order_id IS NULL OR order_id = ?)',
        ).bind(order.orderId, updatedAt, row.attempt_id, 'PENDING_PAYMENT', order.orderId).run();
        if (Number(saved.meta?.changes ?? 0) !== 1) {
          const latest = await readAttemptById(env.D1_01, row.attempt_id);
          if (!latest || latest.order_id !== order.orderId) {
            throw new SubscriptionRuntimeError('CONFLICT', 409);
          }
          row = latest;
        } else {
          const latest = await readAttemptById(env.D1_01, row.attempt_id);
          if (!latest) throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
          row = latest;
        }
      } catch (error) {
        if (error instanceof SubscriptionRuntimeError) throw error;
        throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
      }
    }

    const issueInvoice = dependencies.issueInvoice ?? issueInvoiceForOrder;
    await issueInvoice(env.D1_04, subscriberId, order.orderId);
  } catch (error) {
    if (error instanceof SubscriptionRuntimeError) throw error;
    if (error instanceof OrderPersistenceError) {
      if (error.code === 'RESOURCE_NOT_FOUND') throw new SubscriptionRuntimeError('RESOURCE_NOT_FOUND', 404);
      if (error.code === 'VALIDATION_FAILED') throw new SubscriptionRuntimeError('VALIDATION_FAILED', error.status);
      if (error.code === 'CONFLICT' || error.code === 'IDEMPOTENCY_KEY_REUSE_CONFLICT' ||
          error.code === 'IDEMPOTENCY_IN_PROGRESS') throw new SubscriptionRuntimeError('CONFLICT', 409);
    }
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }

  const latest = row.order_id ? row : await readAttemptById(env.D1_01, row.attempt_id);
  if (!latest || latest.order_id !== order.orderId) throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  return toCheckoutResult(latest, order, replayed);
}

/**
 * Creates an authoritative, prorated upgrade Order without mutating the Subscription.
 * Access changes only from the signed Hyperswitch success-webhook fulfillment path.
 * Financial facts remain in D1-04; D1-01 stores only the lifecycle reservation and
 * an opaque D1-04 order reference.
 */
export async function createSubscriptionPlanUpgradeCheckout(
  env: SubscriptionPlanUpgradeCheckoutEnv,
  subscriberIdInput: string,
  subscriptionIdInput: string,
  input: unknown,
  idempotencyKeyInput: string | null,
  ifMatchInput: string | null,
  dependencies: SubscriptionPlanUpgradeCheckoutDependencies,
): Promise<SubscriptionPlanUpgradeCheckoutResult> {
  const subscriberId = validatePrincipal(subscriberIdInput);
  const subscriptionId = subscriptionIdInput.trim();
  if (!isBoundedText(subscriptionId)) throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
  const targetPlanId = validateUpgradeRequest(input);
  const idempotencyKey = validateIdempotencyKey(idempotencyKeyInput);
  const ifMatch = validateIfMatch(ifMatchInput);

  const keyDigest = await sha256BytesToHex(
    new TextEncoder().encode('membership-plan-upgrade-v1\u0000' + subscriberId + '\u0000' + idempotencyKey),
  ).catch(() => { throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503); });
  const attemptId = 'suca_' + keyDigest;
  const nowDate = (dependencies.now ?? (() => new Date()))();
  if (!(nowDate instanceof Date) || !Number.isFinite(nowDate.getTime())) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  const now = nowDate.toISOString();
  if (await hasPendingScheduledPlanDowngrade(env.D1_01, subscriptionId)) {
    throw new SubscriptionRuntimeError('CONFLICT', 409);
  }

  let attemptRow = await readAttemptByIdempotency(env.D1_01, subscriberId, keyDigest);
  const replayedAttempt = attemptRow !== null
  if (attemptRow) {
    assertAttemptMatches(attemptRow, subscriberId, subscriptionId, targetPlanId);
    if (ifMatch !== etagForVersion(attemptRow.expected_subscription_version)) {
      throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412);
    }
    if (attemptRow.status === 'EXPIRED' || attemptRow.status === 'RECONCILIATION_REQUIRED') {
      throw new SubscriptionRuntimeError('CONFLICT', 409);
    }
    if (attemptRow.status === 'PENDING_PAYMENT' && attemptRow.expires_at <= now) {
      await expireAttempt(env.D1_01, attemptRow, now);
      throw new SubscriptionRuntimeError('CONFLICT', 409);
    }
    if (attemptRow.order_id) {
      if (attemptRow.status === 'PENDING_PAYMENT') {
        const order = await (dependencies.getOrder ?? getCommerceOrder)(env.D1_04, subscriberId, attemptRow.order_id)
          .catch(() => { throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503); });
        if (order.status === 'FAILED' || order.status === 'CANCELLED') {
          await expireAttempt(env.D1_01, attemptRow, now);
          throw new SubscriptionRuntimeError('CONFLICT', 409);
        }
        const invoice = dependencies.issueInvoice ?? issueInvoiceForOrder;
        await invoice(env.D1_04, subscriberId, order.orderId).catch(() => {
          throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
        });
        return toCheckoutResult(attemptRow, order, true);
      }
      const order = await (dependencies.getOrder ?? getCommerceOrder)(env.D1_04, subscriberId, attemptRow.order_id)
        .catch(() => { throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503); });
      return toCheckoutResult(attemptRow, order, true);
    }
  }

  const preview = await previewSubscriptionPlanChange(
    env.D1_01, subscriberId, subscriptionId, targetPlanId, { now: () => nowDate },
  );
  if (preview.changeType !== 'UPGRADE' || !preview.paymentRequired || preview.prorationBaseMinor <= 0) {
    throw new SubscriptionRuntimeError('INVALID_STATE', 409);
  }
  if (ifMatch !== preview.etag) throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412);
  if (attemptRow) assertAttemptMatchesPreview(attemptRow, preview);

  const expiresAtMs = Math.min(nowDate.getTime() + CHECKOUT_TTL_MS, Date.parse(preview.currentPeriodEnd));
  if (!Number.isFinite(expiresAtMs) || expiresAtMs - nowDate.getTime() < MIN_REMAINING_TTL_MS) {
    throw new SubscriptionRuntimeError('INVALID_STATE', 409);
  }
  const expiresAt = new Date(expiresAtMs).toISOString();
  const candidate: PlanChangeAttemptRow = attemptRow ?? {
    attempt_id: attemptId,
    subscriber_id: subscriberId,
    subscription_id: subscriptionId,
    expected_subscription_version: Number(preview.etag.match(/^"lr-v([1-9]\d*)"$/)?.[1]),
    expected_plan_id: preview.currentPlan.planId,
    expected_plan_version: preview.currentPlan.planVersion,
    target_plan_id: preview.targetPlan.planId,
    target_plan_version: preview.targetPlan.planVersion,
    current_period_start: preview.currentPeriodStart,
    current_period_end: preview.currentPeriodEnd,
    idempotency_key_hash: keyDigest,
    order_id: null,
    status: 'PENDING_PAYMENT',
    expires_at: expiresAt,
    applied_at: null,
    applied_subscription_version: null,
    created_at: now,
    updated_at: now,
    version: 1,
  };
  const pricing = await dependencies.resolvePricing({
    preview,
    attempt: toAttempt(candidate),
  });

  if (!attemptRow) {
    await expireStalePendingAttempts(env.D1_01, subscriptionId, now);
    try {
      const insertValues = [
        candidate.attempt_id, candidate.subscriber_id, candidate.subscription_id,
        candidate.expected_subscription_version, candidate.expected_plan_id, candidate.expected_plan_version,
        candidate.target_plan_id, candidate.target_plan_version, candidate.current_period_start,
        candidate.current_period_end, candidate.idempotency_key_hash, candidate.expires_at,
        candidate.created_at, candidate.updated_at,
        candidate.subscription_id, candidate.subscriber_id, candidate.expected_subscription_version,
        candidate.expected_plan_id, candidate.expected_plan_version, candidate.current_period_start,
        candidate.current_period_end, candidate.target_plan_id, candidate.subscription_id, candidate.subscriber_id,
        candidate.target_plan_version,
      ];
      const insertSql =
        'INSERT INTO membership_subscription_plan_change_attempts ' +
        '(attempt_id, subscriber_id, subscription_id, expected_subscription_version, expected_plan_id, ' +
        'expected_plan_version, target_plan_id, target_plan_version, current_period_start, current_period_end, ' +
        'idempotency_key_hash, order_id, status, expires_at, applied_at, applied_subscription_version, ' +
        'created_at, updated_at, version) ' +
        "SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'PENDING_PAYMENT', ?, NULL, NULL, ?, ?, 1 " +
        'WHERE EXISTS (SELECT 1 FROM membership_subscriptions WHERE subscription_id = ? AND subscriber_id = ? ' +
        "AND status = 'ACTIVE' AND cancel_at IS NULL AND version = ? AND plan_id = ? AND plan_version = ? " +
        'AND current_period_start = ? AND current_period_end = ?) ' +
        'AND EXISTS (SELECT 1 FROM membership_plans WHERE plan_id = ? AND owner_type = \'CREATOR\' ' +
        'AND owner_id = (SELECT creator_id FROM membership_subscriptions WHERE subscription_id = ? AND subscriber_id = ?) ' +
        "AND current_version = ? AND status = 'ACTIVE' AND visibility = 'PUBLIC')";
      const guardedInsertSql = insertSql +
        " AND NOT EXISTS (SELECT 1 FROM membership_subscription_scheduled_plan_changes " +
        "WHERE subscription_id = ? AND status IN ('SCHEDULED', 'RECONCILIATION_REQUIRED'))";
      let inserted: D1Result;
      try {
        inserted = await env.D1_01.prepare(guardedInsertSql).bind(...insertValues, candidate.subscription_id).run();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Before migration 0006 no downgrade record can exist; preserve the #1446 upgrade path.
        if (!/no such table:\\s*membership_subscription_scheduled_plan_changes/i.test(message)) throw error;
        inserted = await env.D1_01.prepare(insertSql).bind(...insertValues).run();
      }
      if (Number(inserted.meta?.changes ?? 0) !== 1) {
        const raced = await readAttemptByIdempotency(env.D1_01, subscriberId, keyDigest);
        if (raced) {
          assertAttemptMatches(raced, subscriberId, subscriptionId, targetPlanId);
          throw new SubscriptionRuntimeError('CONFLICT', 409);
        }
        if (await hasPendingScheduledPlanDowngrade(env.D1_01, subscriptionId)) {
          throw new SubscriptionRuntimeError('CONFLICT', 409);
        }
        throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412);
      }
      attemptRow = await readAttemptById(env.D1_01, attemptId);
      if (!attemptRow) throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
    } catch (error) {
      if (error instanceof SubscriptionRuntimeError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (/unique/i.test(message)) {
        const sameKey = await readAttemptByIdempotency(env.D1_01, subscriberId, keyDigest);
        if (sameKey) assertAttemptMatches(sameKey, subscriberId, subscriptionId, targetPlanId);
        throw new SubscriptionRuntimeError('CONFLICT', 409);
      }
      throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
    }
  }

  return createOrReadOrder(env, subscriberId, attemptRow, preview, {
    ...dependencies,
    resolvePricing: async () => pricing,
  }, replayedAttempt || Boolean(attemptRow.order_id));
}

/**
 * Signed failed/cancelled Hyperswitch outcomes release only the matching unpaid
 * upgrade reservation. Payment state is read from D1-04 after the webhook write;
 * no caller-supplied status can expire a subscription change.
 */
export async function expirePendingSubscriptionPlanUpgradeForPayment(
  env: SubscriptionPlanUpgradeCheckoutEnv,
  paymentId: string,
  merchantId: string,
): Promise<void> {
  if (!/^pay_[A-Za-z0-9]{26}$/.test(paymentId) || !isBoundedText(merchantId)) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
  }
  let payment: { order_id: string; status: string } | null;
  try {
    payment = await env.D1_04.prepare(
      "SELECT order_id, status FROM payments WHERE provider = 'hyperswitch' AND merchant_id = ? AND payment_id = ? LIMIT 1",
    ).bind(merchantId, paymentId).first<{ order_id: string; status: string }>();
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  if (!payment || !isBoundedText(payment.order_id, 255) ||
      !['failed', 'cancelled', 'expired'].includes(payment.status)) return;
  let lines: { item_snapshot_json: string }[]
  try {
    const result = await env.D1_04.prepare(
      "SELECT item_snapshot_json FROM order_lines WHERE order_id = ? AND item_type = 'MEMBERSHIP_PLAN' LIMIT 2",
    ).bind(payment.order_id).all<{ item_snapshot_json: string }>()
    lines = result.results ?? []
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  if (lines.length !== 1) return
  let snapshot: unknown
  try {
    snapshot = JSON.parse(lines[0]!.item_snapshot_json) as unknown
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return
  const change = (snapshot as Record<string, unknown>).subscriptionChange
  if (!change || typeof change !== 'object' || Array.isArray(change)) return
  const attemptId = (change as Record<string, unknown>).attemptId
  if (typeof attemptId !== 'string' || !ATTEMPT_ID_PATTERN.test(attemptId)) return
  const now = new Date().toISOString()
  try {
    await env.D1_01.prepare(
      "UPDATE membership_subscription_plan_change_attempts SET status = 'EXPIRED', updated_at = ?, " +
      "version = version + 1 WHERE attempt_id = ? AND order_id = ? AND status = 'PENDING_PAYMENT'",
    ).bind(now, attemptId, payment.order_id).run()
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
}
