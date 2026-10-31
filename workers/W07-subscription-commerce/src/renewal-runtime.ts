/// <reference types="@cloudflare/workers-types" />

import { strictlyAfterCanonicalUtcTimestamp } from './canonical-utc-timestamp.js';
import { sha256BytesToHex } from '../../W10-async/src/canonical-json-idempotency.js';

import {
  addBillingPeriod,
  SubscriptionRuntimeError,
} from './subscription-runtime.js';
import {
  createCommerceOrder,
  type AuthoritativelyPricedOrder,
} from './order-persistence.js';
import {
  createPaymentAttempt,
  recordHyperswitchMerchantInitiatedSubmission,
  PaymentPersistenceError,
  type PaymentAttemptDto,
} from './payment-persistence.js';
import {
  createHyperswitchMerchantInitiatedPayment,
  HyperswitchClientError,
  type HyperswitchClientConfig,
  type HyperswitchPayment,
  type HyperswitchPaymentStatus,
} from './hyperswitch-client.js';
import type { CreateCommerceOrderRequest } from './order-request-validation.js';

export type RenewalCycleState =
  | 'AWAITING_PRICING'
  | 'AWAITING_MANDATE'
  | 'PREPARED'
  | 'PAYMENT_READY'
  | 'SUBMITTING'
  | 'SUBMITTED'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'RECONCILIATION_REQUIRED';

export class RenewalRuntimeError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = 'RenewalRuntimeError';
  }
}

export type RenewalRuntimeEnv = Readonly<{
  D1_01: D1Database;
  D1_04: D1Database;
  HYPERSWITCH_ENVIRONMENT?: string | null;
  HYPERSWITCH_API_KEY?: string | null;
  HYPERSWITCH_MERCHANT_ID?: string | null;
}>;

type RenewalSubscriptionRow = Readonly<{
  subscription_id: string;
  subscriber_id: string;
  plan_id: string;
  plan_version: number;
  creator_id: string | null;
  status: string;
  current_period_start: string;
  current_period_end: string;
  cancel_at: string | null;
  pending_plan_id: string | null;
  pending_plan_version: number | null;
  pending_plan_effective_at: string | null;
  pending_plan_change_id: string | null;
  billing_interval: string;
  price_minor: number;
  currency: string;
  name: string;
  tier: string;
  benefits_json: string;
  pending_billing_interval: string | null;
  pending_price_minor: number | null;
  pending_currency: string | null;
  pending_name: string | null;
  pending_tier: string | null;
  pending_benefits_json: string | null;
}>;

type RenewalOfferSnapshot = Readonly<{
  subscriptionId: string;
  subscriberId: string;
  creatorId: string | null;
  planId: string;
  planVersion: number;
  name: string;
  tier: string;
  billingInterval: 'MONTHLY' | 'YEARLY';
  priceMinor: number;
  currency: string;
  benefits: string[];
}>;

type RenewalCycleRow = {
  cycle_id: string;
  provider: 'hyperswitch';
  merchant_id: string;
  subscription_id: string;
  subscriber_id: string;
  plan_id: string;
  plan_version: number;
  cycle_start: string;
  cycle_end: string;
  billing_interval: 'MONTHLY' | 'YEARLY';
  currency: string;
  offer_snapshot_json: string;
  amount_minor: number | null;
  pricing_snapshot_json: string | null;
  payment_method_id: string | null;
  mandate_record_id: string | null;
  order_id: string | null;
  payment_id: string | null;
  state: RenewalCycleState;
  subscription_sync_state: 'PENDING' | 'APPLIED' | 'RECONCILIATION_REQUIRED';
  subscription_sync_updated_at: string | null;
  subscription_sync_error_code: string | null;
  attempt_number: number;
  provider_response_status: HyperswitchPaymentStatus | null;
  outcome_code: string | null;
  lease_token: string | null;
  lease_expires_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

type RenewalCursorRow = {
  state_id: 'subscription-renewals';
  cursor_period_end: string | null;
  cursor_subscription_id: string | null;
  version: number;
  updated_at: string;
};

type ActiveMandateRow = Readonly<{
  mandate_record_id: string;
  payment_method_id: string;
}>;

export type RenewalRuntimeDependencies = Readonly<{
  now?: () => Date;
  createLeaseToken?: () => string;
  resolvePricing?: (
    input: Readonly<{ cycle: RenewalCycleRow; offer: RenewalOfferSnapshot; request: CreateCommerceOrderRequest }>,
  ) => Promise<AuthoritativelyPricedOrder>;
  createOrder?: typeof createCommerceOrder;
  createPaymentAttempt?: typeof createPaymentAttempt;
  createProviderCharge?: typeof createHyperswitchMerchantInitiatedPayment;
  recordProviderSubmission?: typeof recordHyperswitchMerchantInitiatedSubmission;
}>;

export type RenewalScanResult = Readonly<{
  scanned: number;
  cycleIds: string[];
  cursorAdvanced: boolean;
  cursorReset: boolean;
}>;

export type RenewalProcessResult = Readonly<{
  cycleId: string;
  state: RenewalCycleState;
  action:
    | 'CREATED'
    | 'AWAITING_PRICING'
    | 'AWAITING_MANDATE'
    | 'AWAITING_RETRY'
    | 'AWAITING_OUTCOME_SYNC'
    | 'PREPARED'
    | 'PAYMENT_READY'
    | 'SUBMISSION_IN_PROGRESS'
    | 'SUBMITTED'
    | 'TERMINAL'
    | 'RECONCILIATION_REQUIRED';
  paymentId?: string;
}>;

const PROVIDER = 'hyperswitch' as const;
const MAX_ID = 256;
const MAX_PAGE_SIZE = 50;
const MAX_ATTEMPTS = 20;
const LEASE_MS = 120_000;
const MAX_SAFE_MINOR = Number.MAX_SAFE_INTEGER;
const PERMANENT_ORDER_IDEMPOTENCY_EXPIRY = '9999-12-31T23:59:59.999Z';
const FIRST_RETRY_DELAY_MS = 5 * 60 * 1000;
const MAX_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;

function renewalRetryDelayMs(attemptNumber: number): number {
  const exponent = Math.min(Math.max(attemptNumber - 1, 0), 7);
  return Math.min(FIRST_RETRY_DELAY_MS * (2 ** exponent), MAX_RETRY_DELAY_MS);
}

function renewalRetryDue(cycle: RenewalCycleRow, now: string): boolean {
  const failedAt = Date.parse(cycle.updated_at);
  const nowAt = Date.parse(now);
  return Number.isFinite(failedAt) && Number.isFinite(nowAt) &&
    nowAt >= failedAt + renewalRetryDelayMs(cycle.attempt_number);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCanonicalIso = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 64 &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

const isBoundedText = (value: unknown, max = MAX_ID): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max &&
  value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);

const isSafeMinor = (value: unknown, allowZero = false): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) &&
  value >= (allowZero ? 0 : 1) && value <= MAX_SAFE_MINOR;

const nowIso = (now: () => Date): string => {
  const date = now();
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new RenewalRuntimeError('INTEGRITY_VIOLATION', 500);
  }
  return date.toISOString();
};

const strictlyAfter = (current: string, previous: string): string => {
  const next = strictlyAfterCanonicalUtcTimestamp(current, previous);
  if (next === null) throw new RenewalRuntimeError('INTEGRITY_VIOLATION', 500);
  return next;
};

const defaultLeaseToken = (): string => crypto.randomUUID().replace(/-/g, '');

/** Stable identity: duplicate scans of the same subscription billing period produce the same cycle ID. */
export async function renewalCycleIdFor(
  subscriptionId: string,
  cycleStart: string,
  cycleEnd: string,
): Promise<string> {
  if (!isBoundedText(subscriptionId) || !isCanonicalIso(cycleStart) ||
      !isCanonicalIso(cycleEnd) || cycleEnd <= cycleStart) {
    throw new RenewalRuntimeError('VALIDATION_FAILED', 400);
  }
  try {
    const digest = await sha256BytesToHex(
      new TextEncoder().encode(subscriptionId + '\u0000' + cycleStart + '\u0000' + cycleEnd),
    );
    return 'rcy_' + digest.slice(0, 26);
  } catch {
    throw new RenewalRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
}

function resolveHyperswitchConfig(env: RenewalRuntimeEnv): HyperswitchClientConfig {
  if ((env.HYPERSWITCH_ENVIRONMENT !== 'sandbox' && env.HYPERSWITCH_ENVIRONMENT !== 'production') ||
      !isBoundedText(env.HYPERSWITCH_API_KEY, 4096) ||
      /[\r\n]/.test(env.HYPERSWITCH_API_KEY) ||
      !isBoundedText(env.HYPERSWITCH_MERCHANT_ID, 256)) {
    throw new RenewalRuntimeError('PROVIDER_CONFIGURATION_REQUIRED', 503);
  }
  return {
    environment: env.HYPERSWITCH_ENVIRONMENT,
    apiKey: env.HYPERSWITCH_API_KEY,
    expectedMerchantId: env.HYPERSWITCH_MERCHANT_ID,
  };
}

function parseOfferSnapshot(raw: string): RenewalOfferSnapshot {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new RenewalRuntimeError('INTEGRITY_VIOLATION', 500);
  }
  if (!isRecord(value) ||
      !isBoundedText(value.subscriptionId) ||
      !isBoundedText(value.subscriberId) ||
      !(value.creatorId === null || isBoundedText(value.creatorId)) ||
      !isBoundedText(value.planId) ||
      !Number.isSafeInteger(value.planVersion) || (value.planVersion as number) < 1 ||
      !isBoundedText(value.name, 120) ||
      typeof value.tier !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(value.tier) ||
      (value.billingInterval !== 'MONTHLY' && value.billingInterval !== 'YEARLY') ||
      !isSafeMinor(value.priceMinor, true) ||
      typeof value.currency !== 'string' || !/^[A-Z]{3}$/.test(value.currency) ||
      !Array.isArray(value.benefits) || value.benefits.length > 20 ||
      value.benefits.some((item) => typeof item !== 'string' || item.length < 1 || item.length > 180) ||
      new Set(value.benefits as string[]).size !== value.benefits.length) {
    throw new RenewalRuntimeError('INTEGRITY_VIOLATION', 500);
  }
  return value as RenewalOfferSnapshot;
}

function parsePricingSnapshot(raw: string): AuthoritativelyPricedOrder {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new RenewalRuntimeError('INTEGRITY_VIOLATION', 500);
  }
  if (!isRecord(value) ||
      typeof value.currency !== 'string' || !/^[A-Z]{3}$/.test(value.currency) ||
      !Array.isArray(value.items) || value.items.length !== 1) {
    throw new RenewalRuntimeError('INTEGRITY_VIOLATION', 500);
  }
  const item = value.items[0];
  if (!isRecord(item) ||
      item.itemType !== 'MEMBERSHIP_PLAN' ||
      !isBoundedText(item.itemRef) ||
      !isBoundedText(item.itemVersion, 255) ||
      item.quantity !== 1 ||
      !isSafeMinor(item.unitAmountMinor, true) ||
      item.currency !== value.currency ||
      !isSafeMinor(item.lineDiscountMinor, true) ||
      !isSafeMinor(item.lineTaxMinor, true) ||
      typeof item.itemSnapshotJson !== 'string' ||
      new TextEncoder().encode(item.itemSnapshotJson).byteLength > 65_536) {
    throw new RenewalRuntimeError('INTEGRITY_VIOLATION', 500);
  }
  return value as unknown as AuthoritativelyPricedOrder;
}

function normalizePricingDecision(
  cycle: RenewalCycleRow,
  offer: RenewalOfferSnapshot,
  input: AuthoritativelyPricedOrder,
): Readonly<{ pricing: AuthoritativelyPricedOrder; totalMinor: number }> {
  if (!isRecord(input) || input.currency !== cycle.currency ||
      !Array.isArray(input.items) || input.items.length !== 1) {
    throw new RenewalRuntimeError('PRICING_DECISION_INVALID', 503);
  }
  const resolved = input.items[0];
  if (!isRecord(resolved) ||
      resolved.itemType !== 'MEMBERSHIP_PLAN' ||
      resolved.itemRef !== cycle.plan_id ||
      resolved.itemVersion !== String(cycle.plan_version) ||
      resolved.quantity !== 1 ||
      resolved.unitAmountMinor !== offer.priceMinor ||
      resolved.currency !== cycle.currency ||
      !isSafeMinor(resolved.lineDiscountMinor, true) ||
      !isSafeMinor(resolved.lineTaxMinor, true) ||
      resolved.lineDiscountMinor > offer.priceMinor) {
    throw new RenewalRuntimeError('PRICING_DECISION_INVALID', 503);
  }
  const total = offer.priceMinor - resolved.lineDiscountMinor + resolved.lineTaxMinor;
  if (!isSafeMinor(total, true)) throw new RenewalRuntimeError('PRICING_DECISION_INVALID', 503);
  const subscriptionRenewal = {
    subscriptionId: cycle.subscription_id,
    cycleStart: cycle.cycle_start,
    cycleEnd: cycle.cycle_end,
  };
  const itemSnapshotJson = JSON.stringify({
    planId: offer.planId,
    planVersion: offer.planVersion,
    creatorId: offer.creatorId,
    name: offer.name,
    tier: offer.tier,
    billingInterval: offer.billingInterval,
    priceMinor: offer.priceMinor,
    currency: offer.currency,
    benefits: offer.benefits,
    subscriptionRenewal,
  });
  if (new TextEncoder().encode(itemSnapshotJson).byteLength > 65_536) {
    throw new RenewalRuntimeError('PRICING_DECISION_INVALID', 503);
  }
  const pricing: AuthoritativelyPricedOrder = {
    currency: cycle.currency,
    items: [{
      itemType: 'MEMBERSHIP_PLAN',
      itemRef: cycle.plan_id,
      itemVersion: String(cycle.plan_version),
      quantity: 1,
      unitAmountMinor: offer.priceMinor,
      currency: cycle.currency,
      lineDiscountMinor: resolved.lineDiscountMinor,
      lineTaxMinor: resolved.lineTaxMinor,
      itemSnapshotJson,
    }],
  };
  return { pricing, totalMinor: total };
}

async function readCycleById(db: D1Database, cycleId: string): Promise<RenewalCycleRow> {
  const row = await db.prepare(
    'SELECT * FROM subscription_renewal_cycles WHERE cycle_id = ? LIMIT 1',
  ).bind(cycleId).first<RenewalCycleRow>();
  if (!row) throw new RenewalRuntimeError('RESOURCE_NOT_FOUND', 404);
  return row;
}

async function readCycleByPeriod(
  db: D1Database,
  subscriptionId: string,
  cycleStart: string,
): Promise<RenewalCycleRow | null> {
  return db.prepare(
    'SELECT * FROM subscription_renewal_cycles WHERE subscription_id = ? AND cycle_start = ? LIMIT 1',
  ).bind(subscriptionId, cycleStart).first<RenewalCycleRow>();
}

async function readActiveMandate(
  db: D1Database,
  merchantId: string,
  customerId: string,
): Promise<ActiveMandateRow | null> {
  return db.prepare(
    'SELECT m.mandate_record_id, m.payment_method_id FROM payment_mandates m ' +
    'JOIN saved_payment_methods s ON s.provider = m.provider AND s.merchant_id = m.merchant_id ' +
    'AND s.customer_id = m.customer_id AND s.payment_method_id = m.payment_method_id ' +
    "WHERE m.provider = 'hyperswitch' AND m.merchant_id = ? AND m.customer_id = ? " +
    "AND m.status = 'ACTIVE' AND m.provider_mandate_id IS NOT NULL " +
    'ORDER BY m.updated_at DESC, m.mandate_record_id DESC LIMIT 1',
  ).bind(merchantId, customerId).first<ActiveMandateRow>();
}

async function isExactMandateActive(db: D1Database, cycle: RenewalCycleRow): Promise<boolean> {
  if (!cycle.mandate_record_id || !cycle.payment_method_id) return false;
  const row = await db.prepare(
    'SELECT 1 AS active FROM payment_mandates m ' +
    'JOIN saved_payment_methods s ON s.provider = m.provider AND s.merchant_id = m.merchant_id ' +
    'AND s.customer_id = m.customer_id AND s.payment_method_id = m.payment_method_id ' +
    "WHERE m.mandate_record_id = ? AND m.provider = 'hyperswitch' AND m.merchant_id = ? " +
    "AND m.customer_id = ? AND m.payment_method_id = ? AND m.status = 'ACTIVE' " +
    'AND m.provider_mandate_id IS NOT NULL LIMIT 1',
  ).bind(cycle.mandate_record_id, cycle.merchant_id, cycle.subscriber_id, cycle.payment_method_id).first<{ active: number }>();
  return row?.active === 1;
}

async function updateCycle(
  db: D1Database,
  cycle: RenewalCycleRow,
  now: string,
  assignments: string,
  values: unknown[],
): Promise<RenewalCycleRow> {
  const result = await db.prepare(
    'UPDATE subscription_renewal_cycles SET ' + assignments +
    ', version = version + 1, updated_at = ? WHERE cycle_id = ? AND version = ?',
  ).bind(...values, strictlyAfter(now, cycle.updated_at), cycle.cycle_id, cycle.version).run();
  if (Number(result.meta?.changes ?? 0) === 1) return readCycleById(db, cycle.cycle_id);
  const raced = await readCycleById(db, cycle.cycle_id);
  return raced;
}

async function insertOrReadCycle(
  env: RenewalRuntimeEnv,
  subscription: RenewalSubscriptionRow,
  merchantId: string,
  now: string,
): Promise<RenewalCycleRow> {
  const hasScheduledPlan = subscription.pending_plan_id !== null;
  if (!['ACTIVE', 'PAST_DUE'].includes(subscription.status) ||
      !isBoundedText(subscription.subscription_id) ||
      !isBoundedText(subscription.subscriber_id) ||
      !isBoundedText(subscription.plan_id) ||
      !Number.isSafeInteger(subscription.plan_version) || subscription.plan_version < 1 ||
      !isCanonicalIso(subscription.current_period_end) ||
      !isCanonicalIso(subscription.current_period_start) ||
      (subscription.billing_interval !== 'MONTHLY' && subscription.billing_interval !== 'YEARLY') ||
      !isSafeMinor(subscription.price_minor, true) ||
      typeof subscription.currency !== 'string' || !/^[A-Z]{3}$/.test(subscription.currency)) {
    throw new RenewalRuntimeError('SUBSCRIPTION_SNAPSHOT_INVALID', 503);
  }

  if (hasScheduledPlan && (
      !isBoundedText(subscription.pending_plan_id) ||
      subscription.pending_plan_id === subscription.plan_id ||
      !Number.isSafeInteger(subscription.pending_plan_version) || (subscription.pending_plan_version ?? 0) < 1 ||
      subscription.pending_plan_effective_at !== subscription.current_period_end ||
      !isBoundedText(subscription.pending_plan_change_id, 64) ||
      !/^sps_[a-f0-9]{60}$/.test(subscription.pending_plan_change_id) ||
      subscription.pending_billing_interval !== subscription.billing_interval ||
      !isSafeMinor(subscription.pending_price_minor, true) ||
      subscription.pending_price_minor! >= subscription.price_minor ||
      subscription.pending_currency !== subscription.currency ||
      !isBoundedText(subscription.pending_name, 120) ||
      !isBoundedText(subscription.pending_tier, 64) ||
      typeof subscription.pending_benefits_json !== 'string' ||
      subscription.pending_benefits_json.length > 16_384
  )) {
    throw new RenewalRuntimeError('SCHEDULED_PLAN_SNAPSHOT_INVALID', 503);
  }

  const effectivePlanId = hasScheduledPlan ? subscription.pending_plan_id! : subscription.plan_id;
  const effectivePlanVersion = hasScheduledPlan ? subscription.pending_plan_version! : subscription.plan_version;
  const effectiveBillingInterval = hasScheduledPlan ? subscription.pending_billing_interval! : subscription.billing_interval;
  const effectivePriceMinor = hasScheduledPlan ? subscription.pending_price_minor! : subscription.price_minor;
  const effectiveCurrency = hasScheduledPlan ? subscription.pending_currency! : subscription.currency;
  const effectiveName = hasScheduledPlan ? subscription.pending_name! : subscription.name;
  const effectiveTier = hasScheduledPlan ? subscription.pending_tier! : subscription.tier;
  const effectiveBenefitsJson = hasScheduledPlan ? subscription.pending_benefits_json! : subscription.benefits_json;

  const cycleStart = subscription.current_period_end;
  const cycleEnd = addBillingPeriod(cycleStart, effectiveBillingInterval);
  const cycleId = await renewalCycleIdFor(subscription.subscription_id, cycleStart, cycleEnd);

  // PAST_DUE resumes the original durable cycle only. The scheduled plan is
  // retained in D1-01 until a successful payment applies the target version.
  if (subscription.status === 'PAST_DUE') {
    const existing = await readCycleByPeriod(env.D1_04, subscription.subscription_id, cycleStart);
    if (!existing || existing.cycle_id !== cycleId || existing.cycle_end !== cycleEnd ||
        existing.plan_id !== effectivePlanId || existing.plan_version !== effectivePlanVersion ||
        existing.subscriber_id !== subscription.subscriber_id) {
      throw new RenewalRuntimeError('PAST_DUE_CYCLE_MISSING_OR_MISMATCHED', 503);
    }
    return existing;
  }

  let benefits: unknown;
  try { benefits = JSON.parse(effectiveBenefitsJson); }
  catch { throw new RenewalRuntimeError('SUBSCRIPTION_SNAPSHOT_INVALID', 503); }
  if (!Array.isArray(benefits) || benefits.length > 20 ||
      benefits.some((item) => typeof item !== 'string' || item.length < 1 || item.length > 180) ||
      new Set(benefits).size !== benefits.length) {
    throw new RenewalRuntimeError('SUBSCRIPTION_SNAPSHOT_INVALID', 503);
  }
  const offer: RenewalOfferSnapshot = {
    subscriptionId: subscription.subscription_id,
    subscriberId: subscription.subscriber_id,
    creatorId: subscription.creator_id,
    planId: effectivePlanId,
    planVersion: effectivePlanVersion,
    name: effectiveName,
    tier: effectiveTier,
    billingInterval: effectiveBillingInterval as 'MONTHLY' | 'YEARLY',
    priceMinor: effectivePriceMinor,
    currency: effectiveCurrency,
    benefits: benefits as string[],
  };
  const offerSnapshotJson = JSON.stringify(offer);
  await env.D1_04.prepare(
    'INSERT INTO subscription_renewal_cycles ' +
    '(cycle_id, provider, merchant_id, subscription_id, subscriber_id, plan_id, plan_version, ' +
    'cycle_start, cycle_end, billing_interval, currency, offer_snapshot_json, amount_minor, ' +
    'pricing_snapshot_json, payment_method_id, mandate_record_id, order_id, payment_id, state, ' +
    'attempt_number, provider_response_status, outcome_code, lease_token, lease_expires_at, version, created_at, updated_at) ' +
    "VALUES (?, 'hyperswitch', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, 'AWAITING_PRICING', " +
    '0, NULL, NULL, NULL, NULL, 1, ?, ?) ON CONFLICT(subscription_id, cycle_start) DO NOTHING',
  ).bind(
    cycleId, merchantId, offer.subscriptionId, offer.subscriberId, offer.planId, offer.planVersion,
    cycleStart, cycleEnd, offer.billingInterval, offer.currency, offerSnapshotJson, now, now,
  ).run();
  const cycle = await readCycleByPeriod(env.D1_04, subscription.subscription_id, cycleStart);
  if (!cycle) throw new RenewalRuntimeError('SERVICE_UNAVAILABLE', 503);
  if (cycle.cycle_end !== cycleEnd || cycle.plan_id !== effectivePlanId ||
      cycle.plan_version !== effectivePlanVersion || cycle.subscriber_id !== subscription.subscriber_id) {
    throw new RenewalRuntimeError('CYCLE_IDENTITY_CONFLICT', 409);
  }
  return cycle;
}

async function readSchedulerCursor(db: D1Database): Promise<RenewalCursorRow> {
  const row = await db.prepare(
    "SELECT state_id, cursor_period_end, cursor_subscription_id, version, updated_at " +
    "FROM subscription_renewal_scheduler_state WHERE state_id = 'subscription-renewals' LIMIT 1",
  ).first<RenewalCursorRow>();
  if (!row) throw new RenewalRuntimeError('SCHEDULER_STATE_NOT_INITIALIZED', 503);
  if (!Number.isSafeInteger(row.version) || row.version < 1 ||
      !isCanonicalIso(row.updated_at) ||
      ((row.cursor_period_end === null) !== (row.cursor_subscription_id === null)) ||
      (row.cursor_period_end !== null && !isCanonicalIso(row.cursor_period_end)) ||
      (row.cursor_subscription_id !== null && !isBoundedText(row.cursor_subscription_id))) {
    throw new RenewalRuntimeError('SCHEDULER_STATE_INVALID', 503);
  }
  return row;
}

async function writeSchedulerCursor(
  db: D1Database,
  cursor: RenewalCursorRow,
  periodEnd: string | null,
  subscriptionId: string | null,
  now: string,
): Promise<boolean> {
  const result = await db.prepare(
    "UPDATE subscription_renewal_scheduler_state SET cursor_period_end = ?, cursor_subscription_id = ?, " +
    "version = version + 1, updated_at = ? WHERE state_id = 'subscription-renewals' AND version = ?",
  ).bind(periodEnd, subscriptionId, strictlyAfter(now, cursor.updated_at), cursor.version).run();
  return Number(result.meta?.changes ?? 0) === 1;
}

/**
 * W10-facing scan primitive. It creates a durable D1-04 cycle before emitting
 * its identifier to the existing async execution path. Re-enqueueing duplicates
 * is safe because (subscription_id, cycle_start) is unique and processing below
 * uses CAS leases plus stable Order/Payment idempotency keys.
 */
export async function scanDueSubscriptionRenewals(
  env: RenewalRuntimeEnv,
  options: Readonly<{ limit?: number }> = {},
  dependencies: RenewalRuntimeDependencies = {},
): Promise<RenewalScanResult> {
  const now = nowIso(dependencies.now ?? (() => new Date()));
  const config = resolveHyperswitchConfig(env);
  const limit = Number.isSafeInteger(options.limit) ? Math.min(Math.max(options.limit!, 1), MAX_PAGE_SIZE) : 20;
  const cursor = await readSchedulerCursor(env.D1_04);
  let rows: RenewalSubscriptionRow[];
  try {
    rows = (await env.D1_01.prepare(
      'SELECT s.subscription_id, s.subscriber_id, s.plan_id, s.plan_version, s.creator_id, s.status, ' +
      's.current_period_start, s.current_period_end, s.cancel_at, s.pending_plan_id, s.pending_plan_version, ' +
      's.pending_plan_effective_at, s.pending_plan_change_id, pv.billing_interval, pv.price_minor, ' +
      'pv.currency, pv.name, pv.tier, pv.benefits_json, pending_pv.billing_interval AS pending_billing_interval, ' +
      'pending_pv.price_minor AS pending_price_minor, pending_pv.currency AS pending_currency, ' +
      'pending_pv.name AS pending_name, pending_pv.tier AS pending_tier, pending_pv.benefits_json AS pending_benefits_json ' +
      'FROM membership_subscriptions s ' +
      'JOIN membership_plan_versions pv ON pv.plan_id = s.plan_id AND pv.plan_version = s.plan_version ' +
      'LEFT JOIN membership_plan_versions pending_pv ON pending_pv.plan_id = s.pending_plan_id AND pending_pv.plan_version = s.pending_plan_version ' +
      "WHERE s.status IN ('ACTIVE','PAST_DUE') AND s.current_period_end <= ? " +
      'AND (s.cancel_at IS NULL OR s.cancel_at > s.current_period_end) ' +
      'AND (? IS NULL OR s.current_period_end > ? OR (s.current_period_end = ? AND s.subscription_id > ?)) ' +
      'ORDER BY s.current_period_end ASC, s.subscription_id ASC LIMIT ?',
    ).bind(
      now, cursor.cursor_period_end, cursor.cursor_period_end, cursor.cursor_period_end,
      cursor.cursor_subscription_id, limit,
    ).all<RenewalSubscriptionRow>()).results ?? [];
  } catch {
    throw new RenewalRuntimeError('SERVICE_UNAVAILABLE', 503);
  }

  if (rows.length === 0) {
    if (cursor.cursor_period_end !== null && cursor.cursor_subscription_id !== null) {
      const reset = await writeSchedulerCursor(env.D1_04, cursor, null, null, now);
      return { scanned: 0, cycleIds: [], cursorAdvanced: false, cursorReset: reset };
    }
    return { scanned: 0, cycleIds: [], cursorAdvanced: false, cursorReset: false };
  }

  const cycleIds: string[] = [];
  for (const row of rows) {
    try {
      const cycle = await insertOrReadCycle(env, row, String(config.expectedMerchantId), now);
      if (cycle.state === 'AWAITING_PRICING' && dependencies.resolvePricing) {
        cycleIds.push(cycle.cycle_id);
      } else if (cycle.state === 'AWAITING_MANDATE') {
        const activeMandate = await readActiveMandate(
          env.D1_04, String(config.expectedMerchantId), cycle.subscriber_id,
        );
        if (activeMandate) cycleIds.push(cycle.cycle_id);
      } else if (cycle.state === 'FAILED' &&
        ['failed', 'expired'].includes(cycle.provider_response_status ?? '') &&
        cycle.subscription_sync_state === 'APPLIED' &&
        cycle.attempt_number < MAX_ATTEMPTS &&
        renewalRetryDue(cycle, now) &&
        await isExactMandateActive(env.D1_04, cycle)) {
        cycleIds.push(cycle.cycle_id);
      } else if (
        cycle.state === 'PREPARED' ||
        cycle.state === 'PAYMENT_READY' ||
        (cycle.state === 'SUBMITTING' && cycle.lease_expires_at !== null && cycle.lease_expires_at <= now)
      ) {
        cycleIds.push(cycle.cycle_id);
      }
    } catch (error) {
      console.error(JSON.stringify({
        event: 'membership.renewal.scan_candidate_failed',
        subscriptionId: row.subscription_id,
        errorCode: error instanceof RenewalRuntimeError ? error.code : 'DEPENDENCY_ERROR',
      }));
    }
  }
  const last = rows[rows.length - 1]!;
  const cursorAdvanced = await writeSchedulerCursor(
    env.D1_04, cursor, last.current_period_end, last.subscription_id, now,
  );
  return { scanned: rows.length, cycleIds: [...new Set(cycleIds)], cursorAdvanced, cursorReset: false };
}

type ChargeSubscriptionRow = Readonly<{
  subscription_id: string;
  subscriber_id: string;
  plan_id: string;
  plan_version: number;
  status: string;
  current_period_end: string;
  cancel_at: string | null;
  pending_plan_id: string | null;
  pending_plan_version: number | null;
  pending_plan_effective_at: string | null;
  pending_plan_change_id: string | null;
}>;

async function isSubscriptionChargeableForCycle(
  env: RenewalRuntimeEnv,
  cycle: RenewalCycleRow,
): Promise<boolean> {
  let subscription: ChargeSubscriptionRow | null;
  try {
    subscription = await env.D1_01.prepare(
      'SELECT subscription_id, subscriber_id, plan_id, plan_version, status, current_period_end, cancel_at, ' +
      'pending_plan_id, pending_plan_version, pending_plan_effective_at, pending_plan_change_id ' +
      'FROM membership_subscriptions WHERE subscription_id = ? AND subscriber_id = ? LIMIT 1',
    ).bind(cycle.subscription_id, cycle.subscriber_id).first<ChargeSubscriptionRow>();
  } catch {
    throw new RenewalRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  const retryingPastDue = cycle.outcome_code === 'RETRY_PREPARED' || cycle.attempt_number > 1;
  const matchesCurrentPlan = !!subscription && subscription.pending_plan_id === null &&
    subscription.plan_id === cycle.plan_id && subscription.plan_version === cycle.plan_version;
  const matchesScheduledPlan = !!subscription && subscription.pending_plan_id === cycle.plan_id &&
    subscription.pending_plan_version === cycle.plan_version &&
    subscription.pending_plan_effective_at === cycle.cycle_start &&
    typeof subscription.pending_plan_change_id === 'string' &&
    /^sps_[a-f0-9]{60}$/.test(subscription.pending_plan_change_id);
  return !!subscription &&
    subscription.subscription_id === cycle.subscription_id &&
    subscription.subscriber_id === cycle.subscriber_id &&
    (matchesCurrentPlan || matchesScheduledPlan) &&
    subscription.current_period_end === cycle.cycle_start &&
    (subscription.status === 'ACTIVE' || (retryingPastDue && subscription.status === 'PAST_DUE')) &&
    (subscription.cancel_at === null ||
      (isCanonicalIso(subscription.cancel_at) && subscription.cancel_at > cycle.cycle_start));
}

async function writeCycleReconciliation(
  db: D1Database,
  cycle: RenewalCycleRow,
  code: string,
  now: string,
): Promise<RenewalCycleRow> {
  return updateCycle(db, cycle, now,
    "state = 'RECONCILIATION_REQUIRED', outcome_code = ?, lease_token = NULL, lease_expires_at = NULL",
    [code],
  );
}

async function persistPricingDecision(
  env: RenewalRuntimeEnv,
  cycle: RenewalCycleRow,
  offer: RenewalOfferSnapshot,
  pricing: AuthoritativelyPricedOrder,
  now: string,
): Promise<RenewalCycleRow> {
  const decision = normalizePricingDecision(cycle, offer, pricing);
  if (decision.totalMinor === 0) {
    return updateCycle(env.D1_04, cycle, now,
      "amount_minor = 0, pricing_snapshot_json = ?, state = 'RECONCILIATION_REQUIRED', outcome_code = 'NON_POSITIVE_RENEWAL_TOTAL'",
      [JSON.stringify(decision.pricing)],
    );
  }
  const config = resolveHyperswitchConfig(env);
  const mandate = await readActiveMandate(env.D1_04, String(config.expectedMerchantId), cycle.subscriber_id);
  return updateCycle(
    env.D1_04,
    cycle,
    now,
    "amount_minor = ?, pricing_snapshot_json = ?, payment_method_id = ?, mandate_record_id = ?, state = ?, outcome_code = ?",
    [
      decision.totalMinor,
      JSON.stringify(decision.pricing),
      mandate?.payment_method_id ?? null,
      mandate?.mandate_record_id ?? null,
      mandate ? 'PREPARED' : 'AWAITING_MANDATE',
      mandate ? null : 'ACTIVE_MANDATE_REQUIRED',
    ],
  );
}

async function advanceAwaitingMandate(
  env: RenewalRuntimeEnv,
  cycle: RenewalCycleRow,
  now: string,
): Promise<RenewalCycleRow> {
  const config = resolveHyperswitchConfig(env);
  const mandate = await readActiveMandate(env.D1_04, String(config.expectedMerchantId), cycle.subscriber_id);
  if (!mandate) return cycle;
  return updateCycle(env.D1_04, cycle, now,
    "payment_method_id = ?, mandate_record_id = ?, state = 'PREPARED', outcome_code = NULL",
    [mandate.payment_method_id, mandate.mandate_record_id],
  );
}

async function storeOrderReference(
  env: RenewalRuntimeEnv,
  cycle: RenewalCycleRow,
  orderId: string,
  now: string,
): Promise<RenewalCycleRow> {
  return updateCycle(env.D1_04, cycle, now,
    'order_id = ?', [orderId],
  );
}

async function storePaymentReference(
  env: RenewalRuntimeEnv,
  cycle: RenewalCycleRow,
  payment: PaymentAttemptDto,
  attemptNumber: number,
  now: string,
): Promise<RenewalCycleRow> {
  return updateCycle(env.D1_04, cycle, now,
    'payment_id = ?, attempt_number = ?', [payment.paymentId, attemptNumber],
  );
}

async function transitionCycleToPaymentReady(
  env: RenewalRuntimeEnv,
  cycle: RenewalCycleRow,
  now: string,
): Promise<RenewalCycleRow> {
  const updated = await env.D1_04.prepare(
    "UPDATE subscription_renewal_cycles SET state = 'PAYMENT_READY', outcome_code = NULL, " +
    'version = version + 1, updated_at = ? WHERE cycle_id = ? AND version = ? AND state = ? ' +
    'AND order_id IS NOT NULL AND payment_id IS NOT NULL',
  ).bind(
    strictlyAfter(now, cycle.updated_at), cycle.cycle_id, cycle.version, cycle.state,
  ).run();
  if (Number(updated.meta?.changes ?? 0) === 1) return readCycleById(env.D1_04, cycle.cycle_id);
  return readCycleById(env.D1_04, cycle.cycle_id);
}

async function acquireSubmissionLease(
  env: RenewalRuntimeEnv,
  cycle: RenewalCycleRow,
  now: string,
  dependencies: RenewalRuntimeDependencies,
): Promise<RenewalCycleRow | null> {
  const nowMs = Date.parse(now);
  if (cycle.state === 'SUBMITTING' && cycle.lease_expires_at !== null &&
      Date.parse(cycle.lease_expires_at) > nowMs) return null;
  if (cycle.state !== 'PAYMENT_READY' && cycle.state !== 'SUBMITTING') return null;
  const leaseToken = (dependencies.createLeaseToken ?? defaultLeaseToken)();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(leaseToken)) throw new RenewalRuntimeError('INTEGRITY_VIOLATION', 500);
  const leaseExpiresAt = new Date(nowMs + LEASE_MS).toISOString();
  const result = await env.D1_04.prepare(
    "UPDATE subscription_renewal_cycles SET state = 'SUBMITTING', lease_token = ?, lease_expires_at = ?, " +
    'version = version + 1, updated_at = ? WHERE cycle_id = ? AND version = ? ' +
    "AND (state = 'PAYMENT_READY' OR (state = 'SUBMITTING' AND lease_expires_at <= ?))",
  ).bind(
    leaseToken, leaseExpiresAt, strictlyAfter(now, cycle.updated_at),
    cycle.cycle_id, cycle.version, now,
  ).run();
  if (Number(result.meta?.changes ?? 0) !== 1) return null;
  return readCycleById(env.D1_04, cycle.cycle_id);
}

type FailedCycleRetryPreparation = 'PREPARED' | 'AWAITING_RETRY' | 'AWAITING_OUTCOME_SYNC' | 'TERMINAL';

async function prepareFailedCycleRetry(
  env: RenewalRuntimeEnv,
  cycle: RenewalCycleRow,
  now: string,
): Promise<FailedCycleRetryPreparation> {
  if (cycle.state !== 'FAILED') return 'TERMINAL';
  if (cycle.subscription_sync_state !== 'APPLIED') return 'AWAITING_OUTCOME_SYNC';
  if (!['failed', 'expired'].includes(cycle.provider_response_status ?? '') ||
      cycle.attempt_number >= MAX_ATTEMPTS) return 'TERMINAL';
  if (!renewalRetryDue(cycle, now)) return 'AWAITING_RETRY';

  let subscription: {
    subscription_id: string; subscriber_id: string; plan_id: string; plan_version: number;
    status: string; current_period_end: string; cancel_at: string | null;
    pending_plan_id: string | null; pending_plan_version: number | null;
    pending_plan_effective_at: string | null; pending_plan_change_id: string | null;
  } | null;
  try {
    subscription = await env.D1_01.prepare(
      'SELECT subscription_id, subscriber_id, plan_id, plan_version, status, current_period_end, cancel_at ' +
      'FROM membership_subscriptions WHERE subscription_id = ? AND subscriber_id = ? LIMIT 1',
    ).bind(cycle.subscription_id, cycle.subscriber_id).first<{
      subscription_id: string;
      subscriber_id: string;
      plan_id: string;
      plan_version: number;
      status: string;
      current_period_end: string;
      cancel_at: string | null;
    }>();
  } catch {
    throw new RenewalRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  const matchesCurrentPlan = !!subscription && subscription.pending_plan_id === null &&
    subscription.plan_id === cycle.plan_id && subscription.plan_version === cycle.plan_version;
  const matchesScheduledPlan = !!subscription && subscription.pending_plan_id === cycle.plan_id &&
    subscription.pending_plan_version === cycle.plan_version &&
    subscription.pending_plan_effective_at === cycle.cycle_start &&
    typeof subscription.pending_plan_change_id === 'string' &&
    /^sps_[a-f0-9]{60}$/.test(subscription.pending_plan_change_id);
  if (!subscription ||
      subscription.subscription_id !== cycle.subscription_id ||
      subscription.subscriber_id !== cycle.subscriber_id ||
      !(matchesCurrentPlan || matchesScheduledPlan) ||
      subscription.status !== 'PAST_DUE' ||
      subscription.current_period_end !== cycle.cycle_start ||
      (subscription.cancel_at !== null &&
        (!isCanonicalIso(subscription.cancel_at) || subscription.cancel_at <= cycle.cycle_start))) {
    return 'TERMINAL';
  }
  // A retry may reuse only the exact same still-active saved method/mandate.
  // A revoked mandate requires a new customer-present consent flow and is never
  // silently replaced with another token during off-session recovery.
  if (!(await isExactMandateActive(env.D1_04, cycle))) return 'TERMINAL';

  const retryCutoff = new Date(Date.parse(now) - renewalRetryDelayMs(cycle.attempt_number)).toISOString();
  const updatedAt = strictlyAfter(now, cycle.updated_at);
  let result: D1Result;
  try {
    result = await env.D1_04.prepare(
      "UPDATE subscription_renewal_cycles SET state = 'PREPARED', payment_id = NULL, " +
      "provider_response_status = NULL, outcome_code = 'RETRY_PREPARED', " +
      "subscription_sync_state = 'PENDING', subscription_sync_updated_at = NULL, subscription_sync_error_code = NULL, " +
      'lease_token = NULL, lease_expires_at = NULL, version = version + 1, updated_at = ? ' +
      "WHERE cycle_id = ? AND version = ? AND state = 'FAILED' AND subscription_sync_state = 'APPLIED' " +
      'AND attempt_number < ? AND updated_at <= ?',
    ).bind(updatedAt, cycle.cycle_id, cycle.version, MAX_ATTEMPTS, retryCutoff).run();
  } catch {
    throw new RenewalRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  if (Number(result.meta?.changes ?? 0) === 1) return 'PREPARED';
  const latest = await readCycleById(env.D1_04, cycle.cycle_id);
  if (latest.state === 'PREPARED') return 'PREPARED';
  if (latest.state === 'FAILED' && latest.subscription_sync_state !== 'APPLIED') return 'AWAITING_OUTCOME_SYNC';
  return 'AWAITING_RETRY';
}

/**
 * Prepare a bounded, idempotent retry after a durable failed-cycle outcome was
 * synchronized to D1-01. The caller still separately invokes processSubscriptionRenewalCycle
 * after this function returns PREPARED; retry preparation alone never charges a provider.
 */
export async function prepareFailedRenewalCycleRetry(
  env: RenewalRuntimeEnv,
  cycleIdInput: string,
  dependencies: Pick<RenewalRuntimeDependencies, 'now'> = {},
): Promise<RenewalProcessResult> {
  if (!/^rcy_[A-Za-z0-9]{26}$/.test(cycleIdInput)) {
    throw new RenewalRuntimeError('VALIDATION_FAILED', 400);
  }
  const now = nowIso(dependencies.now ?? (() => new Date()));
  const cycle = await readCycleById(env.D1_04, cycleIdInput);
  const preparation = await prepareFailedCycleRetry(env, cycle, now);
  const latest = preparation === 'PREPARED'
    ? await readCycleById(env.D1_04, cycleIdInput)
    : cycle;
  const action = preparation === 'PREPARED'
    ? 'PREPARED'
    : preparation === 'AWAITING_OUTCOME_SYNC'
      ? 'AWAITING_OUTCOME_SYNC'
      : preparation === 'AWAITING_RETRY'
        ? 'AWAITING_RETRY'
        : 'TERMINAL';
  return {
    cycleId: cycleIdInput,
    state: latest.state,
    action,
    ...(latest.payment_id ? { paymentId: latest.payment_id } : {}),
  };
}

/**
 * Processes one durable cycle. It cannot start a provider charge without both an
 * admitted price/tax decision and a currently-active customer-bound mandate.
 * Payment success/entitlement are not inferred from the synchronous API response.
 */
export async function processSubscriptionRenewalCycle(
  env: RenewalRuntimeEnv,
  cycleId: string,
  dependencies: RenewalRuntimeDependencies = {},
): Promise<RenewalProcessResult> {
  const nowFn = dependencies.now ?? (() => new Date());
  let now = nowIso(nowFn);
  let cycle = await readCycleById(env.D1_04, cycleId);
  if (cycle.state === 'FAILED') {
    const retry = await prepareFailedCycleRetry(env, cycle, now);
    if (retry !== 'PREPARED') {
      const action = retry === 'AWAITING_OUTCOME_SYNC'
        ? 'AWAITING_OUTCOME_SYNC'
        : retry === 'AWAITING_RETRY'
          ? 'AWAITING_RETRY'
          : 'TERMINAL';
      return { cycleId, state: cycle.state, action, ...(cycle.payment_id ? { paymentId: cycle.payment_id } : {}) };
    }
    cycle = await readCycleById(env.D1_04, cycleId);
  }
  if (cycle.state === 'SUCCEEDED' || cycle.state === 'SUBMITTED' ||
      cycle.state === 'RECONCILIATION_REQUIRED') {
    return { cycleId, state: cycle.state, action: 'TERMINAL', ...(cycle.payment_id ? { paymentId: cycle.payment_id } : {}) };
  }

  let offer = parseOfferSnapshot(cycle.offer_snapshot_json);
  if (cycle.state === 'AWAITING_PRICING') {
    if (!dependencies.resolvePricing) {
      return { cycleId, state: cycle.state, action: 'AWAITING_PRICING' };
    }
    const request: CreateCommerceOrderRequest = { items: [{ itemRef: cycle.plan_id, quantity: 1 }] };
    let resolved: AuthoritativelyPricedOrder;
    try {
      resolved = await dependencies.resolvePricing({ cycle, offer, request });
    } catch {
      return { cycleId, state: cycle.state, action: 'AWAITING_PRICING' };
    }
    cycle = await persistPricingDecision(env, cycle, offer, resolved, now);
    if (cycle.state === 'RECONCILIATION_REQUIRED') {
      return { cycleId, state: cycle.state, action: 'RECONCILIATION_REQUIRED' };
    }
  }

  if (cycle.state === 'AWAITING_MANDATE') {
    cycle = await advanceAwaitingMandate(env, cycle, now);
    if (cycle.state === 'AWAITING_MANDATE') {
      return { cycleId, state: cycle.state, action: 'AWAITING_MANDATE' };
    }
  }

  if (cycle.state === 'PREPARED') {
    offer = parseOfferSnapshot(cycle.offer_snapshot_json);
    if (!cycle.pricing_snapshot_json || !isSafeMinor(cycle.amount_minor, false) ||
        !cycle.payment_method_id || !cycle.mandate_record_id) {
      cycle = await writeCycleReconciliation(env.D1_04, cycle, 'PREPARED_SNAPSHOT_INCOMPLETE', now);
      return { cycleId, state: cycle.state, action: 'RECONCILIATION_REQUIRED' };
    }
    if (!(await isSubscriptionChargeableForCycle(env, cycle))) {
      cycle = await writeCycleReconciliation(env.D1_04, cycle, 'SUBSCRIPTION_NOT_CHARGEABLE_BEFORE_ORDER', now);
      return { cycleId, state: cycle.state, action: 'RECONCILIATION_REQUIRED' };
    }
    if (!(await isExactMandateActive(env.D1_04, cycle))) {
      cycle = await writeCycleReconciliation(env.D1_04, cycle, 'MANDATE_NOT_ACTIVE', now);
      return { cycleId, state: cycle.state, action: 'RECONCILIATION_REQUIRED' };
    }
    const pricing = parsePricingSnapshot(cycle.pricing_snapshot_json);
    const rawRequest: CreateCommerceOrderRequest = { items: [{ itemRef: cycle.plan_id, quantity: 1 }] };

    if (!cycle.order_id) {
      const createOrder = dependencies.createOrder ?? createCommerceOrder;
      const order = await createOrder(
        env.D1_04,
        cycle.subscriber_id,
        'renew_' + cycle.cycle_id,
        rawRequest,
        async () => pricing,
        {
          now: nowFn,
          idempotencyExpiresAt: PERMANENT_ORDER_IDEMPOTENCY_EXPIRY,
          createId: (kind) => {
            const suffix = cycle.cycle_id.slice(4);
            return (kind === 'order' ? 'ord_renew_' : kind === 'line' ? 'line_renew_' : 'idem_renew_') + suffix;
          },
        },
      );
      cycle = await storeOrderReference(env, cycle, order.data.orderId, now);
      if (cycle.order_id !== order.data.orderId) {
        throw new RenewalRuntimeError('CYCLE_ORDER_REFERENCE_CONFLICT', 409);
      }
    }

    if (!cycle.payment_id) {
      if (cycle.attempt_number >= MAX_ATTEMPTS) {
        cycle = await writeCycleReconciliation(env.D1_04, cycle, 'PAYMENT_ATTEMPT_LIMIT_REACHED', now);
        return { cycleId, state: cycle.state, action: 'RECONCILIATION_REQUIRED' };
      }
      const attemptNumber = cycle.attempt_number + 1;
      const createAttempt = dependencies.createPaymentAttempt ?? createPaymentAttempt;
      const attempt = await createAttempt(
        env.D1_04,
        cycle.subscriber_id,
        cycle.order_id!,
        'renew_' + cycle.cycle_id + '_' + String(attemptNumber),
        cycle.merchant_id,
        { now: nowFn },
      );
      cycle = await storePaymentReference(env, cycle, attempt.payment, attemptNumber, now);
      if (cycle.payment_id !== attempt.payment.paymentId || cycle.attempt_number !== attemptNumber) {
        throw new RenewalRuntimeError('CYCLE_PAYMENT_REFERENCE_CONFLICT', 409);
      }
    }
    cycle = await transitionCycleToPaymentReady(env, cycle, now);
  }

  if (cycle.state === 'PAYMENT_READY' || cycle.state === 'SUBMITTING') {
    if (!(await isExactMandateActive(env.D1_04, cycle))) {
      cycle = await writeCycleReconciliation(env.D1_04, cycle, 'MANDATE_NOT_ACTIVE_AT_SUBMISSION', now);
      return { cycleId, state: cycle.state, action: 'RECONCILIATION_REQUIRED' };
    }
    let leased: RenewalCycleRow | null;
    try {
      leased = await acquireSubmissionLease(env, cycle, now, dependencies);
    } catch {
      throw new RenewalRuntimeError('SERVICE_UNAVAILABLE', 503);
    }
    if (!leased) {
      cycle = await readCycleById(env.D1_04, cycleId);
      return { cycleId, state: cycle.state, action: 'SUBMISSION_IN_PROGRESS', ...(cycle.payment_id ? { paymentId: cycle.payment_id } : {}) };
    }
    cycle = leased;
    const config = resolveHyperswitchConfig(env);
    const payment = await env.D1_04.prepare(
      'SELECT payment_id, order_id, customer_id, provider, merchant_id, amount_minor, currency, status, version, ' +
      'idempotency_key, request_hash, provider_updated_at, failure_code, created_at, updated_at ' +
      'FROM payments WHERE payment_id = ? AND customer_id = ? LIMIT 1',
    ).bind(cycle.payment_id, cycle.subscriber_id).first<{
      payment_id: string; order_id: string; customer_id: string; provider: string; merchant_id: string;
      amount_minor: number; currency: string; status: PaymentAttemptDto['status']; version: number;
      idempotency_key: string; request_hash: string; provider_updated_at: string | null;
      failure_code: string | null; created_at: string; updated_at: string;
    }>();
    if (!payment || payment.merchant_id !== cycle.merchant_id || payment.provider !== PROVIDER ||
        payment.order_id !== cycle.order_id || payment.amount_minor !== cycle.amount_minor ||
        payment.currency !== cycle.currency) {
      cycle = await writeCycleReconciliation(env.D1_04, cycle, 'PAYMENT_ATTEMPT_BINDING_MISMATCH', now);
      return { cycleId, state: cycle.state, action: 'RECONCILIATION_REQUIRED' };
    }

    if (payment.status !== 'INITIATING') {
      if (['failed', 'cancelled', 'expired', 'cancelled_post_capture'].includes(payment.status)) {
        cycle = await writeCycleReconciliation(env.D1_04, cycle, 'PAYMENT_ALREADY_TERMINAL_WITHOUT_CYCLE_RESULT', now);
        return { cycleId, state: cycle.state, action: 'RECONCILIATION_REQUIRED' };
      }
      now = nowIso(nowFn);
      cycle = await updateCycle(env.D1_04, cycle, now,
        "state = 'SUBMITTED', provider_response_status = 'processing', outcome_code = 'RECOVERED_SUBMISSION_RESPONSE_UNKNOWN', lease_token = NULL, lease_expires_at = NULL",
        [],
      );
      return { cycleId, state: cycle.state, action: 'SUBMITTED', ...(cycle.payment_id ? { paymentId: cycle.payment_id } : {}) };
    }

    if (!(await isSubscriptionChargeableForCycle(env, cycle))) {
      cycle = await writeCycleReconciliation(env.D1_04, cycle, 'SUBSCRIPTION_NOT_CHARGEABLE_AT_SUBMISSION', now);
      return { cycleId, state: cycle.state, action: 'RECONCILIATION_REQUIRED' };
    }

    const createCharge = dependencies.createProviderCharge ?? createHyperswitchMerchantInitiatedPayment;
    let providerPayment: HyperswitchPayment;
    try {
      providerPayment = await createCharge(config, {
        paymentId: cycle.payment_id!,
        amount: cycle.amount_minor!,
        currency: cycle.currency,
        idempotencyKey: 'lr_' + cycle.payment_id!,
        customerId: cycle.subscriber_id,
        paymentMethodId: cycle.payment_method_id!,
      });
    } catch (error) {
      now = nowIso(nowFn);
      cycle = await writeCycleReconciliation(
        env.D1_04,
        cycle,
        error instanceof HyperswitchClientError ? 'PROVIDER_SUBMISSION_UNCERTAIN' : 'PROVIDER_SUBMISSION_DEPENDENCY_ERROR',
        now,
      );
      return { cycleId, state: cycle.state, action: 'RECONCILIATION_REQUIRED', ...(cycle.payment_id ? { paymentId: cycle.payment_id } : {}) };
    }

    const recordSubmission = dependencies.recordProviderSubmission ?? recordHyperswitchMerchantInitiatedSubmission;
    try {
      await recordSubmission(
        env.D1_04,
        cycle.subscriber_id,
        cycle.payment_id!,
        cycle.merchant_id,
        cycle.payment_method_id!,
        providerPayment,
        { now: nowFn },
      );
    } catch {
      now = nowIso(nowFn);
      cycle = await writeCycleReconciliation(env.D1_04, cycle, 'PROVIDER_RESPONSE_NOT_DURABLY_RECORDED', now);
      return { cycleId, state: cycle.state, action: 'RECONCILIATION_REQUIRED', ...(cycle.payment_id ? { paymentId: cycle.payment_id } : {}) };
    }

    now = nowIso(nowFn);
    const latest = await readCycleById(env.D1_04, cycleId);
    if (latest.state === 'SUCCEEDED' || latest.state === 'FAILED' ||
        latest.state === 'RECONCILIATION_REQUIRED') {
      return { cycleId, state: latest.state, action: 'TERMINAL', ...(latest.payment_id ? { paymentId: latest.payment_id } : {}) };
    }
    cycle = await updateCycle(env.D1_04, latest, now,
      "state = 'SUBMITTED', provider_response_status = ?, outcome_code = 'AWAITING_SIGNED_WEBHOOK', lease_token = NULL, lease_expires_at = NULL",
      [providerPayment.status],
    );
    return { cycleId, state: cycle.state, action: 'SUBMITTED', ...(cycle.payment_id ? { paymentId: cycle.payment_id } : {}) };
  }

  return { cycleId, state: cycle.state, action: cycle.state === 'RECONCILIATION_REQUIRED' ? 'RECONCILIATION_REQUIRED' : 'PREPARED', ...(cycle.payment_id ? { paymentId: cycle.payment_id } : {}) };
}
