/// <reference types="@cloudflare/workers-types" />

import {
  etagForVersion,
  SubscriptionRuntimeError,
  validatePrincipal,
} from './subscription-runtime.js';

type SubscriptionPlanChangeRow = Readonly<{
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
  current_name: string;
  current_tier: string;
  current_billing_interval: string;
  current_price_minor: number;
  current_currency: string;
}>;

type TargetPlanRow = Readonly<{
  plan_id: string;
  owner_type: string;
  owner_id: string;
  current_version: number;
  status: string;
  visibility: string;
  name: string;
  tier: string;
  billing_interval: string;
  price_minor: number;
  currency: string;
}>;

type PlanChangeKind =
  | 'NO_CHANGE'
  | 'UPGRADE'
  | 'DOWNGRADE'
  | 'BILLING_INTERVAL_CHANGE'
  | 'SAME_PRICE_CHANGE';

export type SubscriptionPlanChangePreview = Readonly<{
  subscriptionId: string;
  currentPlan: Readonly<{
    planId: string;
    planVersion: number;
    name: string;
    tier: string;
    billingInterval: 'MONTHLY' | 'YEARLY';
    priceMinor: number;
    currency: string;
  }>;
  targetPlan: Readonly<{
    planId: string;
    planVersion: number;
    name: string;
    tier: string;
    billingInterval: 'MONTHLY' | 'YEARLY';
    priceMinor: number;
    currency: string;
  }>;
  changeType: PlanChangeKind;
  effectiveAt: string;
  prorationAmountMinor: number;
  currency: string;
  paymentRequired: boolean;
  remainingPeriodMs: number;
  periodDurationMs: number;
  computedAt: string;
  etag: string;
}>;

export type SubscriptionPlanChangePreviewDependencies = Readonly<{
  now?: () => Date;
}>;

const PLAN_ID_PATTERN = /^plan_[a-f0-9]{64}$/;
const MAX_ID = 256;
const MAX_PRICE_MINOR = 2_147_483_647;

function isBoundedId(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ID &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function isCanonicalUtc(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length <= 64 &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}

function validPlanSnapshot(value: {
  plan_id: string;
  plan_version: number;
  name: string;
  tier: string;
  billing_interval: string;
  price_minor: number;
  currency: string;
}): boolean {
  return isBoundedId(value.plan_id) &&
    Number.isSafeInteger(value.plan_version) &&
    value.plan_version >= 1 &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    value.name.length <= 120 &&
    typeof value.tier === 'string' &&
    /^[a-z][a-z0-9_-]{0,63}$/.test(value.tier) &&
    (value.billing_interval === 'MONTHLY' || value.billing_interval === 'YEARLY') &&
    Number.isSafeInteger(value.price_minor) &&
    value.price_minor >= 0 &&
    value.price_minor <= MAX_PRICE_MINOR &&
    typeof value.currency === 'string' &&
    /^[A-Z]{3}$/.test(value.currency);
}

/**
 * Read-only plan-change pricing preview.
 *
 * This intentionally does not mutate Subscription state, create an Order,
 * create a PaymentIntent, or grant entitlement. Upgrade amounts are prorated
 * only when both plans use the same billing interval and currency. Downgrades,
 * same-price changes, and interval changes are quoted for the next period
 * boundary so a customer never receives extra value before a payment.
 */
export async function previewSubscriptionPlanChange(
  db: D1Database,
  subscriberIdInput: string,
  subscriptionIdInput: string,
  targetPlanIdInput: string,
  dependencies: SubscriptionPlanChangePreviewDependencies = {},
): Promise<SubscriptionPlanChangePreview> {
  const subscriberId = validatePrincipal(subscriberIdInput);
  const subscriptionId = subscriptionIdInput.trim();
  const targetPlanId = targetPlanIdInput.trim();

  if (subscriptionId !== subscriptionIdInput || targetPlanId !== targetPlanIdInput ||
      !isBoundedId(subscriptionId) || subscriptionId.length > MAX_ID ||
      !PLAN_ID_PATTERN.test(targetPlanId)) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
  }

  let nowDate: Date;
  try {
    nowDate = (dependencies.now ?? (() => new Date()))();
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  if (!(nowDate instanceof Date) || !Number.isFinite(nowDate.getTime())) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  const nowMs = nowDate.getTime();
  const computedAt = nowDate.toISOString();

  let subscription: SubscriptionPlanChangeRow | null;
  try {
    subscription = await db.prepare(
      'SELECT s.subscription_id, s.subscriber_id, s.plan_id, s.plan_version, s.creator_id, ' +
      's.status, s.current_period_start, s.current_period_end, s.cancel_at, s.version, ' +
      'v.name AS current_name, v.tier AS current_tier, ' +
      'v.billing_interval AS current_billing_interval, v.price_minor AS current_price_minor, ' +
      'v.currency AS current_currency ' +
      'FROM membership_subscriptions AS s ' +
      'INNER JOIN membership_plan_versions AS v ON v.plan_id = s.plan_id AND v.plan_version = s.plan_version ' +
      'WHERE s.subscription_id = ? AND s.subscriber_id = ? LIMIT 1',
    ).bind(subscriptionId, subscriberId).first<SubscriptionPlanChangeRow>();
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  if (!subscription) throw new SubscriptionRuntimeError('RESOURCE_NOT_FOUND', 404);

  if (subscription.status !== 'ACTIVE' || subscription.cancel_at !== null) {
    throw new SubscriptionRuntimeError('INVALID_STATE', 409);
  }
  if (!isBoundedId(subscription.creator_id) ||
      !isCanonicalUtc(subscription.current_period_start) ||
      !isCanonicalUtc(subscription.current_period_end) ||
      !Number.isSafeInteger(subscription.version) ||
      subscription.version < 1 ||
      !validPlanSnapshot({
        plan_id: subscription.plan_id,
        plan_version: subscription.plan_version,
        name: subscription.current_name,
        tier: subscription.current_tier,
        billing_interval: subscription.current_billing_interval,
        price_minor: subscription.current_price_minor,
        currency: subscription.current_currency,
      })) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }

  const periodStartMs = Date.parse(subscription.current_period_start);
  const periodEndMs = Date.parse(subscription.current_period_end);
  if (periodEndMs <= periodStartMs || nowMs < periodStartMs || nowMs >= periodEndMs) {
    throw new SubscriptionRuntimeError('INVALID_STATE', 409);
  }

  let target: TargetPlanRow | null;
  try {
    target = await db.prepare(
      'SELECT p.plan_id, p.owner_type, p.owner_id, p.current_version, p.status, p.visibility, ' +
      'v.name, v.tier, v.billing_interval, v.price_minor, v.currency ' +
      'FROM membership_plans AS p ' +
      'INNER JOIN membership_plan_versions AS v ON v.plan_id = p.plan_id AND v.plan_version = p.current_version ' +
      'WHERE p.plan_id = ? LIMIT 1',
    ).bind(targetPlanId).first<TargetPlanRow>();
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  if (!target || target.owner_type !== 'CREATOR' || target.owner_id !== subscription.creator_id ||
      target.status !== 'ACTIVE' || target.visibility !== 'PUBLIC') {
    throw new SubscriptionRuntimeError('PLAN_NOT_ACTIVE', 409);
  }
  if (!validPlanSnapshot({
    plan_id: target.plan_id,
    plan_version: target.current_version,
    name: target.name,
    tier: target.tier,
    billing_interval: target.billing_interval,
    price_minor: target.price_minor,
    currency: target.currency,
  })) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  if (target.currency !== subscription.current_currency) {
    throw new SubscriptionRuntimeError('CONFLICT', 409);
  }

  const currentPlan = {
    planId: subscription.plan_id,
    planVersion: subscription.plan_version,
    name: subscription.current_name,
    tier: subscription.current_tier,
    billingInterval: subscription.current_billing_interval as 'MONTHLY' | 'YEARLY',
    priceMinor: subscription.current_price_minor,
    currency: subscription.current_currency,
  };
  const targetPlan = {
    planId: target.plan_id,
    planVersion: target.current_version,
    name: target.name,
    tier: target.tier,
    billingInterval: target.billing_interval as 'MONTHLY' | 'YEARLY',
    priceMinor: target.price_minor,
    currency: target.currency,
  };
  const periodDurationMs = periodEndMs - periodStartMs;
  const remainingPeriodMs = periodEndMs - nowMs;

  if (target.plan_id === subscription.plan_id && target.current_version === subscription.plan_version) {
    return {
      subscriptionId,
      currentPlan,
      targetPlan,
      changeType: 'NO_CHANGE',
      effectiveAt: computedAt,
      prorationAmountMinor: 0,
      currency: target.currency,
      paymentRequired: false,
      remainingPeriodMs,
      periodDurationMs,
      computedAt,
      etag: etagForVersion(subscription.version),
    };
  }

  let changeType: PlanChangeKind;
  let effectiveAt: string;
  let prorationAmountMinor = 0;

  if (target.billing_interval !== subscription.current_billing_interval) {
    changeType = 'BILLING_INTERVAL_CHANGE';
    effectiveAt = subscription.current_period_end;
  } else if (target.price_minor > subscription.current_price_minor) {
    changeType = 'UPGRADE';
    effectiveAt = computedAt;
    const difference = BigInt(target.price_minor - subscription.current_price_minor);
    const numerator = difference * BigInt(remainingPeriodMs);
    const denominator = BigInt(periodDurationMs);
    const prorated = (numerator + denominator - 1n) / denominator;
    if (prorated < 1n || prorated > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
    }
    prorationAmountMinor = Number(prorated);
  } else if (target.price_minor < subscription.current_price_minor) {
    changeType = 'DOWNGRADE';
    effectiveAt = subscription.current_period_end;
  } else {
    changeType = 'SAME_PRICE_CHANGE';
    effectiveAt = subscription.current_period_end;
  }

  return {
    subscriptionId,
    currentPlan,
    targetPlan,
    changeType,
    effectiveAt,
    prorationAmountMinor,
    currency: target.currency,
    paymentRequired: prorationAmountMinor > 0,
    remainingPeriodMs,
    periodDurationMs,
    computedAt,
    etag: etagForVersion(subscription.version),
  };
}
