import { sha256BytesToHex } from '../../W10-async/src/canonical-json-idempotency.js';
import {
  createCommerceOrder,
  OrderPersistenceError,
  type AuthoritativelyPricedOrder,
  type CommerceOrderData,
  type OrderCreatePersistenceStore,
} from './order-persistence.js';
import { issueInvoiceForOrderPostgres } from './billing-document-postgres-persistence.js';
import { getCommerceOrderPostgres } from './order-read-postgres.js';
import {
  getW07OrderCreatePersistenceStore,
  getW07PaymentWebhookPostgresPool,
  type W07PaymentMethodReadRuntimeEnv,
} from './neon/payment-method-read-runtime.js';
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
import {
  getScheduledPlanChangeStore,
  hasPendingScheduledPlanDowngrade,
} from './subscription-plan-change-schedule.js';
import type { W07MembershipDatabaseRuntimeEnv } from './neon/membership-database-runtime.js';
import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js';
import {
  attachPlanUpgradeOrderPostgres,
  expirePlanUpgradeAttemptPostgres,
  expireStalePlanUpgradeAttemptsPostgres,
  insertPlanUpgradeAttemptPostgres,
  readPlanUpgradeAttemptByIdPostgres,
  readPlanUpgradeAttemptByIdempotencyPostgres,
} from './subscription-plan-upgrade-checkout-postgres.js';

type PlanUpgradeAttemptStore = W07WebhookPostgresPool;

export type PlanChangeAttemptRow = Readonly<{
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

export type SubscriptionPlanUpgradeCheckoutEnv =
  W07PaymentMethodReadRuntimeEnv & W07MembershipDatabaseRuntimeEnv;

export type SubscriptionPlanUpgradeCheckoutDependencies = Readonly<{
  now?: () => Date;
  resolvePricing: (context: SubscriptionPlanUpgradePricingContext) => Promise<AuthoritativelyPricedOrder>;
  createOrder?: typeof createCommerceOrder;
  getFinancePool?: (env: SubscriptionPlanUpgradeCheckoutEnv) => W07WebhookPostgresPool | undefined;
  getOrder?: typeof getCommerceOrderPostgres;
  issueInvoice?: typeof issueInvoiceForOrderPostgres;
  getOrderCreateStore?: (env: SubscriptionPlanUpgradeCheckoutEnv) => OrderCreatePersistenceStore | undefined;
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
  db: PlanUpgradeAttemptStore,
  subscriberId: string,
  keyHash: string,
): Promise<PlanChangeAttemptRow | null> {
  return readPlanUpgradeAttemptByIdempotencyPostgres(db, subscriberId, keyHash);
}

async function readAttemptById(db: PlanUpgradeAttemptStore, attemptId: string): Promise<PlanChangeAttemptRow | null> {
  return readPlanUpgradeAttemptByIdPostgres(db, attemptId);
}

async function expireAttempt(db: PlanUpgradeAttemptStore, row: PlanChangeAttemptRow, now: string): Promise<void> {
  return expirePlanUpgradeAttemptPostgres(db, row, now);
}

async function expireStalePendingAttempts(
  db: PlanUpgradeAttemptStore,
  subscriptionId: string,
  now: string,
): Promise<void> {
  return expireStalePlanUpgradeAttemptsPostgres(db, subscriptionId, now);
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
  financePool: PlanUpgradeAttemptStore,
  membershipStore: PlanUpgradeAttemptStore,
  subscriberId: string,
  row: PlanChangeAttemptRow,
  preview: SubscriptionPlanChangePreview,
  dependencies: SubscriptionPlanUpgradeCheckoutDependencies,
  replayed: boolean,
): Promise<SubscriptionPlanUpgradeCheckoutResult> {
  const attempt = toAttempt(row);
  const orderCreateStore = (dependencies.getOrderCreateStore ?? getW07OrderCreatePersistenceStore)(env);
  if (!orderCreateStore) throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  let order: CommerceOrderData;
  try {
    if (row.order_id) {
      order = await (dependencies.getOrder ?? getCommerceOrderPostgres)(financePool, subscriberId, row.order_id);
    } else {
      const orderKey = 'plan-upgrade-' + row.attempt_id;
      const created = await (dependencies.createOrder ?? createCommerceOrder)(
        orderCreateStore,
        subscriberId,
        orderKey,
        { items: [{ itemRef: row.target_plan_id, quantity: 1 }] },
        async () => dependencies.resolvePricing({ preview, attempt }),
      );
      order = created.data;
      const updatedAt = new Date().toISOString();
      try {
        await attachPlanUpgradeOrderPostgres(membershipStore, row.attempt_id, order.orderId, updatedAt);
        const latest = await readAttemptById(membershipStore, row.attempt_id);
        if (!latest || latest.order_id !== order.orderId) {
          throw new SubscriptionRuntimeError('CONFLICT', 409);
        }
        row = latest;
      } catch (error) {
        if (error instanceof SubscriptionRuntimeError) throw error;
        throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
      }
    }

    const issueInvoice = dependencies.issueInvoice ?? issueInvoiceForOrderPostgres;
    await issueInvoice(financePool, subscriberId, order.orderId);
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

  const latest = row.order_id ? row : await readAttemptById(membershipStore, row.attempt_id);
  if (!latest || latest.order_id !== order.orderId) throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  return toCheckoutResult(latest, order, replayed);
}

/**
 * Creates an authoritative, prorated upgrade Order without mutating the Subscription.
 * Access changes only from the signed Hyperswitch success-webhook fulfillment path.
 * Financial facts remain in the separate D1-04 Neon finance database; D1-01
 * stores only the lifecycle reservation and an opaque D1-04 order reference.
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
  const financePool = (dependencies.getFinancePool ?? getW07PaymentWebhookPostgresPool)(env);
  if (!financePool) throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  const membershipStore = getScheduledPlanChangeStore(env);
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

  // Existing idempotency attempts must replay the original order even if a
  // later period-end downgrade has since been scheduled. New attempts are
  // mutually exclusive through the guarded INSERT below.
  let attemptRow = await readAttemptByIdempotency(membershipStore, subscriberId, keyDigest);
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
      await expireAttempt(membershipStore, attemptRow, now);
      throw new SubscriptionRuntimeError('CONFLICT', 409);
    }
    if (attemptRow.order_id) {
      const order = await (dependencies.getOrder ?? getCommerceOrderPostgres)(financePool, subscriberId, attemptRow.order_id)
        .catch(() => { throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503); });
      if (attemptRow.status === 'PENDING_PAYMENT' &&
          (order.status === 'FAILED' || order.status === 'CANCELLED')) {
        await expireAttempt(membershipStore, attemptRow, now);
        throw new SubscriptionRuntimeError('CONFLICT', 409);
      }
      if (attemptRow.status === 'PENDING_PAYMENT') {
        const invoice = dependencies.issueInvoice ?? issueInvoiceForOrderPostgres;
        await invoice(financePool, subscriberId, order.orderId).catch(() => {
          throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
        });
      }
      return toCheckoutResult(attemptRow, order, true);
    }
  }

  const preview = await previewSubscriptionPlanChange(
    membershipStore, subscriberId, subscriptionId, targetPlanId, { now: () => nowDate },
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
    await expireStalePendingAttempts(membershipStore, subscriptionId, now);
    try {
      const inserted = await insertPlanUpgradeAttemptPostgres(membershipStore, {
        attemptId: candidate.attempt_id,
        subscriberId: candidate.subscriber_id,
        subscriptionId: candidate.subscription_id,
        expectedSubscriptionVersion: candidate.expected_subscription_version,
        expectedPlanId: candidate.expected_plan_id,
        expectedPlanVersion: candidate.expected_plan_version,
        targetPlanId: candidate.target_plan_id,
        targetPlanVersion: candidate.target_plan_version,
        currentPeriodStart: candidate.current_period_start,
        currentPeriodEnd: candidate.current_period_end,
        idempotencyKeyHash: candidate.idempotency_key_hash,
        expiresAt: candidate.expires_at,
        createdAt: candidate.created_at,
        updatedAt: candidate.updated_at,
      });
      if (!inserted) {
        const raced = await readAttemptByIdempotency(membershipStore, subscriberId, keyDigest);
        if (raced) {
          assertAttemptMatches(raced, subscriberId, subscriptionId, targetPlanId);
          throw new SubscriptionRuntimeError('CONFLICT', 409);
        }
        if (await hasPendingScheduledPlanDowngrade(membershipStore, subscriptionId)) {
          throw new SubscriptionRuntimeError('CONFLICT', 409);
        }
        throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412);
      }
      attemptRow = await readAttemptById(membershipStore, attemptId);
      if (!attemptRow) throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
    } catch (error) {
      if (error instanceof SubscriptionRuntimeError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (/unique/i.test(message)) {
        const sameKey = await readAttemptByIdempotency(membershipStore, subscriberId, keyDigest);
        if (sameKey) assertAttemptMatches(sameKey, subscriberId, subscriptionId, targetPlanId);
        throw new SubscriptionRuntimeError('CONFLICT', 409);
      }
      throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
    }
  }

  return createOrReadOrder(env, financePool, membershipStore, subscriberId, attemptRow, preview, {
    ...dependencies,
    resolvePricing: async () => pricing,
  }, replayedAttempt || Boolean(attemptRow.order_id));
}
