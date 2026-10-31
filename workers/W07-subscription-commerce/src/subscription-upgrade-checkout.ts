/// <reference types="@cloudflare/workers-types" />

import { createCommerceOrder, type AuthoritativelyPricedOrder, type CreateOrderResult } from './order-persistence.js';
import type { ResolvedCommerceOrderItems } from './order-item-resolution.js';
import { SubscriptionRuntimeError, validatePrincipal, etagForVersion } from './subscription-runtime.js';

type UpgradeSubscriptionRow = Readonly<{
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
  benefits_json: string;
  has_scheduled_change: number;
}>;

type UpgradeTargetPlanRow = Readonly<{
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
  benefits_json: string;
}>;

export type SubscriptionUpgradeCheckoutResult = Readonly<{
  order: CreateOrderResult['data'];
  replayed: boolean;
  subscriptionId: string;
  sourcePlanId: string;
  sourcePlanVersion: number;
  targetPlanId: string;
  targetPlanVersion: number;
  expectedSubscriptionVersion: number;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  prorationBaseMinor: number;
  currency: string;
  changeType: 'UPGRADE';
  activation: 'AFTER_VERIFIED_PAYMENT_SUCCESS';
  etag: string;
}>;

export type SubscriptionUpgradeCheckoutDependencies = Readonly<{
  now?: () => Date;
  resolvePricing: (resolved: ResolvedCommerceOrderItems) => Promise<AuthoritativelyPricedOrder>;
}>;

const PLAN_ID_PATTERN = /^plan_[a-f0-9]{64}$/;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_MINOR = 2_147_483_647;

function boundedId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function canonicalUtc(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function safePrice(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === 'number' && value >= 0 && value <= MAX_MINOR;
}

function validBenefits(raw: string): string[] {
  let value: unknown;
  try { value = JSON.parse(raw) as unknown; } catch { throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503); }
  if (!Array.isArray(value) || value.length > 20 ||
      value.some((item) => typeof item !== 'string' || item.length < 1 || item.length > 180) ||
      new Set(value).size !== value.length) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  return value;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Creates a normal D1-04 commerce Order for the prorated amount. The immutable
 * OrderLine snapshot carries the source subscription CAS identity; no D1-01
 * plan or entitlement is changed until the signed Hyperswitch success webhook.
 */
export async function createSubscriptionUpgradeOrder(
  d1_01: D1Database,
  d1_04: D1Database,
  subscriberIdInput: string,
  subscriptionIdInput: string,
  targetPlanIdInput: string,
  ifMatchInput: string | null,
  idempotencyKeyInput: string | null,
  dependencies: SubscriptionUpgradeCheckoutDependencies,
): Promise<SubscriptionUpgradeCheckoutResult> {
  const subscriberId = validatePrincipal(subscriberIdInput);
  const subscriptionId = subscriptionIdInput;
  const targetPlanId = targetPlanIdInput;
  const ifMatch = ifMatchInput ?? '';
  const versionMatch = /^"lr-v([1-9]\d*)"$/.exec(ifMatch);
  const expectedVersion = versionMatch?.[1] ? Number(versionMatch[1]) : Number.NaN;
  if (!boundedId(subscriptionId) || !PLAN_ID_PATTERN.test(targetPlanId) ||
      !Number.isSafeInteger(expectedVersion) || expectedVersion < 1 ||
      typeof idempotencyKeyInput !== 'string' || !IDEMPOTENCY_PATTERN.test(idempotencyKeyInput)) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
  }

  const nowDate = (dependencies.now ?? (() => new Date()))();
  if (!(nowDate instanceof Date) || !Number.isFinite(nowDate.getTime())) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  const nowMs = nowDate.getTime();
  const computedAt = nowDate.toISOString();

  let subscription: UpgradeSubscriptionRow | null;
  try {
    subscription = await d1_01.prepare(
      'SELECT s.subscription_id, s.subscriber_id, s.plan_id, s.plan_version, s.creator_id, s.status, ' +
      's.current_period_start, s.current_period_end, s.cancel_at, s.version, ' +
      'v.name AS current_name, v.tier AS current_tier, v.billing_interval AS current_billing_interval, ' +
      'v.price_minor AS current_price_minor, v.currency AS current_currency, v.benefits_json, ' +
      "EXISTS (SELECT 1 FROM membership_subscription_plan_changes pc WHERE pc.subscription_id = s.subscription_id AND pc.status = 'SCHEDULED') AS has_scheduled_change " +
      'FROM membership_subscriptions s INNER JOIN membership_plan_versions v ' +
      'ON v.plan_id = s.plan_id AND v.plan_version = s.plan_version ' +
      'WHERE s.subscription_id = ? AND s.subscriber_id = ? LIMIT 1',
    ).bind(subscriptionId, subscriberId).first<UpgradeSubscriptionRow>();
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  if (!subscription) throw new SubscriptionRuntimeError('RESOURCE_NOT_FOUND', 404);
  if (subscription.version !== expectedVersion) throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412);
  if (subscription.status !== 'ACTIVE' || subscription.cancel_at !== null || subscription.has_scheduled_change === 1) {
    throw new SubscriptionRuntimeError('INVALID_STATE', 409);
  }
  if (!boundedId(subscription.creator_id) || !canonicalUtc(subscription.current_period_start) ||
      !canonicalUtc(subscription.current_period_end) || !Number.isSafeInteger(subscription.version) ||
      subscription.version < 1 || !safePrice(subscription.current_price_minor) ||
      !/^[A-Z]{3}$/.test(subscription.current_currency) ||
      (subscription.current_billing_interval !== 'MONTHLY' && subscription.current_billing_interval !== 'YEARLY')) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  const periodStartMs = Date.parse(subscription.current_period_start);
  const periodEndMs = Date.parse(subscription.current_period_end);
  if (periodEndMs <= periodStartMs || nowMs < periodStartMs || nowMs >= periodEndMs) {
    throw new SubscriptionRuntimeError('INVALID_STATE', 409);
  }

  let target: UpgradeTargetPlanRow | null;
  try {
    target = await d1_01.prepare(
      'SELECT p.plan_id, p.owner_type, p.owner_id, p.current_version, p.status, p.visibility, ' +
      'v.name, v.tier, v.billing_interval, v.price_minor, v.currency, v.benefits_json ' +
      'FROM membership_plans p INNER JOIN membership_plan_versions v ' +
      'ON v.plan_id = p.plan_id AND v.plan_version = p.current_version ' +
      'WHERE p.plan_id = ? LIMIT 1',
    ).bind(targetPlanId).first<UpgradeTargetPlanRow>();
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  if (!target || target.owner_type !== 'CREATOR' || target.owner_id !== subscription.creator_id ||
      target.status !== 'ACTIVE' || target.visibility !== 'PUBLIC') {
    throw new SubscriptionRuntimeError('PLAN_NOT_ACTIVE', 409);
  }
  if (!safePrice(target.price_minor) || target.price_minor <= subscription.current_price_minor ||
      target.currency !== subscription.current_currency ||
      target.billing_interval !== subscription.current_billing_interval ||
      !Number.isSafeInteger(target.current_version) || target.current_version < 1 ||
      typeof target.name !== 'string' || target.name.trim().length < 1 || target.name.length > 120 ||
      typeof target.tier !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(target.tier)) {
    throw new SubscriptionRuntimeError('CONFLICT', 409);
  }

  const periodDurationMs = periodEndMs - periodStartMs;
  const remainingPeriodMs = periodEndMs - nowMs;
  const difference = BigInt(target.price_minor - subscription.current_price_minor);
  const numerator = difference * BigInt(remainingPeriodMs);
  const denominator = BigInt(periodDurationMs);
  const proration = (numerator + denominator - 1n) / denominator;
  if (proration < 1n || proration > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  const prorationBaseMinor = Number(proration);
  const benefits = validBenefits(target.benefits_json);
  const requestHash = await sha256Hex(JSON.stringify({
    version: 1,
    subscriptionId,
    subscriberId,
    sourcePlanId: subscription.plan_id,
    sourcePlanVersion: subscription.plan_version,
    targetPlanId: target.plan_id,
    targetPlanVersion: target.current_version,
    expectedSubscriptionVersion: subscription.version,
    currentPeriodStart: subscription.current_period_start,
    currentPeriodEnd: subscription.current_period_end,
    prorationBaseMinor: Number(persistedProration),
    currency: target.currency,
  }));

  const upgradeSnapshot = {
    planId: target.plan_id,
    planVersion: target.current_version,
    creatorId: subscription.creator_id,
    name: target.name,
    tier: target.tier,
    billingInterval: target.billing_interval,
    priceMinor: target.price_minor,
    currency: target.currency,
    benefits,
    membershipUpgrade: {
      version: 1,
      subscriptionId,
      sourcePlanId: subscription.plan_id,
      sourcePlanVersion: subscription.plan_version,
      targetPlanId: target.plan_id,
      targetPlanVersion: target.current_version,
      expectedSubscriptionVersion: subscription.version,
      currentPeriodStart: subscription.current_period_start,
      currentPeriodEnd: subscription.current_period_end,
      prorationBaseMinor,
      requestHash,
      quotedAt: computedAt,
      activation: 'AFTER_VERIFIED_PAYMENT_SUCCESS',
    },
  };
  const resolved: ResolvedCommerceOrderItems = {
    currency: target.currency,
    items: [{
      itemType: 'MEMBERSHIP_PLAN',
      itemRef: target.plan_id,
      itemVersion: String(target.current_version),
      quantity: 1,
      unitAmountMinor: prorationBaseMinor,
      currency: target.currency,
      itemSnapshotJson: JSON.stringify(upgradeSnapshot),
    }],
  };

  // The order store is shared with ordinary commerce checkout. Namespace the
  // caller's key by subscription while retaining deterministic replay semantics.
  const internalIdempotencyKey = 'upg_' + await sha256Hex(subscriptionId + '\u0000' + idempotencyKeyInput);
  const orderResult = await createCommerceOrder(
    d1_04,
    subscriberId,
    internalIdempotencyKey,
    { items: [{ itemRef: target.plan_id, quantity: 1 }] },
    () => dependencies.resolvePricing(resolved),
  );

  // Verify a replay still points at this exact subscription and source version;
  // never hand a stale order to checkout after the subscription has changed.
  let storedSnapshot: unknown;
  try {
    const line = await d1_04.prepare(
      'SELECT item_snapshot_json, unit_amount_minor FROM order_lines WHERE order_id = ? AND item_ref = ? LIMIT 1',
    ).bind(orderResult.data.orderId, target.plan_id).first<{ item_snapshot_json: string; unit_amount_minor: number }>();
    if (!line) throw new SubscriptionRuntimeError('CONFLICT', 409);
    storedSnapshot = { ...(JSON.parse(line.item_snapshot_json) as Record<string, unknown>), _storedUnitAmountMinor: line.unit_amount_minor };
  } catch (error) {
    if (error instanceof SubscriptionRuntimeError) throw error;
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  if (!storedSnapshot || typeof storedSnapshot !== 'object' || Array.isArray(storedSnapshot) ||
      (storedSnapshot as Record<string, unknown>).membershipUpgrade === undefined) {
    throw new SubscriptionRuntimeError('CONFLICT', 409);
  }
  const storedUpgrade = (storedSnapshot as Record<string, unknown>).membershipUpgrade;
  if (!storedUpgrade || typeof storedUpgrade !== 'object' || Array.isArray(storedUpgrade)) {
    throw new SubscriptionRuntimeError('CONFLICT', 409);
  }
  const persistedUpgrade = storedUpgrade as Record<string, unknown>;
  const persistedProration = persistedUpgrade.prorationBaseMinor;
  const persistedQuotedAt = persistedUpgrade.quotedAt;
  const storedUnitAmount = (storedSnapshot as Record<string, unknown>)._storedUnitAmountMinor;
  if (persistedUpgrade.subscriptionId !== subscriptionId ||
      persistedUpgrade.sourcePlanId !== subscription.plan_id ||
      persistedUpgrade.sourcePlanVersion !== subscription.plan_version ||
      persistedUpgrade.expectedSubscriptionVersion !== subscription.version ||
      persistedUpgrade.targetPlanId !== target.plan_id ||
      persistedUpgrade.targetPlanVersion !== target.current_version ||
      persistedUpgrade.currentPeriodStart !== subscription.current_period_start ||
      persistedUpgrade.currentPeriodEnd !== subscription.current_period_end ||
      !Number.isSafeInteger(persistedProration) || Number(persistedProration) < 1 ||
      storedUnitAmount !== persistedProration ||
      !canonicalUtc(persistedQuotedAt) ||
      Date.parse(persistedQuotedAt) < periodStartMs || Date.parse(persistedQuotedAt) >= periodEndMs ||
      (!orderResult.replayed && (persistedUpgrade.requestHash !== requestHash || persistedProration !== prorationBaseMinor))) {
    throw new SubscriptionRuntimeError('CONFLICT', 409);
  }

  return {
    order: orderResult.data,
    replayed: orderResult.replayed,
    subscriptionId,
    sourcePlanId: subscription.plan_id,
    sourcePlanVersion: subscription.plan_version,
    targetPlanId: target.plan_id,
    targetPlanVersion: target.current_version,
    expectedSubscriptionVersion: subscription.version,
    currentPeriodStart: subscription.current_period_start,
    currentPeriodEnd: subscription.current_period_end,
    prorationBaseMinor: Number(persistedProration),
    currency: target.currency,
    changeType: 'UPGRADE',
    activation: 'AFTER_VERIFIED_PAYMENT_SUCCESS',
    etag: etagForVersion(subscription.version),
  };
}
