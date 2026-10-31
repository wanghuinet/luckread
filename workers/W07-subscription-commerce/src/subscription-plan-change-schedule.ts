/// <reference types="@cloudflare/workers-types" />

import { sha256BytesToHex } from '../../W10-async/src/canonical-json-idempotency.js';
import { quoteSubscriptionPlanChange } from './subscription-plan-change-quote.js';
import {
  SubscriptionRuntimeError,
  validateIdempotencyKey,
  validatePrincipal,
} from './subscription-runtime.js';

type Env = Readonly<{ D1_01: D1Database; D1_04: D1Database }>;

type ScheduledPlanChangeReceipt = Readonly<{
  change_request_id: string;
  subscription_id: string;
  subscriber_id: string;
  source_subscription_version: number;
  scheduled_subscription_version: number;
  source_plan_id: string;
  source_plan_version: number;
  target_plan_id: string;
  target_plan_version: number;
  current_period_start: string;
  current_period_end: string;
  effective_at: string;
  scheduled_at: string;
}>;

type SubscriptionScheduleRow = Readonly<{
  subscription_id: string;
  subscriber_id: string;
  plan_id: string;
  plan_version: number;
  creator_id: string | null;
  status: string;
  current_period_start: string;
  current_period_end: string;
  cancel_at: string | null;
  version: number;
  pending_plan_id: string | null;
  pending_plan_version: number | null;
  pending_plan_effective_at: string | null;
  pending_plan_change_id: string | null;
}>;

function isCanonicalIso(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function expectedVersion(value: string): number {
  const match = /^"lr-v([1-9]\d*)"$/.exec(value.trim());
  if (!match?.[1]) throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412);
  const version = Number(match[1]);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412);
  }
  return version;
}

function responseFromReceipt(receipt: ScheduledPlanChangeReceipt, replayed: boolean) {
  return {
    status: 'SCHEDULED' as const,
    changeRequestId: receipt.change_request_id,
    replayed,
    subscriptionId: receipt.subscription_id,
    sourceSubscriptionVersion: receipt.source_subscription_version,
    scheduledSubscriptionVersion: receipt.scheduled_subscription_version,
    sourcePlan: { planId: receipt.source_plan_id, planVersion: receipt.source_plan_version },
    targetPlan: { planId: receipt.target_plan_id, planVersion: receipt.target_plan_version },
    currentPeriodStart: receipt.current_period_start,
    currentPeriodEnd: receipt.current_period_end,
    effectiveAt: receipt.effective_at,
    scheduledAt: receipt.scheduled_at,
    mutationPerformed: !replayed,
    entitlementChanged: false,
  };
}

function validReceipt(receipt: ScheduledPlanChangeReceipt): boolean {
  return /^sps_[a-f0-9]{60}$/.test(receipt.change_request_id) &&
    receipt.scheduled_subscription_version === receipt.source_subscription_version + 1 &&
    Number.isSafeInteger(receipt.source_subscription_version) && receipt.source_subscription_version > 0 &&
    Number.isSafeInteger(receipt.target_plan_version) && receipt.target_plan_version > 0 &&
    Number.isSafeInteger(receipt.source_plan_version) && receipt.source_plan_version > 0 &&
    isCanonicalIso(receipt.current_period_start) &&
    isCanonicalIso(receipt.current_period_end) &&
    receipt.current_period_end > receipt.current_period_start &&
    receipt.effective_at === receipt.current_period_end &&
    isCanonicalIso(receipt.scheduled_at);
}

/**
 * Persist one period-end downgrade schedule in the existing D1-01 Subscription
 * authority. A bounded immutable receipt makes retries and the W06 audit relay
 * replay-safe; it is not a second subscription or entitlement authority.
 */
export async function scheduleSubscriptionPlanDowngrade(
  env: Env,
  subscriberIdInput: string,
  input: Readonly<{
    subscriptionId: string;
    planId: string;
    ifMatch: string;
    idempotencyKey: string;
    actorLayer: string;
    now?: Date;
  }>,
): Promise<Readonly<Record<string, unknown>>> {
  const subscriberId = validatePrincipal(subscriberIdInput);
  const subscriptionId = input.subscriptionId;
  const targetPlanId = input.planId;
  if (typeof subscriptionId !== 'string' || !subscriptionId.trim() ||
      subscriptionId.length > 256 || subscriptionId.trim() !== subscriptionId ||
      /[\u0000-\u001f\u007f]/.test(subscriptionId) ||
      !/^plan_[a-f0-9]{64}$/.test(targetPlanId)) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
  }
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  if (/[\u0000-\u001f\u007f]/.test(idempotencyKey) ||
      !/^L[2-8]$/.test(input.actorLayer)) {
    throw new SubscriptionRuntimeError('PERMISSION_DENIED', 403);
  }
  const sourceVersion = expectedVersion(input.ifMatch);
  const changeDigest = await sha256BytesToHex(new TextEncoder().encode(
    'subscription-scheduled-plan-change-v1\u0000' + subscriberId + '\u0000' +
    subscriptionId + '\u0000' + String(sourceVersion) + '\u0000' +
    targetPlanId + '\u0000' + idempotencyKey,
  ));
  const changeRequestId = 'sps_' + changeDigest.slice(0, 60);

  let existingReceipt: ScheduledPlanChangeReceipt | null;
  try {
    existingReceipt = await env.D1_01.prepare(
      'SELECT * FROM membership_subscription_scheduled_plan_change_receipts WHERE change_request_id = ? LIMIT 1',
    ).bind(changeRequestId).first<ScheduledPlanChangeReceipt>();
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  if (existingReceipt) {
    if (!validReceipt(existingReceipt) || existingReceipt.subscriber_id !== subscriberId ||
        existingReceipt.subscription_id !== subscriptionId ||
        existingReceipt.target_plan_id !== targetPlanId ||
        existingReceipt.source_subscription_version !== sourceVersion) {
      throw new SubscriptionRuntimeError('CONFLICT', 409);
    }
    return responseFromReceipt(existingReceipt, true);
  }

  const now = input.now ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
  }
  const nowIso = now.toISOString();
  let subscription: SubscriptionScheduleRow | null;
  try {
    subscription = await env.D1_01.prepare(
      'SELECT subscription_id, subscriber_id, plan_id, plan_version, creator_id, status, ' +
      'current_period_start, current_period_end, cancel_at, version, pending_plan_id, ' +
      'pending_plan_version, pending_plan_effective_at, pending_plan_change_id ' +
      'FROM membership_subscriptions WHERE subscription_id = ? AND subscriber_id = ? LIMIT 1',
    ).bind(subscriptionId, subscriberId).first<SubscriptionScheduleRow>();
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  if (!subscription) throw new SubscriptionRuntimeError('RESOURCE_NOT_FOUND', 404);
  if (subscription.version !== sourceVersion) {
    throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412);
  }
  if (subscription.status !== 'ACTIVE' || subscription.cancel_at !== null ||
      subscription.pending_plan_id !== null || !subscription.creator_id ||
      !isCanonicalIso(subscription.current_period_start) ||
      !isCanonicalIso(subscription.current_period_end) ||
      subscription.current_period_end <= nowIso) {
    throw new SubscriptionRuntimeError('INVALID_STATE', 409);
  }

  const quote = await quoteSubscriptionPlanChange(
    env.D1_01, subscriberId, subscriptionId, { planId: targetPlanId, now }, input.ifMatch,
  );
  if (quote.direction !== 'DOWNGRADE' || quote.paymentRequired !== false ||
      quote.amountDueBeforeTaxMinor !== 0 || quote.effectiveAt !== subscription.current_period_end ||
      quote.subscriptionVersion !== sourceVersion ||
      quote.targetPlan === null || typeof quote.targetPlan !== 'object') {
    throw new SubscriptionRuntimeError('CONFLICT', 409);
  }

  // An earlier upgrade order must not remain payable after this schedule. The
  // payment-intent guard below also checks the live D1-01 version and schedule.
  let openMembershipOrders: Array<{ order_id: string; item_snapshot_json: string }>;
  try {
    const result = await env.D1_04.prepare(
      "SELECT o.order_id, l.item_snapshot_json FROM orders o " +
      "INNER JOIN order_lines l ON l.order_id = o.order_id " +
      "WHERE o.customer_id = ? AND o.status IN ('CREATED','PENDING_PAYMENT') " +
      "AND l.item_type = 'MEMBERSHIP_PLAN' ORDER BY o.created_at DESC LIMIT 100",
    ).bind(subscriberId).all<{ order_id: string; item_snapshot_json: string }>();
    openMembershipOrders = result.results ?? [];
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  for (const order of openMembershipOrders) {
    try {
      const snapshot = JSON.parse(order.item_snapshot_json) as Record<string, unknown>;
      const change = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
        ? snapshot.subscriptionChange as Record<string, unknown> | undefined
        : undefined;
      if (change?.subscriptionId === subscriptionId && change.changeType === 'UPGRADE') {
        throw new SubscriptionRuntimeError('CONFLICT', 409);
      }
    } catch (error) {
      if (error instanceof SubscriptionRuntimeError) throw error;
      throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
    }
  }

  const target = quote.targetPlan as Record<string, unknown>;
  const source = quote.currentPlan as Record<string, unknown>;
  const targetVersion = target.planVersion;
  const sourcePlanId = source.planId;
  const sourcePlanVersion = source.planVersion;
  if (typeof targetVersion !== 'number' || !Number.isSafeInteger(targetVersion) ||
      typeof sourcePlanId !== 'string' || typeof sourcePlanVersion !== 'number') {
    throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
  }

  const receiptInsert = env.D1_01.prepare(
    'INSERT OR IGNORE INTO membership_subscription_scheduled_plan_change_receipts ' +
    '(change_request_id, subscription_id, subscriber_id, source_subscription_version, ' +
    'scheduled_subscription_version, source_plan_id, source_plan_version, target_plan_id, ' +
    'target_plan_version, current_period_start, current_period_end, effective_at, scheduled_at) ' +
    'SELECT ?, s.subscription_id, s.subscriber_id, s.version, s.version + 1, s.plan_id, s.plan_version, ' +
    'tp.plan_id, tp.current_version, s.current_period_start, s.current_period_end, s.current_period_end, ? ' +
    'FROM membership_subscriptions s ' +
    'JOIN membership_plans tp ON tp.plan_id = ? AND tp.owner_type = \'CREATOR\' ' +
    'AND tp.owner_id = s.creator_id AND tp.status = \'ACTIVE\' AND tp.visibility = \'PUBLIC\' ' +
    'JOIN membership_plan_versions tv ON tv.plan_id = tp.plan_id AND tv.plan_version = tp.current_version ' +
    'JOIN membership_plan_versions sv ON sv.plan_id = s.plan_id AND sv.plan_version = s.plan_version ' +
    'WHERE s.subscription_id = ? AND s.subscriber_id = ? AND s.version = ? ' +
    'AND s.status = \'ACTIVE\' AND s.cancel_at IS NULL AND s.pending_plan_id IS NULL ' +
    'AND s.plan_id = ? AND s.plan_version = ? AND s.current_period_end = ? ' +
    'AND tp.current_version = ? ' +
    'AND tv.billing_interval = sv.billing_interval AND tv.currency = sv.currency AND tv.price_minor < sv.price_minor',
  ).bind(
    changeRequestId, nowIso, targetPlanId, subscriptionId, subscriberId, sourceVersion,
    subscription.plan_id, subscription.plan_version, subscription.current_period_end, targetVersion,
  );
  const subscriptionUpdate = env.D1_01.prepare(
    'UPDATE membership_subscriptions SET pending_plan_id = ?, pending_plan_version = ?, ' +
    'pending_plan_effective_at = current_period_end, pending_plan_change_id = ?, ' +
    'updated_at = CASE WHEN ? > updated_at THEN ? ELSE strftime(\'%Y-%m-%dT%H:%M:%fZ\', updated_at, \'+0.001 seconds\') END, ' +
    'version = version + 1 ' +
    'WHERE subscription_id = ? AND subscriber_id = ? AND version = ? AND status = \'ACTIVE\' ' +
    'AND cancel_at IS NULL AND pending_plan_id IS NULL AND plan_id = ? AND plan_version = ? ' +
    'AND current_period_end = ? AND EXISTS (SELECT 1 FROM membership_subscription_scheduled_plan_change_receipts r ' +
    'WHERE r.change_request_id = ? AND r.subscription_id = membership_subscriptions.subscription_id)',
  ).bind(
    targetPlanId, targetVersion, changeRequestId, nowIso, nowIso,
    subscriptionId, subscriberId, sourceVersion, subscription.plan_id, subscription.plan_version,
    subscription.current_period_end, changeRequestId,
  );

  try {
    const results = await env.D1_01.batch([receiptInsert, subscriptionUpdate]);
    if (Number(results[1]?.meta?.changes ?? 0) !== 1) {
      const replay = await env.D1_01.prepare(
        'SELECT * FROM membership_subscription_scheduled_plan_change_receipts WHERE change_request_id = ? LIMIT 1',
      ).bind(changeRequestId).first<ScheduledPlanChangeReceipt>();
      if (!replay || !validReceipt(replay)) {
        throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412);
      }
      return responseFromReceipt(replay, true);
    }
  } catch (error) {
    if (error instanceof SubscriptionRuntimeError) throw error;
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }

  const receipt = await env.D1_01.prepare(
    'SELECT * FROM membership_subscription_scheduled_plan_change_receipts WHERE change_request_id = ? LIMIT 1',
  ).bind(changeRequestId).first<ScheduledPlanChangeReceipt>();
  if (!receipt || !validReceipt(receipt)) {
    throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
  }
  return responseFromReceipt(receipt, false);
}
