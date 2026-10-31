/// <reference types="@cloudflare/workers-types" />

import { sha256BytesToHex } from '../../W10-async/src/canonical-json-idempotency.js';
import { addBillingPeriod } from './subscription-runtime.js';

type PaidOrderRow = Readonly<{
  payment_id: string;
  order_id: string;
  customer_id: string;
  provider: string;
  merchant_id: string;
  payment_status: string;
  amount_minor: number;
  payment_currency: string;
  order_status: string;
  order_currency: string;
  total_minor: number;
  confirmed_at: string | null;
}>;

type PaidOrderLineRow = Readonly<{
  order_line_id: string;
  item_type: string;
  item_ref: string;
  item_version: string;
  quantity: number;
  unit_amount_minor: number;
  line_total_minor: number;
  item_snapshot_json: string;
}>;

type MembershipPlanVersionRow = Readonly<{
  plan_id: string;
  owner_type: string;
  owner_id: string;
  plan_version: number;
  name: string;
  tier: string;
  billing_interval: string;
  price_minor: number;
  currency: string;
  benefits_json: string;
}>;

type ExistingSubscriptionRow = Readonly<{
  subscription_id: string;
  subscriber_id: string;
  plan_id: string;
  plan_version: number;
  creator_id: string | null;
  status: string;
  started_at: string;
  current_period_start: string;
  current_period_end: string;
  entitlement_snapshot_ref: string | null;
}>;

export type PaidMembershipPurchaseFulfillmentResult = Readonly<{
  outcome: 'APPLIED' | 'ALREADY_APPLIED' | 'NOT_APPLICABLE' | 'RECONCILIATION_REQUIRED';
  fulfilledCount: number;
  reasonCode?: string;
}>;

export class PaidMembershipPurchaseFulfillmentError extends Error {
  constructor(readonly code: 'VALIDATION_FAILED' | 'SERVICE_UNAVAILABLE', readonly status: number) {
    super(code);
    this.name = 'PaidMembershipPurchaseFulfillmentError';
  }
}

type FulfillmentEnv = Readonly<{ D1_01: D1Database; D1_04: D1Database }>;
type SubscriptionPlanUpgradeSnapshot = Readonly<{
  kind: 'PLAN_UPGRADE';
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
  expiresAt: string;
}>;

type MembershipOfferSnapshot = Readonly<{
  planId: string;
  planVersion: number;
  creatorId: string;
  name: string;
  tier: string;
  billingInterval: 'MONTHLY' | 'YEARLY';
  priceMinor: number;
  chargedAmountMinor: number;
  currency: string;
  benefits: string[];
  subscriptionChange: SubscriptionPlanUpgradeSnapshot | null;
}>;

const PAYMENT_ID_PATTERN = /^pay_[A-Za-z0-9]{26}$/;
const PLAN_ID_PATTERN = /^plan_[a-f0-9]{64}$/;
const MAX_ID = 256;
const MEMBERSHIP_ITEM = 'MEMBERSHIP_PLAN';

function boundedId(value: unknown, max = MAX_ID): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function canonicalIso(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function safeMinor(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function failClosed(): never {
  throw new PaidMembershipPurchaseFulfillmentError('SERVICE_UNAVAILABLE', 503);
}

function parseSnapshot(raw: string, line: PaidOrderLineRow, orderCurrency: string): MembershipOfferSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return failClosed();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return failClosed();
  const value = parsed as Record<string, unknown>;
  const benefits = value.benefits;
  const priceMinor = value.priceMinor;
  const chargedAmountMinor = value.chargedAmountMinor === undefined ? priceMinor : value.chargedAmountMinor;
  let subscriptionChange: SubscriptionPlanUpgradeSnapshot | null = null;
  if (Object.prototype.hasOwnProperty.call(value, 'subscriptionChange')) {
    const rawChange = value.subscriptionChange;
    if (typeof rawChange !== 'object' || rawChange === null || Array.isArray(rawChange)) return failClosed();
    const change = rawChange as Record<string, unknown>;
    if (
      change.kind !== 'PLAN_UPGRADE' ||
      typeof change.attemptId !== 'string' || !/^suca_[a-f0-9]{64}$/.test(change.attemptId) ||
      !boundedId(change.subscriberId) ||
      !boundedId(change.subscriptionId) ||
      !Number.isSafeInteger(change.expectedSubscriptionVersion) || (change.expectedSubscriptionVersion as number) < 1 ||
      typeof change.expectedPlanId !== 'string' || !PLAN_ID_PATTERN.test(change.expectedPlanId) ||
      !Number.isSafeInteger(change.expectedPlanVersion) || (change.expectedPlanVersion as number) < 1 ||
      change.targetPlanId !== value.planId ||
      change.targetPlanVersion !== value.planVersion ||
      !canonicalIso(change.currentPeriodStart) ||
      !canonicalIso(change.currentPeriodEnd) ||
      change.currentPeriodEnd <= change.currentPeriodStart ||
      !canonicalIso(change.expiresAt)
    ) return failClosed();
    subscriptionChange = {
      kind: 'PLAN_UPGRADE',
      attemptId: change.attemptId,
      subscriberId: change.subscriberId,
      subscriptionId: change.subscriptionId,
      expectedSubscriptionVersion: change.expectedSubscriptionVersion as number,
      expectedPlanId: change.expectedPlanId,
      expectedPlanVersion: change.expectedPlanVersion as number,
      targetPlanId: change.targetPlanId as string,
      targetPlanVersion: change.targetPlanVersion as number,
      currentPeriodStart: change.currentPeriodStart,
      currentPeriodEnd: change.currentPeriodEnd,
      expiresAt: change.expiresAt,
    };
  }
  if (
    typeof value.planId !== 'string' || !PLAN_ID_PATTERN.test(value.planId) ||
    value.planId !== line.item_ref ||
    !Number.isSafeInteger(value.planVersion) || (value.planVersion as number) < 1 ||
    String(value.planVersion) !== line.item_version ||
    !boundedId(value.creatorId) ||
    typeof value.name !== 'string' || value.name.trim().length < 1 || value.name.length > 120 ||
    typeof value.tier !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(value.tier) ||
    (value.billingInterval !== 'MONTHLY' && value.billingInterval !== 'YEARLY') ||
    !safeMinor(priceMinor) || priceMinor < 1 ||
    !safeMinor(chargedAmountMinor) || chargedAmountMinor < 1 ||
    chargedAmountMinor > priceMinor ||
    chargedAmountMinor !== line.unit_amount_minor ||
    value.currency !== orderCurrency ||
    !Array.isArray(benefits) || benefits.length > 20 ||
    benefits.some((item) => typeof item !== 'string' || item.length < 1 || item.length > 180) ||
    new Set(benefits).size !== benefits.length ||
    !Number.isSafeInteger(line.quantity) || line.quantity !== 1 ||
    !safeMinor(line.line_total_minor) || line.line_total_minor < 1
  ) return failClosed();

  if (subscriptionChange &&
      (subscriptionChange.targetPlanId !== value.planId ||
       subscriptionChange.targetPlanVersion !== value.planVersion)) return failClosed();

  return {
    planId: value.planId,
    planVersion: value.planVersion as number,
    creatorId: value.creatorId,
    name: value.name,
    tier: value.tier,
    billingInterval: value.billingInterval,
    priceMinor,
    chargedAmountMinor,
    currency: value.currency,
    benefits: benefits as string[],
    subscriptionChange,
  };
}

async function readPaidOrder(
  db: D1Database,
  paymentId: string,
  merchantId: string,
): Promise<PaidOrderRow> {
  let row: PaidOrderRow | null;
  try {
    row = await db.prepare(
      'SELECT p.payment_id, p.order_id, p.customer_id, p.provider, p.merchant_id, ' +
      'p.status AS payment_status, p.amount_minor, p.currency AS payment_currency, ' +
      'o.status AS order_status, o.currency AS order_currency, o.total_minor, o.confirmed_at ' +
      'FROM payments AS p INNER JOIN orders AS o ON o.order_id = p.order_id AND o.customer_id = p.customer_id ' +
      "WHERE p.provider = 'hyperswitch' AND p.payment_id = ? AND p.merchant_id = ? LIMIT 1",
    ).bind(paymentId, merchantId).first<PaidOrderRow>();
  } catch {
    return failClosed();
  }
  if (!row) return failClosed();
  if (
    row.provider !== 'hyperswitch' || row.payment_id !== paymentId || row.merchant_id !== merchantId ||
    !boundedId(row.order_id, 255) || !boundedId(row.customer_id) ||
    row.payment_status !== 'succeeded' ||
    !safeMinor(row.amount_minor) || row.amount_minor < 1 ||
    !/^[A-Z]{3}$/.test(row.payment_currency) ||
    row.payment_currency !== row.order_currency || row.amount_minor !== row.total_minor ||
    !['CONFIRMED', 'COMPLETED'].includes(row.order_status) ||
    !canonicalIso(row.confirmed_at)
  ) return failClosed();
  return row;
}

async function readOrderLines(db: D1Database, orderId: string): Promise<PaidOrderLineRow[]> {
  try {
    const rows = await db.prepare(
      'SELECT order_line_id, item_type, item_ref, item_version, quantity, unit_amount_minor, ' +
      'line_total_minor, item_snapshot_json FROM order_lines WHERE order_id = ? ORDER BY order_line_id ASC',
    ).bind(orderId).all<PaidOrderLineRow>();
    return rows.results ?? [];
  } catch {
    return failClosed();
  }
}

async function readPlanVersion(
  db: D1Database,
  snapshot: MembershipOfferSnapshot,
): Promise<MembershipPlanVersionRow> {
  let row: MembershipPlanVersionRow | null;
  try {
    row = await db.prepare(
      'SELECT p.plan_id, p.owner_type, p.owner_id, v.plan_version, v.name, v.tier, ' +
      'v.billing_interval, v.price_minor, v.currency, v.benefits_json ' +
      'FROM membership_plans AS p INNER JOIN membership_plan_versions AS v ON v.plan_id = p.plan_id ' +
      'WHERE p.plan_id = ? AND v.plan_version = ? LIMIT 1',
    ).bind(snapshot.planId, snapshot.planVersion).first<MembershipPlanVersionRow>();
  } catch {
    return failClosed();
  }
  if (!row) return failClosed();

  let benefits: unknown;
  try {
    benefits = JSON.parse(row.benefits_json) as unknown;
  } catch {
    return failClosed();
  }
  if (
    row.plan_id !== snapshot.planId || row.owner_type !== 'CREATOR' || row.owner_id !== snapshot.creatorId ||
    row.plan_version !== snapshot.planVersion || row.name !== snapshot.name || row.tier !== snapshot.tier ||
    row.billing_interval !== snapshot.billingInterval || row.price_minor !== snapshot.priceMinor ||
    row.currency !== snapshot.currency || !Array.isArray(benefits) ||
    JSON.stringify(benefits) !== JSON.stringify(snapshot.benefits)
  ) return failClosed();
  return row;
}

async function subscriptionIdForPaidOrderLine(orderId: string, lineId: string, subscriberId: string): Promise<string> {
  if (!boundedId(orderId, 255) || !boundedId(lineId, 255) || !boundedId(subscriberId)) {
    throw new PaidMembershipPurchaseFulfillmentError('VALIDATION_FAILED', 400);
  }
  const material = new TextEncoder().encode(
    'paid-membership-order-line-v1\u0000' + subscriberId + '\u0000' + orderId + '\u0000' + lineId,
  );
  try {
    return 'sub_' + await sha256BytesToHex(material);
  } catch {
    return failClosed();
  }
}

function matchesExistingSubscription(
  row: ExistingSubscriptionRow,
  input: {
    subscriptionId: string;
    subscriberId: string;
    orderId: string;
    lineId: string;
    snapshot: MembershipOfferSnapshot;
    periodStart: string;
    periodEnd: string;
  },
): boolean {
  // Billing periods and lifecycle status are mutable after the initial
  // purchase (renewal, pause, cancellation, expiration). Replay identity must
  // match only immutable order/subscription lineage and must never reactivate
  // or reset the current period.
  // A subscription may legitimately change plan/version or billing period
  // after purchase. The stable subscription ID is derived from this exact
  // customer/order-line lineage, so replay compares only immutable lineage.
  return row.subscription_id === input.subscriptionId &&
    row.subscriber_id === input.subscriberId &&
    row.creator_id === input.snapshot.creatorId &&
    row.started_at === input.periodStart &&
    row.entitlement_snapshot_ref === 'commerce-order:' + input.orderId + ':line:' + input.lineId;
}

async function readExistingSubscription(
  db: D1Database,
  subscriptionId: string,
): Promise<ExistingSubscriptionRow | null> {
  try {
    return await db.prepare(
      'SELECT subscription_id, subscriber_id, plan_id, plan_version, creator_id, status, started_at, ' +
      'current_period_start, current_period_end, entitlement_snapshot_ref ' +
      'FROM membership_subscriptions WHERE subscription_id = ? LIMIT 1',
    ).bind(subscriptionId).first<ExistingSubscriptionRow>();
  } catch {
    return failClosed();
  }
}

async function createOrReplayPaidSubscription(
  db: D1Database,
  input: {
    subscriptionId: string;
    subscriberId: string;
    orderId: string;
    lineId: string;
    snapshot: MembershipOfferSnapshot;
    periodStart: string;
    periodEnd: string;
  },
): Promise<'APPLIED' | 'ALREADY_APPLIED'> {
  const existing = await readExistingSubscription(db, input.subscriptionId);
  if (existing) {
    if (!matchesExistingSubscription(existing, input)) return failClosed();
    // Replays never reactivate a subscription that the subscriber has since cancelled,
    // paused or otherwise transitioned. The paid order was already fulfilled once.
    return 'ALREADY_APPLIED';
  }

  const entitlementSnapshotRef = 'commerce-order:' + input.orderId + ':line:' + input.lineId;
  try {
    await db.prepare(
      'INSERT INTO membership_subscriptions ' +
      '(subscription_id, subscriber_id, plan_id, plan_version, creator_id, status, started_at, ' +
      'current_period_start, current_period_end, cancel_at, entitlement_snapshot_ref, created_at, updated_at, version) ' +
      "VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, NULL, ?, ?, ?, 1)",
    ).bind(
      input.subscriptionId, input.subscriberId, input.snapshot.planId, input.snapshot.planVersion,
      input.snapshot.creatorId, input.periodStart, input.periodStart, input.periodEnd,
      entitlementSnapshotRef, input.periodStart, input.periodStart,
    ).run();
  } catch (error) {
    const raced = await readExistingSubscription(db, input.subscriptionId).catch(() => null);
    if (raced && matchesExistingSubscription(raced, input)) return 'ALREADY_APPLIED';
    // Do not leak database diagnostics, and do not acknowledge successful fulfillment.
    throw new PaidMembershipPurchaseFulfillmentError('SERVICE_UNAVAILABLE', 503);
  }

  const inserted = await readExistingSubscription(db, input.subscriptionId);
  if (!inserted || !matchesExistingSubscription(inserted, input) || inserted.status !== 'ACTIVE') {
    return failClosed();
  }
  return 'APPLIED';
}

/**
 * Fulfill only a durable, successfully reconciled Hyperswitch payment against its
 * D1-04 Order and immutable MembershipPlan snapshot. This is intentionally
 * separate from the user-facing subscription-create API: clients cannot assert
 * payment success, select the subscription ID, or assign their own entitlement.
 *
 * One order may contain at most one membership line in this Beta flow. Other
 * order item families are ignored; a mixed/multi-membership order is not partially
 * fulfilled because it requires its own admitted fulfillment contract.
 */
type UpgradeAttemptRow = Readonly<{
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
  order_id: string | null;
  status: 'PENDING_PAYMENT' | 'APPLIED' | 'EXPIRED' | 'RECONCILIATION_REQUIRED';
  expires_at: string;
  updated_at: string;
}>;

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
  entitlement_snapshot_ref: string | null;
  updated_at: string;
  version: number;
}>;

async function readUpgradeAttempt(
  db: D1Database,
  attemptId: string,
): Promise<UpgradeAttemptRow | null> {
  try {
    return await db.prepare(
      'SELECT attempt_id, subscriber_id, subscription_id, expected_subscription_version, ' +
      'expected_plan_id, expected_plan_version, target_plan_id, target_plan_version, ' +
      'current_period_start, current_period_end, order_id, status, expires_at, updated_at ' +
      'FROM membership_subscription_plan_change_attempts WHERE attempt_id = ? LIMIT 1',
    ).bind(attemptId).first<UpgradeAttemptRow>();
  } catch {
    return failClosed();
  }
}

async function readUpgradeSubscription(
  db: D1Database,
  subscriptionId: string,
  subscriberId: string,
): Promise<UpgradeSubscriptionRow | null> {
  try {
    return await db.prepare(
      'SELECT subscription_id, subscriber_id, plan_id, plan_version, creator_id, status, ' +
      'current_period_start, current_period_end, cancel_at, entitlement_snapshot_ref, updated_at, version ' +
      'FROM membership_subscriptions WHERE subscription_id = ? AND subscriber_id = ? LIMIT 1',
    ).bind(subscriptionId, subscriberId).first<UpgradeSubscriptionRow>();
  } catch {
    return failClosed();
  }
}

async function markUpgradeReconciliation(
  db: D1Database,
  attempt: UpgradeAttemptRow,
  now: string,
): Promise<void> {
  if (attempt.status !== 'PENDING_PAYMENT') return;
  const updatedAt = new Date(Math.max(Date.parse(attempt.updated_at) + 1, Date.parse(now))).toISOString();
  try {
    await db.prepare(
      "UPDATE membership_subscription_plan_change_attempts SET status = 'RECONCILIATION_REQUIRED', " +
      'updated_at = ?, version = version + 1 WHERE attempt_id = ? AND order_id = ? AND status = ?',
    ).bind(updatedAt, attempt.attempt_id, attempt.order_id, 'PENDING_PAYMENT').run();
  } catch {
    return failClosed();
  }
}

function isAppliedUpgradeSubscription(
  subscription: UpgradeSubscriptionRow,
  change: SubscriptionPlanUpgradeSnapshot,
  orderId: string,
  lineId: string,
): boolean {
  return subscription.plan_id === change.targetPlanId &&
    subscription.plan_version === change.targetPlanVersion &&
    subscription.entitlement_snapshot_ref === 'commerce-plan-upgrade:' + orderId + ':line:' + lineId &&
    subscription.version === change.expectedSubscriptionVersion + 1;
}

async function markUpgradeApplied(
  db: D1Database,
  attempt: UpgradeAttemptRow,
  change: SubscriptionPlanUpgradeSnapshot,
  orderId: string,
  lineId: string,
  appliedAt: string,
  updatedAt: string,
): Promise<boolean> {
  const entitlementRef = 'commerce-plan-upgrade:' + orderId + ':line:' + lineId;
  try {
    const result = await db.prepare(
      "UPDATE membership_subscription_plan_change_attempts SET status = 'APPLIED', applied_at = ?, " +
      'applied_subscription_version = ?, updated_at = ?, version = version + 1 ' +
      "WHERE attempt_id = ? AND subscriber_id = ? AND subscription_id = ? AND order_id = ? AND status = 'PENDING_PAYMENT' " +
      'AND expected_subscription_version = ? AND target_plan_id = ? AND target_plan_version = ? AND expires_at >= ? ' +
      'AND EXISTS (SELECT 1 FROM membership_subscriptions s WHERE s.subscription_id = ? AND s.subscriber_id = ? ' +
      'AND s.plan_id = ? AND s.plan_version = ? AND s.version = ? AND s.entitlement_snapshot_ref = ?)',
    ).bind(
      appliedAt, change.expectedSubscriptionVersion + 1, updatedAt,
      attempt.attempt_id, change.subscriberId, change.subscriptionId, orderId,
      change.expectedSubscriptionVersion, change.targetPlanId, change.targetPlanVersion, appliedAt,
      change.subscriptionId, change.subscriberId, change.targetPlanId, change.targetPlanVersion,
      change.expectedSubscriptionVersion + 1, entitlementRef,
    ).run();
    return Number(result.meta?.changes ?? 0) === 1;
  } catch {
    return failClosed();
  }
}

/**
 * Applies an already-paid upgrade against the existing subscription. Order and
 * Payment remain in D1-04; only plan identity, opaque order reference and CAS
 * version are changed in authoritative D1-01.
 */
async function applyPaidSubscriptionPlanUpgrade(
  env: FulfillmentEnv,
  order: PaidOrderRow,
  line: PaidOrderLineRow,
  snapshot: MembershipOfferSnapshot,
): Promise<Readonly<{ outcome: 'APPLIED' | 'ALREADY_APPLIED' | 'RECONCILIATION_REQUIRED'; reasonCode?: string }>> {
  const change = snapshot.subscriptionChange;
  if (!change || change.subscriberId !== order.customer_id || change.targetPlanId !== snapshot.planId ||
      change.targetPlanVersion !== snapshot.planVersion) {
    return { outcome: 'RECONCILIATION_REQUIRED', reasonCode: 'UPGRADE_SNAPSHOT_INVALID' };
  }

  const attempt = await readUpgradeAttempt(env.D1_01, change.attemptId);
  if (!attempt) return { outcome: 'RECONCILIATION_REQUIRED', reasonCode: 'UPGRADE_ATTEMPT_NOT_FOUND' };
  if (attempt.status === 'APPLIED') {
    return attempt.order_id === order.order_id
      ? { outcome: 'ALREADY_APPLIED' }
      : { outcome: 'RECONCILIATION_REQUIRED', reasonCode: 'UPGRADE_ATTEMPT_ORDER_MISMATCH' };
  }

  const mismatch =
    attempt.attempt_id !== change.attemptId ||
    attempt.subscriber_id !== change.subscriberId ||
    attempt.subscription_id !== change.subscriptionId ||
    attempt.expected_subscription_version !== change.expectedSubscriptionVersion ||
    attempt.expected_plan_id !== change.expectedPlanId ||
    attempt.expected_plan_version !== change.expectedPlanVersion ||
    attempt.target_plan_id !== change.targetPlanId ||
    attempt.target_plan_version !== change.targetPlanVersion ||
    attempt.current_period_start !== change.currentPeriodStart ||
    attempt.current_period_end !== change.currentPeriodEnd ||
    attempt.expires_at !== change.expiresAt ||
    attempt.order_id !== order.order_id;
  if (mismatch || attempt.status !== 'PENDING_PAYMENT') {
    await markUpgradeReconciliation(env.D1_01, attempt, order.confirmed_at!);
    return { outcome: 'RECONCILIATION_REQUIRED', reasonCode: 'UPGRADE_ATTEMPT_MISMATCH' };
  }
  if (order.confirmed_at! > attempt.expires_at || order.confirmed_at! < attempt.updated_at) {
    await markUpgradeReconciliation(env.D1_01, attempt, order.confirmed_at!);
    return { outcome: 'RECONCILIATION_REQUIRED', reasonCode: 'UPGRADE_PAYMENT_AFTER_EXPIRY' };
  }

  const subscription = await readUpgradeSubscription(env.D1_01, change.subscriptionId, change.subscriberId);
  if (!subscription) {
    await markUpgradeReconciliation(env.D1_01, attempt, order.confirmed_at!);
    return { outcome: 'RECONCILIATION_REQUIRED', reasonCode: 'UPGRADE_SUBSCRIPTION_NOT_FOUND' };
  }

  const entitlementRef = 'commerce-plan-upgrade:' + order.order_id + ':line:' + line.order_line_id;
  if (isAppliedUpgradeSubscription(subscription, change, order.order_id, line.order_line_id)) {
    const recovered = await markUpgradeApplied(
      env.D1_01, attempt, change, order.order_id, line.order_line_id, order.confirmed_at!,
      new Date(Math.max(Date.parse(subscription.updated_at) + 1, Date.parse(attempt.updated_at) + 1, Date.parse(order.confirmed_at!))).toISOString(),
    );
    if (recovered) return { outcome: 'APPLIED' };
    const latest = await readUpgradeAttempt(env.D1_01, change.attemptId);
    if (latest?.status === 'APPLIED' && latest.order_id === order.order_id) return { outcome: 'ALREADY_APPLIED' };
    return { outcome: 'RECONCILIATION_REQUIRED', reasonCode: 'UPGRADE_APPLIED_MARKER_RECOVERY_FAILED' };
  }

  const currentStateMatches =
    subscription.subscription_id === change.subscriptionId &&
    subscription.subscriber_id === change.subscriberId &&
    subscription.creator_id === snapshot.creatorId &&
    subscription.plan_id === change.expectedPlanId &&
    subscription.plan_version === change.expectedPlanVersion &&
    subscription.status === 'ACTIVE' &&
    subscription.cancel_at === null &&
    subscription.version === change.expectedSubscriptionVersion &&
    subscription.current_period_start === change.currentPeriodStart &&
    subscription.current_period_end === change.currentPeriodEnd &&
    canonicalIso(subscription.updated_at);
  if (!currentStateMatches) {
    await markUpgradeReconciliation(env.D1_01, attempt, order.confirmed_at!);
    return { outcome: 'RECONCILIATION_REQUIRED', reasonCode: 'UPGRADE_SUBSCRIPTION_CAS_PRECONDITION_FAILED' };
  }

  const updatedAt = new Date(Math.max(
    Date.parse(order.confirmed_at!),
    Date.parse(subscription.updated_at) + 1,
    Date.parse(attempt.updated_at) + 1,
  )).toISOString();
  try {
    const results = await env.D1_01.batch([
      env.D1_01.prepare(
        'UPDATE membership_subscriptions SET plan_id = ?, plan_version = ?, entitlement_snapshot_ref = ?, ' +
        'updated_at = ?, version = version + 1 WHERE subscription_id = ? AND subscriber_id = ? AND creator_id = ? ' +
        "AND plan_id = ? AND plan_version = ? AND status = 'ACTIVE' AND cancel_at IS NULL AND version = ? " +
        'AND current_period_start = ? AND current_period_end = ?',
      ).bind(
        change.targetPlanId, change.targetPlanVersion, entitlementRef, updatedAt,
        change.subscriptionId, change.subscriberId, snapshot.creatorId,
        change.expectedPlanId, change.expectedPlanVersion, change.expectedSubscriptionVersion,
        change.currentPeriodStart, change.currentPeriodEnd,
      ),
      env.D1_01.prepare(
        "UPDATE membership_subscription_plan_change_attempts SET status = 'APPLIED', applied_at = ?, " +
        'applied_subscription_version = ?, updated_at = ?, version = version + 1 ' +
        "WHERE attempt_id = ? AND subscriber_id = ? AND subscription_id = ? AND order_id = ? AND status = 'PENDING_PAYMENT' " +
        'AND expected_subscription_version = ? AND target_plan_id = ? AND target_plan_version = ? AND expires_at >= ? ' +
        'AND EXISTS (SELECT 1 FROM membership_subscriptions s WHERE s.subscription_id = ? AND s.subscriber_id = ? ' +
        'AND s.plan_id = ? AND s.plan_version = ? AND s.version = ? AND s.entitlement_snapshot_ref = ?)',
      ).bind(
        order.confirmed_at!, change.expectedSubscriptionVersion + 1, updatedAt,
        attempt.attempt_id, change.subscriberId, change.subscriptionId, order.order_id,
        change.expectedSubscriptionVersion, change.targetPlanId, change.targetPlanVersion, order.confirmed_at!,
        change.subscriptionId, change.subscriberId, change.targetPlanId, change.targetPlanVersion,
        change.expectedSubscriptionVersion + 1, entitlementRef,
      ),
    ]);
    if (Number(results[0]?.meta?.changes ?? 0) === 1 && Number(results[1]?.meta?.changes ?? 0) === 1) {
      return { outcome: 'APPLIED' };
    }
  } catch {
    const latestAttempt = await readUpgradeAttempt(env.D1_01, change.attemptId);
    if (latestAttempt?.status === 'APPLIED' && latestAttempt.order_id === order.order_id) {
      return { outcome: 'ALREADY_APPLIED' };
    }
    return failClosed() as never;
  }

  const latestAttempt = await readUpgradeAttempt(env.D1_01, change.attemptId);
  if (latestAttempt?.status === 'APPLIED' && latestAttempt.order_id === order.order_id) {
    return { outcome: 'ALREADY_APPLIED' };
  }
  const latestSubscription = await readUpgradeSubscription(env.D1_01, change.subscriptionId, change.subscriberId);
  if (latestAttempt && latestSubscription &&
      isAppliedUpgradeSubscription(latestSubscription, change, order.order_id, line.order_line_id)) {
    const recovered = await markUpgradeApplied(
      env.D1_01, latestAttempt, change, order.order_id, line.order_line_id, order.confirmed_at!, updatedAt,
    );
    if (recovered) return { outcome: 'APPLIED' };
    const afterRecovery = await readUpgradeAttempt(env.D1_01, change.attemptId);
    if (afterRecovery?.status === 'APPLIED' && afterRecovery.order_id === order.order_id) {
      return { outcome: 'ALREADY_APPLIED' };
    }
  }

  if (latestAttempt) await markUpgradeReconciliation(env.D1_01, latestAttempt, order.confirmed_at!);
  return { outcome: 'RECONCILIATION_REQUIRED', reasonCode: 'UPGRADE_SUBSCRIPTION_CAS_LOST' };
}

export async function fulfillPaidMembershipOrder(
  env: FulfillmentEnv,
  paymentId: string,
  merchantId: string,
): Promise<PaidMembershipPurchaseFulfillmentResult> {
  if (!PAYMENT_ID_PATTERN.test(paymentId) || !boundedId(merchantId)) {
    throw new PaidMembershipPurchaseFulfillmentError('VALIDATION_FAILED', 400);
  }

  const order = await readPaidOrder(env.D1_04, paymentId, merchantId);
  const lines = await readOrderLines(env.D1_04, order.order_id);
  if (lines.length === 0) return failClosed();

  let total = 0;
  for (const line of lines) {
    if (!safeMinor(line.line_total_minor)) return failClosed();
    total += line.line_total_minor;
    if (!Number.isSafeInteger(total)) return failClosed();
  }
  if (total !== order.total_minor) return failClosed();

  const membershipLines = lines.filter((line) => line.item_type === MEMBERSHIP_ITEM);
  if (membershipLines.length === 0) {
    return { outcome: 'NOT_APPLICABLE', fulfilledCount: 0 };
  }
  // Beta fulfillment admits a single-line membership order only. Do not grant
  // one entitlement from a mixed cart: the other line family may require its
  // own fulfillment/rollback contract and must be reconciled as one payment.
  if (membershipLines.length !== 1 || lines.length !== 1) return failClosed();

  const line = membershipLines[0]!;
  if (!boundedId(line.order_line_id, 255) || !PLAN_ID_PATTERN.test(line.item_ref)) return failClosed();
  const snapshot = parseSnapshot(line.item_snapshot_json, line, order.order_currency);
  await readPlanVersion(env.D1_01, snapshot);

  if (snapshot.subscriptionChange) {
    const result = await applyPaidSubscriptionPlanUpgrade(env, order, line, snapshot);
    return {
      outcome: result.outcome,
      fulfilledCount: result.outcome === 'RECONCILIATION_REQUIRED' ? 0 : 1,
      ...(result.reasonCode ? { reasonCode: result.reasonCode } : {}),
    };
  }

  const periodStart = order.confirmed_at!;
  let periodEnd: string;
  try {
    periodEnd = addBillingPeriod(periodStart, snapshot.billingInterval);
  } catch {
    return failClosed();
  }

  const subscriptionId = await subscriptionIdForPaidOrderLine(order.order_id, line.order_line_id, order.customer_id);
  const outcome = await createOrReplayPaidSubscription(env.D1_01, {
    subscriptionId,
    subscriberId: order.customer_id,
    orderId: order.order_id,
    lineId: line.order_line_id,
    snapshot,
    periodStart,
    periodEnd,
  });

  return { outcome, fulfilledCount: 1 };
}
