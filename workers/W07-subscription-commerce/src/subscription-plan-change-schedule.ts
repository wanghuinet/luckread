/// <reference types="@cloudflare/workers-types" />

import { sha256BytesToHex } from '../../W10-async/src/canonical-json-idempotency.js';
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
  getW07MembershipPostgresPool,
  type W07MembershipDatabaseRuntimeEnv,
} from './neon/membership-database-runtime.js';
import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js';
import {
  hasPendingScheduledPlanDowngradePostgres,
  insertScheduledPlanChangePostgres,
  readScheduledChangeByIdempotencyPostgres,
  readScheduledDowngradeTargetPlanPostgres,
  readScheduledSubscriptionPlanDowngradeForPeriodPostgres,
} from './subscription-plan-change-schedule-postgres.js';

const PLAN_ID_PATTERN = /^plan_[a-f0-9]{64}$/;
const CHANGE_ID_PATTERN = /^sudc_[a-f0-9]{64}$/;

export type ScheduledPlanChangeRow = Readonly<{
  change_id: string;
  subscriber_id: string;
  subscription_id: string;
  change_type: 'DOWNGRADE' | 'BILLING_INTERVAL_CHANGE';
  expected_subscription_version: number;
  expected_plan_id: string;
  expected_plan_version: number;
  target_plan_id: string;
  target_plan_version: number;
  effective_at: string;
  idempotency_key_hash: string;
  status: 'SCHEDULED' | 'APPLIED' | 'CANCELLED' | 'RECONCILIATION_REQUIRED';
  applied_at: string | null;
  applied_subscription_version: number | null;
  created_at: string;
  updated_at: string;
  version: number;
}>;

export type ScheduledSubscriptionPlanDowngrade = Readonly<{
  changeId: string;
  subscriberId: string;
  subscriptionId: string;
  changeType: 'DOWNGRADE' | 'BILLING_INTERVAL_CHANGE';
  expectedSubscriptionVersion: number;
  expectedPlanId: string;
  expectedPlanVersion: number;
  targetPlanId: string;
  targetPlanVersion: number;
  effectiveAt: string;
  status: ScheduledPlanChangeRow['status'];
  appliedAt: string | null;
  appliedSubscriptionVersion: number | null;
}>;

export type ScheduledSubscriptionPlanDowngradeResult = Readonly<{
  changeId: string;
  subscriptionId: string;
  status: 'SCHEDULED' | 'APPLIED';
  changeType: 'DOWNGRADE' | 'BILLING_INTERVAL_CHANGE';
  currentPlanId: string;
  targetPlanId: string;
  targetPlanVersion: number;
  effectiveAt: string;
  replayed: boolean;
}>;

export type ScheduledPlanDowngradeEnv = W07MembershipDatabaseRuntimeEnv;
export type ScheduledPlanDowngradeDependencies = Readonly<{ now?: () => Date }>;

export function getScheduledPlanChangeStore(
  env: ScheduledPlanDowngradeEnv,
): W07WebhookPostgresPool {
  try {
    return getW07MembershipPostgresPool(env);
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function isBoundedText(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function isCanonicalUtc(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function parseRequest(value: unknown): string {
  if (!isRecord(value) || Object.keys(value).length !== 1 ||
      !Object.prototype.hasOwnProperty.call(value, 'planId') ||
      typeof value.planId !== 'string' || !PLAN_ID_PATTERN.test(value.planId)) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
  }
  return value.planId;
}

function toScheduledChange(row: ScheduledPlanChangeRow): ScheduledSubscriptionPlanDowngrade {
  if (!CHANGE_ID_PATTERN.test(row.change_id) ||
      (row.change_type !== 'DOWNGRADE' && row.change_type !== 'BILLING_INTERVAL_CHANGE') ||
      !isBoundedText(row.subscriber_id) || !isBoundedText(row.subscription_id) ||
      !Number.isSafeInteger(row.expected_subscription_version) || row.expected_subscription_version < 1 ||
      !PLAN_ID_PATTERN.test(row.expected_plan_id) ||
      !Number.isSafeInteger(row.expected_plan_version) || row.expected_plan_version < 1 ||
      !PLAN_ID_PATTERN.test(row.target_plan_id) ||
      !Number.isSafeInteger(row.target_plan_version) || row.target_plan_version < 1 ||
      !isCanonicalUtc(row.effective_at) || !/^[a-f0-9]{64}$/.test(row.idempotency_key_hash) ||
      !isCanonicalUtc(row.created_at) || !isCanonicalUtc(row.updated_at) ||
      !Number.isSafeInteger(row.version) || row.version < 1 ||
      !(row.applied_at === null || isCanonicalUtc(row.applied_at)) ||
      !(row.applied_subscription_version === null ||
        (Number.isSafeInteger(row.applied_subscription_version) && row.applied_subscription_version > 0))) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  return {
    changeId: row.change_id,
    subscriberId: row.subscriber_id,
    subscriptionId: row.subscription_id,
    changeType: row.change_type,
    expectedSubscriptionVersion: row.expected_subscription_version,
    expectedPlanId: row.expected_plan_id,
    expectedPlanVersion: row.expected_plan_version,
    targetPlanId: row.target_plan_id,
    targetPlanVersion: row.target_plan_version,
    effectiveAt: row.effective_at,
    status: row.status,
    appliedAt: row.applied_at,
    appliedSubscriptionVersion: row.applied_subscription_version,
  };
}

async function readScheduledChangeByIdempotency(
  db: W07WebhookPostgresPool,
  subscriberId: string,
  keyHash: string,
): Promise<ScheduledPlanChangeRow | null> {
  return readScheduledChangeByIdempotencyPostgres(db, subscriberId, keyHash);
}

export async function readScheduledSubscriptionPlanDowngradeForPeriod(
  db: W07WebhookPostgresPool,
  subscriptionId: string,
  subscriberId: string,
  effectiveAt: string,
  includeApplied = true,
): Promise<ScheduledSubscriptionPlanDowngrade | null> {
  const row = await readScheduledSubscriptionPlanDowngradeForPeriodPostgres(
    db, subscriptionId, subscriberId, effectiveAt, includeApplied,
  );
  if (!row) return null;
  const change = toScheduledChange(row);
  if (change.subscriberId !== subscriberId || change.subscriptionId !== subscriptionId) {
    throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
  }
  return change;
}

/** Returns true while a period-end downgrade is scheduled and not yet applied. */
export async function hasPendingScheduledPlanDowngrade(
  db: W07WebhookPostgresPool,
  subscriptionId: string,
): Promise<boolean> {
  return hasPendingScheduledPlanDowngradePostgres(db, subscriptionId);
}
export async function readScheduledDowngradeTargetPlan(
  db: W07WebhookPostgresPool,
  change: ScheduledSubscriptionPlanDowngrade,
): Promise<Readonly<{
  planId: string;
  planVersion: number;
  name: string;
  tier: string;
  billingInterval: 'MONTHLY' | 'YEARLY';
  priceMinor: number;
  currency: string;
  benefits: string[];
  creatorId: string;
}> | null> {
  return readScheduledDowngradeTargetPlanPostgres(db, change);
}

/**
 * Stores a downgrade request without changing the live Subscription or
 * creating a payment. The selected plan becomes effective only after the
 * existing renewal pipeline confirms the next cycle payment and CAS-updates
 * the authoritative Subscription period.
 */
async function scheduleSubscriptionPlanChange(
  env: ScheduledPlanDowngradeEnv,
  subscriberIdInput: string,
  subscriptionIdInput: string,
  input: unknown,
  idempotencyKeyInput: string | null,
  ifMatchInput: string | null,
  expectedChangeType: 'DOWNGRADE' | 'BILLING_INTERVAL_CHANGE',
  dependencies: ScheduledPlanDowngradeDependencies = {},
): Promise<ScheduledSubscriptionPlanDowngradeResult> {
  const subscriberId = validatePrincipal(subscriberIdInput);
  const subscriptionId = subscriptionIdInput.trim();
  if (!isBoundedText(subscriptionId)) throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
  const targetPlanId = parseRequest(input);
  const idempotencyKey = validateIdempotencyKey(idempotencyKeyInput);
  const ifMatch = validateIfMatch(ifMatchInput);
  const keyNamespace = expectedChangeType === 'DOWNGRADE'
    ? 'membership-plan-downgrade-v1'
    : 'membership-billing-interval-change-v1';
  const keyDigest = await sha256BytesToHex(new TextEncoder().encode(
    keyNamespace + '\u0000' + subscriberId + '\u0000' + idempotencyKey,
  )).catch(() => { throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503); });
  const changeId = 'sudc_' + keyDigest;

  const nowDate = (dependencies.now ?? (() => new Date()))();
  if (!(nowDate instanceof Date) || !Number.isFinite(nowDate.getTime())) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  const now = nowDate.toISOString();
  const membershipStore = getScheduledPlanChangeStore(env);
  const existing = await readScheduledChangeByIdempotency(membershipStore, subscriberId, keyDigest);
  if (existing) {
    const change = toScheduledChange(existing);
    if (change.subscriptionId !== subscriptionId || change.targetPlanId !== targetPlanId ||
        change.changeType !== expectedChangeType) {
      throw new SubscriptionRuntimeError('CONFLICT', 409);
    }
    if (ifMatch !== etagForVersion(change.expectedSubscriptionVersion)) {
      throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412);
    }
    if (change.status === 'CANCELLED' || change.status === 'RECONCILIATION_REQUIRED') {
      throw new SubscriptionRuntimeError('CONFLICT', 409);
    }
    return {
      changeId: change.changeId,
      subscriptionId,
      status: change.status === 'APPLIED' ? 'APPLIED' : 'SCHEDULED',
      changeType: change.changeType,
      currentPlanId: change.expectedPlanId,
      targetPlanId: change.targetPlanId,
      targetPlanVersion: change.targetPlanVersion,
      effectiveAt: change.effectiveAt,
      replayed: true,
    };
  }

  const preview = await previewSubscriptionPlanChange(
    membershipStore, subscriberId, subscriptionId, targetPlanId, { now: () => nowDate },
  );
  const previewMatches = preview.changeType === expectedChangeType &&
    !preview.paymentRequired && preview.prorationBaseMinor === 0 &&
    preview.effectiveAt === preview.currentPeriodEnd &&
    preview.targetPlan.currency === preview.currentPlan.currency &&
    preview.targetPlan.priceMinor >= 1 &&
    (expectedChangeType === 'DOWNGRADE'
      ? preview.targetPlan.billingInterval === preview.currentPlan.billingInterval &&
        preview.targetPlan.priceMinor < preview.currentPlan.priceMinor
      : preview.targetPlan.billingInterval !== preview.currentPlan.billingInterval &&
        preview.targetPlan.tier === preview.currentPlan.tier);
  if (!previewMatches) {
    throw new SubscriptionRuntimeError('INVALID_STATE', 409);
  }
  if (preview.etag !== ifMatch) throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412);
  const expectedVersion = Number(preview.etag.match(/^"lr-v([1-9]\d*)"$/)?.[1]);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }

  try {
    const inserted = await insertScheduledPlanChangePostgres(membershipStore, {
      changeId,
      subscriberId,
      subscriptionId,
      changeType: expectedChangeType,
      expectedVersion,
      currentPlanId: preview.currentPlan.planId,
      currentPlanVersion: preview.currentPlan.planVersion,
      targetPlanId: preview.targetPlan.planId,
      targetPlanVersion: preview.targetPlan.planVersion,
      effectiveAt: preview.currentPeriodEnd,
      idempotencyKeyHash: keyDigest,
      now,
      currentPeriodStart: preview.currentPeriodStart,
      currentPeriodEnd: preview.currentPeriodEnd,
    });
    if (!inserted) {
      const raced = await readScheduledChangeByIdempotency(membershipStore, subscriberId, keyDigest);
      if (raced) {
        const same = toScheduledChange(raced);
        if (same.subscriptionId === subscriptionId && same.targetPlanId === targetPlanId &&
            same.changeType === expectedChangeType) {
          return {
            changeId: same.changeId, subscriptionId,
            status: same.status === 'APPLIED' ? 'APPLIED' : 'SCHEDULED',
            changeType: same.changeType,
            currentPlanId: same.expectedPlanId, targetPlanId: same.targetPlanId,
            targetPlanVersion: same.targetPlanVersion, effectiveAt: same.effectiveAt, replayed: true,
          };
        }
      }
      throw new SubscriptionRuntimeError('CONFLICT', 409);
    }
  } catch (error) {
    if (error instanceof SubscriptionRuntimeError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (/unique/i.test(message)) throw new SubscriptionRuntimeError('CONFLICT', 409);
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }

  return {
    changeId,
    subscriptionId,
    status: 'SCHEDULED',
    changeType: expectedChangeType,
    currentPlanId: preview.currentPlan.planId,
    targetPlanId: preview.targetPlan.planId,
    targetPlanVersion: preview.targetPlan.planVersion,
    effectiveAt: preview.currentPeriodEnd,
    replayed: false,
  };
}


export function scheduleSubscriptionPlanDowngrade(
  env: ScheduledPlanDowngradeEnv,
  subscriberId: string,
  subscriptionId: string,
  input: unknown,
  idempotencyKey: string | null,
  ifMatch: string | null,
  dependencies: ScheduledPlanDowngradeDependencies = {},
): Promise<ScheduledSubscriptionPlanDowngradeResult> {
  return scheduleSubscriptionPlanChange(env, subscriberId, subscriptionId, input, idempotencyKey, ifMatch, 'DOWNGRADE', dependencies);
}

export function scheduleSubscriptionBillingIntervalChange(
  env: ScheduledPlanDowngradeEnv,
  subscriberId: string,
  subscriptionId: string,
  input: unknown,
  idempotencyKey: string | null,
  ifMatch: string | null,
  dependencies: ScheduledPlanDowngradeDependencies = {},
): Promise<ScheduledSubscriptionPlanDowngradeResult> {
  return scheduleSubscriptionPlanChange(env, subscriberId, subscriptionId, input, idempotencyKey, ifMatch, 'BILLING_INTERVAL_CHANGE', dependencies);
}
