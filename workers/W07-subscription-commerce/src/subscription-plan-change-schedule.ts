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

const PLAN_ID_PATTERN = /^plan_[a-f0-9]{64}$/;
const CHANGE_ID_PATTERN = /^sudc_[a-f0-9]{64}$/;

type ScheduledPlanChangeRow = Readonly<{
  change_id: string;
  subscriber_id: string;
  subscription_id: string;
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
  currentPlanId: string;
  targetPlanId: string;
  targetPlanVersion: number;
  effectiveAt: string;
  replayed: boolean;
}>;

export type ScheduledPlanDowngradeEnv = Readonly<{ D1_01: D1Database }>;
export type ScheduledPlanDowngradeDependencies = Readonly<{ now?: () => Date }>;

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
  db: D1Database,
  subscriberId: string,
  keyHash: string,
): Promise<ScheduledPlanChangeRow | null> {
  try {
    return await db.prepare(
      'SELECT change_id, subscriber_id, subscription_id, expected_subscription_version, expected_plan_id, ' +
      'expected_plan_version, target_plan_id, target_plan_version, effective_at, idempotency_key_hash, status, ' +
      'applied_at, applied_subscription_version, created_at, updated_at, version ' +
      'FROM membership_subscription_scheduled_plan_changes WHERE subscriber_id = ? AND idempotency_key_hash = ? LIMIT 1',
    ).bind(subscriberId, keyHash).first<ScheduledPlanChangeRow>();
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
}

export async function readScheduledSubscriptionPlanDowngradeForPeriod(
  db: D1Database,
  subscriptionId: string,
  subscriberId: string,
  effectiveAt: string,
  includeApplied = true,
): Promise<ScheduledSubscriptionPlanDowngrade | null> {
  let row: ScheduledPlanChangeRow | null;
  try {
    row = await db.prepare(
      'SELECT change_id, subscriber_id, subscription_id, expected_subscription_version, expected_plan_id, ' +
      'expected_plan_version, target_plan_id, target_plan_version, effective_at, idempotency_key_hash, status, ' +
      'applied_at, applied_subscription_version, created_at, updated_at, version ' +
      'FROM membership_subscription_scheduled_plan_changes WHERE subscription_id = ? AND effective_at = ? ' +
      (includeApplied ? "AND status IN ('SCHEDULED', 'APPLIED')" : "AND status = 'SCHEDULED'") +
      ' LIMIT 1',
    ).bind(subscriptionId, effectiveAt).first<ScheduledPlanChangeRow>();
  } catch (error) {
    // Keep pre-migration renewal/webhook behavior unchanged. The new schedule
    // table is additive; until migration 0006 is applied there cannot be a
    // persisted downgrade row, so absence of that exact table is equivalent to
    // no scheduled change. All other D1 failures remain fail-closed.
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table:\s*membership_subscription_scheduled_plan_changes/i.test(message)) {
      return null;
    }
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  if (!row) return null;
  const change = toScheduledChange(row);
  if (change.subscriberId !== subscriberId || change.subscriptionId !== subscriptionId) {
    throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
  }
  return change;
}


/** Returns true while a period-end downgrade is scheduled and not yet applied. */
export async function hasPendingScheduledPlanDowngrade(
  db: D1Database,
  subscriptionId: string,
): Promise<boolean> {
  try {
    const row = await db.prepare(
      "SELECT change_id FROM membership_subscription_scheduled_plan_changes WHERE subscription_id = ? AND status = 'SCHEDULED' LIMIT 1",
    ).bind(subscriptionId).first<{ change_id: string }>();
    return row !== null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Migration 0006 is additive. Before it is applied, no scheduled downgrade can exist.
    if (/no such table:\\s*membership_subscription_scheduled_plan_changes/i.test(message)) return false;
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
}
export async function readScheduledDowngradeTargetPlan(
  db: D1Database,
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
  let row: {
    plan_id: string; plan_version: number; owner_type: string; owner_id: string;
    name: string; tier: string; billing_interval: string; price_minor: number;
    currency: string; benefits_json: string;
  } | null;
  try {
    row = await db.prepare(
      'SELECT p.plan_id, v.plan_version, p.owner_type, p.owner_id, v.name, v.tier, ' +
      'v.billing_interval, v.price_minor, v.currency, v.benefits_json ' +
      'FROM membership_plans p INNER JOIN membership_plan_versions v ' +
      'ON v.plan_id = p.plan_id AND v.plan_version = ? ' +
      'WHERE p.plan_id = ? LIMIT 1',
    ).bind(change.targetPlanVersion, change.targetPlanId).first();
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  if (!row || row.plan_id !== change.targetPlanId || row.plan_version !== change.targetPlanVersion ||
      row.owner_type !== 'CREATOR' || !isBoundedText(row.owner_id) ||
      !PLAN_ID_PATTERN.test(row.plan_id) || !isBoundedText(row.name, 120) ||
      !/^[a-z][a-z0-9_-]{0,63}$/.test(row.tier) ||
      (row.billing_interval !== 'MONTHLY' && row.billing_interval !== 'YEARLY') ||
      !Number.isSafeInteger(row.price_minor) || row.price_minor < 0 ||
      !/^[A-Z]{3}$/.test(row.currency)) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  let benefits: unknown;
  try {
    benefits = JSON.parse(row.benefits_json) as unknown;
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  if (!Array.isArray(benefits) || benefits.length > 20 ||
      benefits.some((item) => typeof item !== 'string' || item.length < 1 || item.length > 180) ||
      new Set(benefits).size !== benefits.length) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  return {
    planId: row.plan_id,
    planVersion: row.plan_version,
    name: row.name,
    tier: row.tier,
    billingInterval: row.billing_interval,
    priceMinor: row.price_minor,
    currency: row.currency,
    benefits: benefits as string[],
    creatorId: row.owner_id,
  };
}

/**
 * Stores a downgrade request without changing the live Subscription or
 * creating a payment. The selected plan becomes effective only after the
 * existing renewal pipeline confirms the next cycle payment and CAS-updates
 * the authoritative Subscription period.
 */
export async function scheduleSubscriptionPlanDowngrade(
  env: ScheduledPlanDowngradeEnv,
  subscriberIdInput: string,
  subscriptionIdInput: string,
  input: unknown,
  idempotencyKeyInput: string | null,
  ifMatchInput: string | null,
  dependencies: ScheduledPlanDowngradeDependencies = {},
): Promise<ScheduledSubscriptionPlanDowngradeResult> {
  const subscriberId = validatePrincipal(subscriberIdInput);
  const subscriptionId = subscriptionIdInput.trim();
  if (!isBoundedText(subscriptionId)) throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
  const targetPlanId = parseRequest(input);
  const idempotencyKey = validateIdempotencyKey(idempotencyKeyInput);
  const ifMatch = validateIfMatch(ifMatchInput);
  const keyDigest = await sha256BytesToHex(new TextEncoder().encode(
    'membership-plan-downgrade-v1\u0000' + subscriberId + '\u0000' + idempotencyKey,
  )).catch(() => { throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503); });
  const changeId = 'sudc_' + keyDigest;

  const nowDate = (dependencies.now ?? (() => new Date()))();
  if (!(nowDate instanceof Date) || !Number.isFinite(nowDate.getTime())) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  const now = nowDate.toISOString();
  const existing = await readScheduledChangeByIdempotency(env.D1_01, subscriberId, keyDigest);
  if (existing) {
    const change = toScheduledChange(existing);
    if (change.subscriptionId !== subscriptionId || change.targetPlanId !== targetPlanId) {
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
      currentPlanId: change.expectedPlanId,
      targetPlanId: change.targetPlanId,
      targetPlanVersion: change.targetPlanVersion,
      effectiveAt: change.effectiveAt,
      replayed: true,
    };
  }

  const preview = await previewSubscriptionPlanChange(
    env.D1_01, subscriberId, subscriptionId, targetPlanId, { now: () => nowDate },
  );
  if (preview.changeType !== 'DOWNGRADE' || preview.paymentRequired ||
      preview.prorationBaseMinor !== 0 || preview.effectiveAt !== preview.currentPeriodEnd ||
      preview.targetPlan.billingInterval !== preview.currentPlan.billingInterval ||
      preview.targetPlan.currency !== preview.currentPlan.currency ||
      preview.targetPlan.priceMinor >= preview.currentPlan.priceMinor) {
    throw new SubscriptionRuntimeError('INVALID_STATE', 409);
  }
  if (preview.etag !== ifMatch) throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412);
  const expectedVersion = Number(preview.etag.match(/^"lr-v([1-9]\d*)"$/)?.[1]);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }

  try {
    const inserted = await env.D1_01.prepare(
      'INSERT INTO membership_subscription_scheduled_plan_changes ' +
      '(change_id, subscriber_id, subscription_id, expected_subscription_version, expected_plan_id, ' +
      'expected_plan_version, target_plan_id, target_plan_version, effective_at, idempotency_key_hash, ' +
      'status, applied_at, applied_subscription_version, created_at, updated_at, version) ' +
      "SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SCHEDULED', NULL, NULL, ?, ?, 1 " +
      'WHERE EXISTS (SELECT 1 FROM membership_subscriptions s WHERE s.subscription_id = ? AND s.subscriber_id = ? ' +
      "AND s.status = 'ACTIVE' AND s.cancel_at IS NULL AND s.version = ? AND s.plan_id = ? AND s.plan_version = ? " +
      'AND s.current_period_start = ? AND s.current_period_end = ?) ' +
      'AND EXISTS (SELECT 1 FROM membership_plans p WHERE p.plan_id = ? AND p.owner_type = \'CREATOR\' ' +
      'AND p.owner_id = (SELECT creator_id FROM membership_subscriptions WHERE subscription_id = ? AND subscriber_id = ?) ' +
      "AND p.status = 'ACTIVE' AND p.visibility = 'PUBLIC') " +
      "AND NOT EXISTS (SELECT 1 FROM membership_subscription_plan_change_attempts a " +
      "WHERE a.subscription_id = ? AND a.status = 'PENDING_PAYMENT')",
    ).bind(
      changeId, subscriberId, subscriptionId, expectedVersion, preview.currentPlan.planId,
      preview.currentPlan.planVersion, preview.targetPlan.planId, preview.targetPlan.planVersion,
      preview.currentPeriodEnd, keyDigest, now, now,
      subscriptionId, subscriberId, expectedVersion, preview.currentPlan.planId,
      preview.currentPlan.planVersion, preview.currentPeriodStart, preview.currentPeriodEnd,
      preview.targetPlan.planId, subscriptionId, subscriberId, subscriptionId,
    ).run();
    if (Number(inserted.meta?.changes ?? 0) !== 1) {
      const raced = await readScheduledChangeByIdempotency(env.D1_01, subscriberId, keyDigest);
      if (raced) {
        const same = toScheduledChange(raced);
        if (same.subscriptionId === subscriptionId && same.targetPlanId === targetPlanId) {
          return {
            changeId: same.changeId, subscriptionId,
            status: same.status === 'APPLIED' ? 'APPLIED' : 'SCHEDULED',
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
    currentPlanId: preview.currentPlan.planId,
    targetPlanId: preview.targetPlan.planId,
    targetPlanVersion: preview.targetPlan.planVersion,
    effectiveAt: preview.currentPeriodEnd,
    replayed: false,
  };
}
