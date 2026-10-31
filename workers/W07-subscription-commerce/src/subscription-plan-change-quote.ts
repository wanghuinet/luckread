import {
  SubscriptionRuntimeError,
  validateIfMatch,
  validatePrincipal,
} from './subscription-runtime.js';

type SubscriptionPlanChangeQuoteInput = Readonly<{
  planId: string;
  now?: Date;
}>;

type PlanSnapshotRow = Readonly<{
  plan_id: string;
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

type SubscriptionSnapshotRow = Readonly<{
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
}>;

const MAX_ID = 256;
const MAX_PRICE_MINOR = 2_147_483_647;

function requirePlanId(value: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_ID ||
      value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
  }
  return value;
}

function parseExpectedVersion(value: string): number {
  const etag = validateIfMatch(value);
  const match = /^"lr-v([1-9]\d*)"$/.exec(etag);
  if (!match?.[1]) throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412);
  const version = Number(match[1]);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412);
  }
  return version;
}

function isCanonicalIso(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function validatePlanSnapshot(row: PlanSnapshotRow): void {
  if (!Number.isSafeInteger(row.current_version) || row.current_version < 1 ||
      !Number.isSafeInteger(row.price_minor) || row.price_minor < 0 ||
      row.price_minor > MAX_PRICE_MINOR ||
      !/^[A-Z]{3}$/.test(row.currency) ||
      (row.billing_interval !== 'MONTHLY' && row.billing_interval !== 'YEARLY') ||
      typeof row.name !== 'string' || row.name.trim().length < 1 || row.name.length > 120 ||
      !/^[a-z][a-z0-9_-]{0,63}$/.test(row.tier)) {
    throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
  }
}

/**
 * Read-only quote for a same-currency, same-billing-interval plan change.
 *
 * Upgrades are priced only for the unused part of the current term using
 * ceiling-to-minor-unit rounding. Downgrades and same-price crossgrades are
 * effective at the current period end. This endpoint never changes the
 * subscription, creates an order, requests a payment, or grants entitlement.
 * Tax is explicitly excluded; the quote is not a payable amount.
 */
export async function quoteSubscriptionPlanChange(
  db: D1Database,
  subscriberIdInput: string,
  subscriptionIdInput: string,
  input: SubscriptionPlanChangeQuoteInput,
  ifMatch: string,
): Promise<Readonly<Record<string, unknown>>> {
  const subscriberId = validatePrincipal(subscriberIdInput);
  const subscriptionId = requirePlanId(subscriptionIdInput);
  const targetPlanId = requirePlanId(input.planId);
  const expectedVersion = parseExpectedVersion(ifMatch);
  const now = input.now ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
  }
  const nowIso = now.toISOString();

  const subscription = await db.prepare(
    'SELECT subscription_id, subscriber_id, plan_id, plan_version, creator_id, status, ' +
    'current_period_start, current_period_end, cancel_at, version, pending_plan_id ' +
    'FROM membership_subscriptions WHERE subscription_id = ? AND subscriber_id = ? LIMIT 1',
  ).bind(subscriptionId, subscriberId).first<SubscriptionSnapshotRow>();
  if (!subscription) throw new SubscriptionRuntimeError('RESOURCE_NOT_FOUND', 404);
  if (subscription.version !== expectedVersion) {
    throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412);
  }
  if (subscription.status !== 'ACTIVE' || subscription.cancel_at !== null || subscription.pending_plan_id !== null) {
    throw new SubscriptionRuntimeError('INVALID_STATE', 409);
  }
  if (subscription.plan_id === targetPlanId) {
    throw new SubscriptionRuntimeError('CONFLICT', 409);
  }
  if (!isCanonicalIso(subscription.current_period_start) ||
      !isCanonicalIso(subscription.current_period_end) ||
      subscription.current_period_end <= subscription.current_period_start ||
      Date.parse(subscription.current_period_end) <= now.getTime()) {
    throw new SubscriptionRuntimeError('INVALID_STATE', 409);
  }
  if (!subscription.creator_id) {
    throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
  }

  const currentPlan = await db.prepare(
    'SELECT p.plan_id, p.owner_id, p.current_version, p.status, p.visibility, ' +
    'v.name, v.tier, v.billing_interval, v.price_minor, v.currency ' +
    'FROM membership_plans p INNER JOIN membership_plan_versions v ' +
    'ON v.plan_id = p.plan_id AND v.plan_version = ? ' +
    'WHERE p.plan_id = ? AND p.owner_type = \'CREATOR\' AND p.owner_id = ? LIMIT 1',
  ).bind(subscription.plan_version, subscription.plan_id, subscription.creator_id).first<PlanSnapshotRow>();
  if (!currentPlan) throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);

  const targetPlan = await db.prepare(
    'SELECT p.plan_id, p.owner_id, p.current_version, p.status, p.visibility, ' +
    'v.name, v.tier, v.billing_interval, v.price_minor, v.currency ' +
    'FROM membership_plans p INNER JOIN membership_plan_versions v ' +
    'ON v.plan_id = p.plan_id AND v.plan_version = p.current_version ' +
    'WHERE p.plan_id = ? AND p.owner_type = \'CREATOR\' AND p.owner_id = ? ' +
    'AND p.status = \'ACTIVE\' AND p.visibility = \'PUBLIC\' LIMIT 1',
  ).bind(targetPlanId, subscription.creator_id).first<PlanSnapshotRow>();
  if (!targetPlan) throw new SubscriptionRuntimeError('PLAN_NOT_ACTIVE', 409);

  validatePlanSnapshot(currentPlan);
  validatePlanSnapshot(targetPlan);
  if (currentPlan.owner_id !== targetPlan.owner_id ||
      currentPlan.currency !== targetPlan.currency) {
    throw new SubscriptionRuntimeError('CONFLICT', 409);
  }
  if (currentPlan.billing_interval !== targetPlan.billing_interval) {
    throw new SubscriptionRuntimeError('BILLING_INTERVAL_CHANGE_REQUIRED', 409);
  }

  const periodStartMs = Date.parse(subscription.current_period_start);
  const periodEndMs = Date.parse(subscription.current_period_end);
  const nowMs = now.getTime();
  const totalPeriodMs = periodEndMs - periodStartMs;
  const remainingMs = Math.max(0, periodEndMs - Math.max(nowMs, periodStartMs));
  if (!Number.isSafeInteger(totalPeriodMs) || totalPeriodMs <= 0 ||
      !Number.isSafeInteger(remainingMs) || remainingMs <= 0) {
    throw new SubscriptionRuntimeError('INVALID_STATE', 409);
  }

  const priceDifference = targetPlan.price_minor - currentPlan.price_minor;
  let direction: 'UPGRADE' | 'DOWNGRADE' | 'CROSSGRADE';
  let effectiveAt: string;
  let amountDueBeforeTaxMinor = 0;

  if (priceDifference > 0) {
    direction = 'UPGRADE';
    effectiveAt = nowIso;
    const numerator = BigInt(priceDifference) * BigInt(remainingMs);
    const denominator = BigInt(totalPeriodMs);
    const rounded = (numerator + denominator - 1n) / denominator;
    if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
    }
    amountDueBeforeTaxMinor = Number(rounded);
  } else if (priceDifference < 0) {
    direction = 'DOWNGRADE';
    effectiveAt = subscription.current_period_end;
  } else {
    direction = 'CROSSGRADE';
    effectiveAt = subscription.current_period_end;
  }

  return {
    quoteStatus: 'PREVIEW_ONLY',
    subscriptionId: subscription.subscription_id,
    subscriptionVersion: subscription.version,
    subscriptionEtag: '"lr-v' + subscription.version + '"',
    currentPlan: {
      planId: currentPlan.plan_id,
      planVersion: subscription.plan_version,
      name: currentPlan.name,
      tier: currentPlan.tier,
      billingInterval: currentPlan.billing_interval,
      priceMinor: currentPlan.price_minor,
      currency: currentPlan.currency,
    },
    targetPlan: {
      planId: targetPlan.plan_id,
      planVersion: targetPlan.current_version,
      name: targetPlan.name,
      tier: targetPlan.tier,
      billingInterval: targetPlan.billing_interval,
      priceMinor: targetPlan.price_minor,
      currency: targetPlan.currency,
    },
    direction,
    effectiveAt,
    currentPeriodStart: subscription.current_period_start,
    currentPeriodEnd: subscription.current_period_end,
    remainingPeriodMilliseconds: remainingMs,
    totalPeriodMilliseconds: totalPeriodMs,
    amountDueBeforeTaxMinor,
    currency: currentPlan.currency,
    taxStatus: 'NOT_CALCULATED',
    paymentRequired: direction === 'UPGRADE' && amountDueBeforeTaxMinor > 0,
    paymentActionAvailable: false,
    mutationPerformed: false,
    entitlementChanged: false,
    generatedAt: nowIso,
  };
}
