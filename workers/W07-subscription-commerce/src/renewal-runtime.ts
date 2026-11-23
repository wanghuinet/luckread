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
  type PaymentAttemptDto,
  type PaymentAttemptCreation,
} from './payment-contracts.js';
import {
  createPaymentAttemptPostgres,
  recordHyperswitchMerchantInitiatedSubmissionPostgres,
} from './payment-intent-postgres-persistence.js';
import {
  getScheduledPlanChangeStore,
  readScheduledSubscriptionPlanDowngradeForPeriod,
  readScheduledDowngradeTargetPlan,
} from './subscription-plan-change-schedule.js';
import {
  createHyperswitchMerchantInitiatedPayment,
  HyperswitchClientError,
  type HyperswitchClientConfig,
  type HyperswitchPayment,
  type HyperswitchPaymentStatus,
} from './hyperswitch-client.js';
import type { CreateCommerceOrderRequest } from './order-request-validation.js';
import {
  getW07OrderCreatePersistenceStore,
  getW07PaymentWebhookPostgresPool,
  type W07PaymentMethodReadRuntimeEnv,
} from './neon/payment-method-read-runtime.js';
import type { OrderCreatePersistenceStore } from './order-persistence.js';
import { getW07MembershipPostgresPool, type W07MembershipDatabaseRuntimeEnv } from './neon/membership-database-runtime.js';
import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js';
import { readRenewalPaymentAttemptPostgres, type RenewalPaymentAttemptRow } from './renewal-payment-postgres.js';
import {
  isExactRenewalMandateActivePostgres,
  readActiveRenewalMandatePostgres,
} from './payment-method-read-store-postgres.js';
import {
  getW07RenewalCycleStore,
  readRenewalCycleByIdPostgres,
  readRenewalCycleByPeriodPostgres,
  readRenewalSchedulerCursorPostgres,
  writeRenewalSchedulerCursorPostgres,
  insertRenewalCyclePostgres,
  updateRenewalCyclePostgres,
  transitionRenewalCycleToPaymentReadyPostgres,
  acquireRenewalSubmissionLeasePostgres,
  retryFailedRenewalCyclePostgres,
  type RenewalCycleRow,
  type RenewalCycleState,
  type RenewalCycleStore,
  type RenewalCursorRow,
} from './renewal-cycle-postgres.js';
import {
  readDueRenewalMembershipsPostgres,
  readRenewalChargeSubscriptionPostgres,
  type RenewalMembershipCandidateRow,
  type RenewalChargeSubscriptionRow,
} from './renewal-membership-postgres.js';

type RenewalMembershipStore = W07WebhookPostgresPool;

function getRenewalMembershipStore(
  env: RenewalRuntimeEnv,
  dependencies: Pick<RenewalRuntimeDependencies, 'getMembershipPostgresPool'> = {},
): RenewalMembershipStore {
  try {
    return (dependencies.getMembershipPostgresPool ?? getW07MembershipPostgresPool)(env);
  } catch {
    throw new RenewalRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
}
export class RenewalRuntimeError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = 'RenewalRuntimeError';
  }
}

export type RenewalRuntimeEnv = W07PaymentMethodReadRuntimeEnv & W07MembershipDatabaseRuntimeEnv & Readonly<{
  HYPERSWITCH_ENVIRONMENT?: string | null;
  HYPERSWITCH_API_KEY?: string | null;
  HYPERSWITCH_MERCHANT_ID?: string | null;
}>;

type RenewalSubscriptionRow = RenewalMembershipCandidateRow;

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
  createPaymentAttemptPostgres?: typeof createPaymentAttemptPostgres;
  createProviderCharge?: typeof createHyperswitchMerchantInitiatedPayment;
  recordProviderSubmissionPostgres?: typeof recordHyperswitchMerchantInitiatedSubmissionPostgres;
  getFinancePostgresPool?: (env: RenewalRuntimeEnv) => W07WebhookPostgresPool | undefined;
  getMembershipPostgresPool?: (env: RenewalRuntimeEnv) => W07WebhookPostgresPool;
  getRenewalCycleStore?: (env: RenewalRuntimeEnv) => RenewalCycleStore;
  getOrderCreateStore?: (env: RenewalRuntimeEnv) => OrderCreatePersistenceStore | undefined;
}>;

/**
 * Create the Payment attempt for a durable renewal cycle through the native Neon finance Store.
 */
export async function createRenewalPaymentAttempt(
  env: RenewalRuntimeEnv,
  customerId: string,
  orderId: string,
  idempotencyKey: string,
  merchantId: string,
  dependencies: RenewalRuntimeDependencies = {},
): Promise<PaymentAttemptCreation> {
  let pool: W07WebhookPostgresPool | undefined;
  try {
    pool = (dependencies.getFinancePostgresPool ?? getW07PaymentWebhookPostgresPool)(env);
  } catch {
    throw new RenewalRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  if (!pool) throw new RenewalRuntimeError('SERVICE_UNAVAILABLE', 503);
  const create = dependencies.createPaymentAttemptPostgres ?? createPaymentAttemptPostgres;
  const paymentEnvironment = env.HYPERSWITCH_ENVIRONMENT === 'sandbox' ||
    env.HYPERSWITCH_ENVIRONMENT === 'production'
    ? env.HYPERSWITCH_ENVIRONMENT
    : undefined;
  return create(pool, customerId, orderId, idempotencyKey, merchantId, {
    now: dependencies.now,
    paymentEnvironment,
  });
}

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

async function readCycleById(db: RenewalCycleStore, cycleId: string): Promise<RenewalCycleRow> {
  try {
    const row = await readRenewalCycleByIdPostgres(db, cycleId);
    if (!row) throw new RenewalRuntimeError('RESOURCE_NOT_FOUND', 404);
    return row;
  } catch (error) {
    if (error instanceof RenewalRuntimeError) throw error;
    throw new RenewalRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
}

async function readCycleByPeriod(
  db: RenewalCycleStore,
  subscriptionId: string,
  cycleStart: string,
): Promise<RenewalCycleRow | null> {
  try {
    return await readRenewalCycleByPeriodPostgres(db, subscriptionId, cycleStart);
  } catch {
    throw new RenewalRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
}

async function readActiveMandate(
  db: W07WebhookPostgresPool,
  merchantId: string,
  customerId: string,
): Promise<ActiveMandateRow | null> {
  // PAY-007 guard: the PostgreSQL adapter excludes any payment_method_revocation_requests
  // row where r.status <> 'COMPLETED' before returning an active off-session mandate.
  try {
    return await readActiveRenewalMandatePostgres(db, merchantId, customerId);
  } catch {
    throw new RenewalRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
}

async function isExactMandateActive(
  db: W07WebhookPostgresPool,
  cycle: RenewalCycleRow,
): Promise<boolean> {
  if (!cycle.mandate_record_id || !cycle.payment_method_id) return false;
  // PAY-007 guard: exact-tuple revalidation also excludes payment_method_revocation_requests
  // rows where r.status <> 'COMPLETED' immediately before MIT submission.
  try {
    return await isExactRenewalMandateActivePostgres(
      db, cycle.mandate_record_id, cycle.merchant_id, cycle.subscriber_id, cycle.payment_method_id,
    );
  } catch {
    throw new RenewalRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
}

async function readActiveMandateFromStore(
  db: RenewalCycleStore,
  merchantId: string,
  customerId: string,
): Promise<ActiveMandateRow | null> {
  return readActiveMandate(db, merchantId, customerId);
}

async function isExactMandateActiveFromStore(
  db: RenewalCycleStore,
  cycle: RenewalCycleRow,
): Promise<boolean> {
  if (!cycle.mandate_record_id || !cycle.payment_method_id) return false;
  return isExactMandateActive(db, cycle);
}

async function updateCycle(
  db: RenewalCycleStore,
  cycle: RenewalCycleRow,
  now: string,
  assignments: string,
  values: unknown[],
): Promise<RenewalCycleRow> {
  const updatedAt = strictlyAfter(now, cycle.updated_at);
  try {
    const updated = await updateRenewalCyclePostgres(db, cycle, updatedAt, assignments, values);
    if (!updated) throw new RenewalRuntimeError('SERVICE_UNAVAILABLE', 503);
    return updated;
  } catch (error) {
    if (error instanceof RenewalRuntimeError) throw error;
    throw new RenewalRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
}

async function insertOrReadCycle(
  membershipStore: RenewalMembershipStore,
  cycleStore: RenewalCycleStore,
  subscription: RenewalSubscriptionRow,
  merchantId: string,
  now: string,
): Promise<RenewalCycleRow> {
  if (!['TRIALING', 'ACTIVE', 'PAST_DUE'].includes(subscription.status) ||
      !isBoundedText(subscription.subscription_id) ||
      !isBoundedText(subscription.subscriber_id) ||
      !isBoundedText(subscription.plan_id) ||
      !Number.isSafeInteger(subscription.plan_version) || subscription.plan_version < 1 ||
      !isCanonicalIso(subscription.current_period_end) ||
      !isCanonicalIso(subscription.current_period_start) ||
      (subscription.status === 'TRIALING' &&
        (!isCanonicalIso(subscription.trial_started_at) ||
         !isCanonicalIso(subscription.trial_ends_at) ||
         subscription.trial_ends_at !== subscription.current_period_end ||
         subscription.current_period_start !== subscription.trial_started_at)) ||
      (subscription.billing_interval !== 'MONTHLY' && subscription.billing_interval !== 'YEARLY') ||
      !isSafeMinor(subscription.price_minor, true) ||
      typeof subscription.currency !== 'string' || !/^[A-Z]{3}$/.test(subscription.currency)) {
    throw new RenewalRuntimeError('SUBSCRIPTION_SNAPSHOT_INVALID', 503);
  }
  const cycleStart = subscription.current_period_end;
  const scheduledChange = await readScheduledSubscriptionPlanDowngradeForPeriod(
    membershipStore, subscription.subscription_id, subscription.subscriber_id, cycleStart, false,
  );
  let cyclePlan: {
    planId: string;
    planVersion: number;
    name: string;
    tier: string;
    billingInterval: 'MONTHLY' | 'YEARLY';
    priceMinor: number;
    currency: string;
    benefitsJson: string;
  } = {
    planId: subscription.plan_id,
    planVersion: subscription.plan_version,
    name: subscription.name,
    tier: subscription.tier,
    billingInterval: subscription.billing_interval as 'MONTHLY' | 'YEARLY',
    priceMinor: subscription.price_minor,
    currency: subscription.currency,
    benefitsJson: subscription.benefits_json,
  };
  if (scheduledChange) {
    if (scheduledChange.status !== 'SCHEDULED' ||
        scheduledChange.expectedPlanId !== subscription.plan_id ||
        scheduledChange.expectedPlanVersion !== subscription.plan_version ||
        scheduledChange.effectiveAt !== cycleStart) {
      throw new RenewalRuntimeError('SCHEDULED_PLAN_CHANGE_MISMATCH', 503);
    }
    const target = await readScheduledDowngradeTargetPlan(membershipStore, scheduledChange);
    const validChangeType = scheduledChange.changeType === 'DOWNGRADE'
      ? target?.billingInterval === subscription.billing_interval &&
        target.priceMinor < subscription.price_minor
      : scheduledChange.changeType === 'BILLING_INTERVAL_CHANGE'
        ? target?.billingInterval !== subscription.billing_interval && target?.tier === subscription.tier
        : false;
    if (!target || target.creatorId !== subscription.creator_id ||
        !validChangeType || target.currency !== subscription.currency) {
      throw new RenewalRuntimeError('SCHEDULED_PLAN_TARGET_INVALID', 503);
    }
    cyclePlan = {
      planId: target.planId,
      planVersion: target.planVersion,
      name: target.name,
      tier: target.tier,
      billingInterval: target.billingInterval,
      priceMinor: target.priceMinor,
      currency: target.currency,
      benefitsJson: JSON.stringify(target.benefits),
    };
  }
  // The cycle's immutable target offer controls both its charge and the next
  // period length. This is required for MONTHLY <-> YEARLY changes; the
  // existing active period remains untouched until this renewal succeeds.
  const cycleEnd = addBillingPeriod(cycleStart, cyclePlan.billingInterval as 'MONTHLY' | 'YEARLY');
  const cycleId = await renewalCycleIdFor(subscription.subscription_id, cycleStart, cycleEnd);

  // PAST_DUE may only resume a previously recorded cycle; never synthesize a
  // second cycle to "repair" a missing paid-cycle record.
  if (subscription.status === 'PAST_DUE') {
    const existing = await readCycleByPeriod(cycleStore, subscription.subscription_id, cycleStart);
    if (!existing || existing.cycle_id !== cycleId || existing.cycle_end !== cycleEnd ||
        existing.plan_id !== cyclePlan.planId || existing.plan_version !== cyclePlan.planVersion ||
        existing.subscriber_id !== subscription.subscriber_id) {
      throw new RenewalRuntimeError('PAST_DUE_CYCLE_MISSING_OR_MISMATCHED', 503);
    }
    return existing;
  }

  let benefits: unknown;
  try {
    benefits = JSON.parse(cyclePlan.benefitsJson) as unknown;
  } catch {
    throw new RenewalRuntimeError('SUBSCRIPTION_SNAPSHOT_INVALID', 503);
  }
  if (!Array.isArray(benefits) || benefits.length > 20 ||
      benefits.some((item) => typeof item !== 'string' || item.length < 1 || item.length > 180) ||
      new Set(benefits).size !== benefits.length) {
    throw new RenewalRuntimeError('SUBSCRIPTION_SNAPSHOT_INVALID', 503);
  }
  const offer: RenewalOfferSnapshot = {
    subscriptionId: subscription.subscription_id,
    subscriberId: subscription.subscriber_id,
    creatorId: subscription.creator_id,
    planId: cyclePlan.planId,
    planVersion: cyclePlan.planVersion,
    name: cyclePlan.name,
    tier: cyclePlan.tier,
    billingInterval: cyclePlan.billingInterval as 'MONTHLY' | 'YEARLY',
    priceMinor: cyclePlan.priceMinor,
    currency: cyclePlan.currency,
    benefits: benefits as string[],
  };
  const offerSnapshotJson = JSON.stringify(offer);
  try {
    await insertRenewalCyclePostgres(cycleStore, {
      cycleId,
      merchantId,
      subscriptionId: offer.subscriptionId,
      subscriberId: offer.subscriberId,
      planId: offer.planId,
      planVersion: offer.planVersion,
      cycleStart,
      cycleEnd,
      billingInterval: offer.billingInterval,
      currency: offer.currency,
      offerSnapshotJson,
      now,
    });
  } catch {
    throw new RenewalRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  const cycle = await readCycleByPeriod(cycleStore, subscription.subscription_id, cycleStart);
  if (!cycle) throw new RenewalRuntimeError('SERVICE_UNAVAILABLE', 503);
  if (cycle.cycle_end !== cycleEnd || cycle.plan_id !== cyclePlan.planId ||
      cycle.plan_version !== cyclePlan.planVersion || cycle.subscriber_id !== subscription.subscriber_id) {
    throw new RenewalRuntimeError('CYCLE_IDENTITY_CONFLICT', 409);
  }
  return cycle;
}

async function readSchedulerCursor(db: RenewalCycleStore): Promise<RenewalCursorRow> {
  let row: RenewalCursorRow | null;
  try {
    row = await readRenewalSchedulerCursorPostgres(db);
  } catch {
    throw new RenewalRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
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
  db: RenewalCycleStore,
  cursor: RenewalCursorRow,
  periodEnd: string | null,
  subscriptionId: string | null,
  now: string,
): Promise<boolean> {
  const updatedAt = strictlyAfter(now, cursor.updated_at);
  try {
    return await writeRenewalSchedulerCursorPostgres(db, cursor, periodEnd, subscriptionId, updatedAt);
  } catch {
    throw new RenewalRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
}

/**
 * W10-facing scan primitive. It creates a durable Neon finance cycle before emitting
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
  const cycleStore = (dependencies.getRenewalCycleStore ?? getW07RenewalCycleStore)(env);
  const cursor = await readSchedulerCursor(cycleStore);
  const membershipStore = getRenewalMembershipStore(env, dependencies);
  let rows: RenewalSubscriptionRow[];
  try {
    rows = await readDueRenewalMembershipsPostgres(
      membershipStore, now, cursor.cursor_period_end, cursor.cursor_subscription_id, limit,
    );
  } catch {
    throw new RenewalRuntimeError('SERVICE_UNAVAILABLE', 503);
  }

  if (rows.length === 0) {
    if (cursor.cursor_period_end !== null && cursor.cursor_subscription_id !== null) {
      const reset = await writeSchedulerCursor(cycleStore, cursor, null, null, now);
      return { scanned: 0, cycleIds: [], cursorAdvanced: false, cursorReset: reset };
    }
    return { scanned: 0, cycleIds: [], cursorAdvanced: false, cursorReset: false };
  }

  const cycleIds: string[] = [];
  for (const row of rows) {
    try {
      const cycle = await insertOrReadCycle(membershipStore, cycleStore, row, String(config.expectedMerchantId), now);
      if (cycle.state === 'AWAITING_PRICING' && dependencies.resolvePricing) {
        cycleIds.push(cycle.cycle_id);
      } else if (cycle.state === 'AWAITING_MANDATE') {
        const activeMandate = await readActiveMandateFromStore(
          cycleStore, String(config.expectedMerchantId), cycle.subscriber_id,
        );
        if (activeMandate) cycleIds.push(cycle.cycle_id);
      } else if (cycle.state === 'FAILED' &&
        ['failed', 'expired'].includes(cycle.provider_response_status ?? '') &&
        cycle.subscription_sync_state === 'APPLIED' &&
        cycle.attempt_number < MAX_ATTEMPTS &&
        renewalRetryDue(cycle, now) &&
        await isExactMandateActiveFromStore(cycleStore, cycle)) {
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
    cycleStore, cursor, last.current_period_end, last.subscription_id, now,
  );
  return { scanned: rows.length, cycleIds: [...new Set(cycleIds)], cursorAdvanced, cursorReset: false };
}

type ChargeSubscriptionRow = RenewalChargeSubscriptionRow;

async function readChargeSubscriptionForRenewal(
  membershipStore: RenewalMembershipStore,
  cycle: RenewalCycleRow,
): Promise<ChargeSubscriptionRow | null> {
  try {
    return await readRenewalChargeSubscriptionPostgres(
      membershipStore, cycle.subscription_id, cycle.subscriber_id,
    );
  } catch {
    throw new RenewalRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
}

async function isSubscriptionChargeableForCycle(
  membershipStore: RenewalMembershipStore,
  cycle: RenewalCycleRow,
): Promise<boolean> {
  const subscription = await readChargeSubscriptionForRenewal(membershipStore, cycle);
  const retryingPastDue = cycle.outcome_code === 'RETRY_PREPARED' || cycle.attempt_number > 1;
  if (!subscription ||
      subscription.subscription_id !== cycle.subscription_id ||
      subscription.subscriber_id !== cycle.subscriber_id ||
      subscription.current_period_end !== cycle.cycle_start ||
      !(subscription.status === 'ACTIVE' ||
        (subscription.status === 'TRIALING' && cycle.attempt_number === 0 &&
          subscription.trial_started_at !== null && subscription.trial_ends_at === cycle.cycle_start) ||
        (retryingPastDue && subscription.status === 'PAST_DUE')) ||
      !(subscription.cancel_at === null ||
        (isCanonicalIso(subscription.cancel_at) && subscription.cancel_at > cycle.cycle_start))) return false;
  if (subscription.plan_id === cycle.plan_id && subscription.plan_version === cycle.plan_version) return true;

  const scheduled = await readScheduledSubscriptionPlanDowngradeForPeriod(
    membershipStore, cycle.subscription_id, cycle.subscriber_id, cycle.cycle_start, false,
  );
  if (!scheduled || scheduled.status !== 'SCHEDULED' ||
      scheduled.expectedPlanId !== subscription.plan_id ||
      scheduled.expectedPlanVersion !== subscription.plan_version ||
      scheduled.targetPlanId !== cycle.plan_id ||
      scheduled.targetPlanVersion !== cycle.plan_version) return false;
  const target = await readScheduledDowngradeTargetPlan(membershipStore, scheduled);
  return !!target && target.creatorId === subscription.creator_id &&
    target.billingInterval === cycle.billing_interval && target.currency === cycle.currency;
}

async function writeCycleReconciliation(
  db: RenewalCycleStore,
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
  cycleStore: RenewalCycleStore,
  cycle: RenewalCycleRow,
  offer: RenewalOfferSnapshot,
  pricing: AuthoritativelyPricedOrder,
  now: string,
): Promise<RenewalCycleRow> {
  const decision = normalizePricingDecision(cycle, offer, pricing);
  if (decision.totalMinor === 0) {
    return updateCycle(cycleStore, cycle, now,
      "amount_minor = 0, pricing_snapshot_json = ?, state = 'RECONCILIATION_REQUIRED', outcome_code = 'NON_POSITIVE_RENEWAL_TOTAL'",
      [JSON.stringify(decision.pricing)],
    );
  }
  const config = resolveHyperswitchConfig(env);
  const mandate = await readActiveMandateFromStore(cycleStore, String(config.expectedMerchantId), cycle.subscriber_id);
  return updateCycle(
    cycleStore,
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
  cycleStore: RenewalCycleStore,
  cycle: RenewalCycleRow,
  now: string,
): Promise<RenewalCycleRow> {
  const config = resolveHyperswitchConfig(env);
  const mandate = await readActiveMandateFromStore(cycleStore, String(config.expectedMerchantId), cycle.subscriber_id);
  if (!mandate) return cycle;
  return updateCycle(cycleStore, cycle, now,
    "payment_method_id = ?, mandate_record_id = ?, state = 'PREPARED', outcome_code = NULL",
    [mandate.payment_method_id, mandate.mandate_record_id],
  );
}

async function storeOrderReference(
  cycleStore: RenewalCycleStore,
  cycle: RenewalCycleRow,
  orderId: string,
  now: string,
): Promise<RenewalCycleRow> {
  return updateCycle(cycleStore, cycle, now,
    'order_id = ?', [orderId],
  );
}

async function storePaymentReference(
  cycleStore: RenewalCycleStore,
  cycle: RenewalCycleRow,
  payment: PaymentAttemptDto,
  attemptNumber: number,
  now: string,
): Promise<RenewalCycleRow> {
  return updateCycle(cycleStore, cycle, now,
    'payment_id = ?, attempt_number = ?', [payment.paymentId, attemptNumber],
  );
}

async function transitionCycleToPaymentReady(
  cycleStore: RenewalCycleStore,
  cycle: RenewalCycleRow,
  now: string,
): Promise<RenewalCycleRow> {
  const updatedAt = strictlyAfter(now, cycle.updated_at);
  try {
    const transitioned = await transitionRenewalCycleToPaymentReadyPostgres(cycleStore, cycle, updatedAt);
    if (transitioned) return transitioned;
    // Another worker advanced or changed this cycle after our snapshot. Re-read,
    // but never treat our lost CAS as a successful transition of the stale row.
    const latest = await readCycleById(cycleStore, cycle.cycle_id);
    return latest;
  } catch {
    throw new RenewalRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
}

async function acquireSubmissionLease(
  cycleStore: RenewalCycleStore,
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
  const updatedAt = strictlyAfter(now, cycle.updated_at);
  try {
    return await acquireRenewalSubmissionLeasePostgres(
      cycleStore, cycle, leaseToken, leaseExpiresAt, updatedAt, now,
    );
  } catch {
    throw new RenewalRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
}

type FailedCycleRetryPreparation = 'PREPARED' | 'AWAITING_RETRY' | 'AWAITING_OUTCOME_SYNC' | 'TERMINAL';

async function prepareFailedCycleRetry(
  env: RenewalRuntimeEnv,
  membershipStore: RenewalMembershipStore,
  cycle: RenewalCycleRow,
  now: string,
  cycleStore: RenewalCycleStore = getW07RenewalCycleStore(env),
): Promise<FailedCycleRetryPreparation> {
  if (cycle.state !== 'FAILED') return 'TERMINAL';
  if (cycle.subscription_sync_state !== 'APPLIED') return 'AWAITING_OUTCOME_SYNC';
  if (!['failed', 'expired'].includes(cycle.provider_response_status ?? '') ||
      cycle.attempt_number >= MAX_ATTEMPTS) return 'TERMINAL';
  if (!renewalRetryDue(cycle, now)) return 'AWAITING_RETRY';

  const subscription = await readChargeSubscriptionForRenewal(membershipStore, cycle);
  if (!subscription ||
      subscription.subscription_id !== cycle.subscription_id ||
      subscription.subscriber_id !== cycle.subscriber_id ||
      subscription.status !== 'PAST_DUE' ||
      subscription.current_period_end !== cycle.cycle_start ||
      (subscription.cancel_at !== null &&
        (!isCanonicalIso(subscription.cancel_at) || subscription.cancel_at <= cycle.cycle_start))) {
    return 'TERMINAL';
  }

  const originalPlanMatches =
    subscription.plan_id === cycle.plan_id && subscription.plan_version === cycle.plan_version;
  if (!originalPlanMatches) {
    const scheduled = await readScheduledSubscriptionPlanDowngradeForPeriod(
      membershipStore, cycle.subscription_id, cycle.subscriber_id, cycle.cycle_start, false,
    );
    if (!scheduled || scheduled.status !== 'SCHEDULED' ||
        scheduled.expectedPlanId !== subscription.plan_id ||
        scheduled.expectedPlanVersion !== subscription.plan_version ||
        scheduled.targetPlanId !== cycle.plan_id ||
        scheduled.targetPlanVersion !== cycle.plan_version ||
        scheduled.effectiveAt !== cycle.cycle_start) return 'TERMINAL';
    const target = await readScheduledDowngradeTargetPlan(membershipStore, scheduled);
    if (!target || target.creatorId !== subscription.creator_id ||
        target.billingInterval !== cycle.billing_interval || target.currency !== cycle.currency) {
      return 'TERMINAL';
    }
  }
  // A retry may reuse only the exact same still-active saved method/mandate.
  // A revoked mandate requires a new customer-present consent flow and is never
  // silently replaced with another token during off-session recovery.
  if (!(await isExactMandateActiveFromStore(cycleStore, cycle))) return 'TERMINAL';

  const retryCutoff = new Date(Date.parse(now) - renewalRetryDelayMs(cycle.attempt_number)).toISOString();
  const updatedAt = strictlyAfter(now, cycle.updated_at);
  let updated = false;
  try {
    updated = await retryFailedRenewalCyclePostgres(cycleStore, cycle, updatedAt, retryCutoff, MAX_ATTEMPTS);
  } catch {
    throw new RenewalRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  if (updated) return 'PREPARED';
  const latest = await readCycleById(cycleStore, cycle.cycle_id);
  if (latest.state === 'PREPARED') return 'PREPARED';
  if (latest.state === 'FAILED' && latest.subscription_sync_state !== 'APPLIED') return 'AWAITING_OUTCOME_SYNC';
  return 'AWAITING_RETRY';
}

/**
 * Prepare a bounded, idempotent retry after a durable failed-cycle outcome was
 * synchronized to the membership database. The caller still separately invokes processSubscriptionRenewalCycle
 * after this function returns PREPARED; retry preparation alone never charges a provider.
 */
export async function prepareFailedRenewalCycleRetry(
  env: RenewalRuntimeEnv,
  cycleIdInput: string,
  dependencies: Pick<RenewalRuntimeDependencies, 'now' | 'getMembershipPostgresPool' | 'getRenewalCycleStore'> = {},
): Promise<RenewalProcessResult> {
  if (!/^rcy_[A-Za-z0-9]{26}$/.test(cycleIdInput)) {
    throw new RenewalRuntimeError('VALIDATION_FAILED', 400);
  }
  const now = nowIso(dependencies.now ?? (() => new Date()));
  const cycleStore = (dependencies.getRenewalCycleStore ?? getW07RenewalCycleStore)(env);
  const cycle = await readCycleById(cycleStore, cycleIdInput);
  const membershipStore = getRenewalMembershipStore(env, dependencies);
  const preparation = await prepareFailedCycleRetry(env, membershipStore, cycle, now, cycleStore);
  const latest = preparation === 'PREPARED'
    ? await readCycleById(cycleStore, cycleIdInput)
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
  const orderCreateStore = (dependencies.getOrderCreateStore ?? getW07OrderCreatePersistenceStore)(env);
  const membershipStore = getRenewalMembershipStore(env, dependencies);
  const nowFn = dependencies.now ?? (() => new Date());
  let now = nowIso(nowFn);
  const cycleStore = (dependencies.getRenewalCycleStore ?? getW07RenewalCycleStore)(env);
  let cycle = await readCycleById(cycleStore, cycleId);
  if (cycle.state === 'FAILED') {
    const retry = await prepareFailedCycleRetry(env, membershipStore, cycle, now, cycleStore);
    if (retry !== 'PREPARED') {
      const action = retry === 'AWAITING_OUTCOME_SYNC'
        ? 'AWAITING_OUTCOME_SYNC'
        : retry === 'AWAITING_RETRY'
          ? 'AWAITING_RETRY'
          : 'TERMINAL';
      return { cycleId, state: cycle.state, action, ...(cycle.payment_id ? { paymentId: cycle.payment_id } : {}) };
    }
    cycle = await readCycleById(cycleStore, cycleId);
  }
  if (cycle.state === 'SUCCEEDED' || cycle.state === 'SUBMITTED' ||
      cycle.state === 'RECONCILIATION_REQUIRED') {
    return { cycleId, state: cycle.state, action: 'TERMINAL', ...(cycle.payment_id ? { paymentId: cycle.payment_id } : {}) };
  }

  if (cycle.state === 'PREPARED' && !cycle.order_id && !orderCreateStore) {
    throw new RenewalRuntimeError('SERVICE_UNAVAILABLE', 503);
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
    cycle = await persistPricingDecision(env, cycleStore, cycle, offer, resolved, now);
    if (cycle.state === 'RECONCILIATION_REQUIRED') {
      return { cycleId, state: cycle.state, action: 'RECONCILIATION_REQUIRED' };
    }
  }

  if (cycle.state === 'AWAITING_MANDATE') {
    cycle = await advanceAwaitingMandate(env, cycleStore, cycle, now);
    if (cycle.state === 'AWAITING_MANDATE') {
      return { cycleId, state: cycle.state, action: 'AWAITING_MANDATE' };
    }
  }

  if (cycle.state === 'PREPARED') {
    offer = parseOfferSnapshot(cycle.offer_snapshot_json);
    if (!cycle.pricing_snapshot_json || !isSafeMinor(cycle.amount_minor, false) ||
        !cycle.payment_method_id || !cycle.mandate_record_id) {
      cycle = await writeCycleReconciliation(cycleStore, cycle, 'PREPARED_SNAPSHOT_INCOMPLETE', now);
      return { cycleId, state: cycle.state, action: 'RECONCILIATION_REQUIRED' };
    }
    if (!(await isSubscriptionChargeableForCycle(membershipStore, cycle))) {
      cycle = await writeCycleReconciliation(cycleStore, cycle, 'SUBSCRIPTION_NOT_CHARGEABLE_BEFORE_ORDER', now);
      return { cycleId, state: cycle.state, action: 'RECONCILIATION_REQUIRED' };
    }
    if (!(await isExactMandateActiveFromStore(cycleStore, cycle))) {
      cycle = await writeCycleReconciliation(cycleStore, cycle, 'MANDATE_NOT_ACTIVE', now);
      return { cycleId, state: cycle.state, action: 'RECONCILIATION_REQUIRED' };
    }
    const pricing = parsePricingSnapshot(cycle.pricing_snapshot_json);
    const rawRequest: CreateCommerceOrderRequest = { items: [{ itemRef: cycle.plan_id, quantity: 1 }] };

    if (!cycle.order_id) {
      if (!orderCreateStore) throw new RenewalRuntimeError('SERVICE_UNAVAILABLE', 503);
      const createOrder = dependencies.createOrder ?? createCommerceOrder;
      const order = await createOrder(
        orderCreateStore,
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
      cycle = await storeOrderReference(cycleStore, cycle, order.data.orderId, now);
      if (cycle.order_id !== order.data.orderId) {
        throw new RenewalRuntimeError('CYCLE_ORDER_REFERENCE_CONFLICT', 409);
      }
    }

    if (!cycle.payment_id) {
      if (cycle.attempt_number >= MAX_ATTEMPTS) {
        cycle = await writeCycleReconciliation(cycleStore, cycle, 'PAYMENT_ATTEMPT_LIMIT_REACHED', now);
        return { cycleId, state: cycle.state, action: 'RECONCILIATION_REQUIRED' };
      }
      const attemptNumber = cycle.attempt_number + 1;
      const attempt = await createRenewalPaymentAttempt(
        env,
        cycle.subscriber_id,
        cycle.order_id!,
        'renew_' + cycle.cycle_id + '_' + String(attemptNumber),
        cycle.merchant_id,
        dependencies,
      );
      cycle = await storePaymentReference(cycleStore, cycle, attempt.payment, attemptNumber, now);
      if (cycle.payment_id !== attempt.payment.paymentId || cycle.attempt_number !== attemptNumber) {
        throw new RenewalRuntimeError('CYCLE_PAYMENT_REFERENCE_CONFLICT', 409);
      }
    }
    cycle = await transitionCycleToPaymentReady(cycleStore, cycle, now);
  }

  if (cycle.state === 'PAYMENT_READY' || cycle.state === 'SUBMITTING') {
    if (!(await isExactMandateActiveFromStore(cycleStore, cycle))) {
      cycle = await writeCycleReconciliation(cycleStore, cycle, 'MANDATE_NOT_ACTIVE_AT_SUBMISSION', now);
      return { cycleId, state: cycle.state, action: 'RECONCILIATION_REQUIRED' };
    }
    let leased: RenewalCycleRow | null;
    try {
      leased = await acquireSubmissionLease(cycleStore, cycle, now, dependencies);
    } catch {
      throw new RenewalRuntimeError('SERVICE_UNAVAILABLE', 503);
    }
    if (!leased) {
      cycle = await readCycleById(cycleStore, cycleId);
      return { cycleId, state: cycle.state, action: 'SUBMISSION_IN_PROGRESS', ...(cycle.payment_id ? { paymentId: cycle.payment_id } : {}) };
    }
    cycle = leased;
    const config = resolveHyperswitchConfig(env);
    const paymentStore = cycleStore;
    let payment: RenewalPaymentAttemptRow | null;
    try {
      payment = await readRenewalPaymentAttemptPostgres(
        paymentStore, cycle.payment_id!, cycle.subscriber_id,
      );
    } catch {
      throw new RenewalRuntimeError('SERVICE_UNAVAILABLE', 503);
    }
    if (!payment || payment.merchant_id !== cycle.merchant_id || payment.provider !== PROVIDER ||
        payment.order_id !== cycle.order_id || payment.amount_minor !== cycle.amount_minor ||
        payment.currency !== cycle.currency) {
      cycle = await writeCycleReconciliation(cycleStore, cycle, 'PAYMENT_ATTEMPT_BINDING_MISMATCH', now);
      return { cycleId, state: cycle.state, action: 'RECONCILIATION_REQUIRED' };
    }

    if (payment.status !== 'INITIATING') {
      if (['failed', 'cancelled', 'expired', 'cancelled_post_capture'].includes(payment.status)) {
        cycle = await writeCycleReconciliation(cycleStore, cycle, 'PAYMENT_ALREADY_TERMINAL_WITHOUT_CYCLE_RESULT', now);
        return { cycleId, state: cycle.state, action: 'RECONCILIATION_REQUIRED' };
      }
      now = nowIso(nowFn);
      cycle = await updateCycle(cycleStore, cycle, now,
        "state = 'SUBMITTED', provider_response_status = 'processing', outcome_code = 'RECOVERED_SUBMISSION_RESPONSE_UNKNOWN', lease_token = NULL, lease_expires_at = NULL",
        [],
      );
      return { cycleId, state: cycle.state, action: 'SUBMITTED', ...(cycle.payment_id ? { paymentId: cycle.payment_id } : {}) };
    }

    if (!(await isSubscriptionChargeableForCycle(membershipStore, cycle))) {
      cycle = await writeCycleReconciliation(cycleStore, cycle, 'SUBSCRIPTION_NOT_CHARGEABLE_AT_SUBMISSION', now);
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
        cycleStore,
        cycle,
        error instanceof HyperswitchClientError ? 'PROVIDER_SUBMISSION_UNCERTAIN' : 'PROVIDER_SUBMISSION_DEPENDENCY_ERROR',
        now,
      );
      return { cycleId, state: cycle.state, action: 'RECONCILIATION_REQUIRED', ...(cycle.payment_id ? { paymentId: cycle.payment_id } : {}) };
    }

    try {
      const recordSubmission = dependencies.recordProviderSubmissionPostgres ??
        recordHyperswitchMerchantInitiatedSubmissionPostgres;
      await recordSubmission(
        paymentStore,
        cycle.subscriber_id,
        cycle.payment_id!,
        cycle.merchant_id,
        cycle.payment_method_id!,
        providerPayment,
        { now: nowFn },
      );
    } catch {
      now = nowIso(nowFn);
      cycle = await writeCycleReconciliation(cycleStore, cycle, 'PROVIDER_RESPONSE_NOT_DURABLY_RECORDED', now);
      return { cycleId, state: cycle.state, action: 'RECONCILIATION_REQUIRED', ...(cycle.payment_id ? { paymentId: cycle.payment_id } : {}) };
    }

    now = nowIso(nowFn);
    const latest = await readCycleById(cycleStore, cycleId);
    if (latest.state === 'SUCCEEDED' || latest.state === 'FAILED' ||
        latest.state === 'RECONCILIATION_REQUIRED') {
      return { cycleId, state: latest.state, action: 'TERMINAL', ...(latest.payment_id ? { paymentId: latest.payment_id } : {}) };
    }
    cycle = await updateCycle(cycleStore, latest, now,
      "state = 'SUBMITTED', provider_response_status = ?, outcome_code = 'AWAITING_SIGNED_WEBHOOK', lease_token = NULL, lease_expires_at = NULL",
      [providerPayment.status],
    );
    return { cycleId, state: cycle.state, action: 'SUBMITTED', ...(cycle.payment_id ? { paymentId: cycle.payment_id } : {}) };
  }

  return { cycleId, state: cycle.state, action: cycle.state === 'RECONCILIATION_REQUIRED' ? 'RECONCILIATION_REQUIRED' : 'PREPARED', ...(cycle.payment_id ? { paymentId: cycle.payment_id } : {}) };
}
