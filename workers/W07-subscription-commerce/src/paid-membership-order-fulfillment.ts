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
  outcome: 'APPLIED' | 'ALREADY_APPLIED' | 'NOT_APPLICABLE';
  fulfilledCount: number;
}>;

export class PaidMembershipPurchaseFulfillmentError extends Error {
  constructor(readonly code: 'VALIDATION_FAILED' | 'SERVICE_UNAVAILABLE', readonly status: number) {
    super(code);
    this.name = 'PaidMembershipPurchaseFulfillmentError';
  }
}

type FulfillmentEnv = Readonly<{ D1_01: D1Database; D1_04: D1Database }>;
type MembershipOfferSnapshot = Readonly<{
  planId: string;
  planVersion: number;
  creatorId: string;
  name: string;
  tier: string;
  billingInterval: 'MONTHLY' | 'YEARLY';
  priceMinor: number;
  currency: string;
  benefits: string[];
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
  if (
    typeof value.planId !== 'string' || !PLAN_ID_PATTERN.test(value.planId) ||
    value.planId !== line.item_ref ||
    !Number.isSafeInteger(value.planVersion) || (value.planVersion as number) < 1 ||
    String(value.planVersion) !== line.item_version ||
    !boundedId(value.creatorId) ||
    typeof value.name !== 'string' || value.name.trim().length < 1 || value.name.length > 120 ||
    typeof value.tier !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(value.tier) ||
    (value.billingInterval !== 'MONTHLY' && value.billingInterval !== 'YEARLY') ||
    !safeMinor(value.priceMinor) || value.priceMinor < 1 ||
    value.priceMinor !== line.unit_amount_minor ||
    value.currency !== orderCurrency ||
    !Array.isArray(benefits) || benefits.length > 20 ||
    benefits.some((item) => typeof item !== 'string' || item.length < 1 || item.length > 180) ||
    new Set(benefits).size !== benefits.length ||
    !Number.isSafeInteger(line.quantity) || line.quantity !== 1 ||
    !safeMinor(line.line_total_minor) || line.line_total_minor < 1
  ) return failClosed();

  return {
    planId: value.planId,
    planVersion: value.planVersion as number,
    creatorId: value.creatorId,
    name: value.name,
    tier: value.tier,
    billingInterval: value.billingInterval,
    priceMinor: value.priceMinor,
    currency: value.currency,
    benefits: benefits as string[],
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
    !['CONFIRMED', 'PROCESSING', 'COMPLETED'].includes(row.order_status) ||
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
  return row.subscription_id === input.subscriptionId &&
    row.subscriber_id === input.subscriberId &&
    row.plan_id === input.snapshot.planId &&
    row.plan_version === input.snapshot.planVersion &&
    row.creator_id === input.snapshot.creatorId &&
    row.started_at === input.periodStart &&
    row.current_period_start === input.periodStart &&
    row.current_period_end === input.periodEnd &&
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
  if (membershipLines.length !== 1) return failClosed();

  const line = membershipLines[0]!;
  if (!boundedId(line.order_line_id, 255) || !PLAN_ID_PATTERN.test(line.item_ref)) return failClosed();
  const snapshot = parseSnapshot(line.item_snapshot_json, line, order.order_currency);
  await readPlanVersion(env.D1_01, snapshot);

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
