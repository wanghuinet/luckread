/// <reference types="@cloudflare/workers-types" />

import { sha256BytesToHex } from '../../W10-async/src/canonical-json-idempotency.js';
import {
  etagForVersion,
  SubscriptionRuntimeError,
  validateIdempotencyKey,
  validatePrincipal,
} from './subscription-runtime.js';

type SubscriptionPlanChangeSourceRow = Readonly<{
  subscription_id: string;
  subscriber_id: string;
  plan_id: string;
  plan_version: number;
  creator_id: string | null;
  status: string;
  current_period_start: string;
  current_period_end: string;
  cancel_at: string | null;
  updated_at: string;
  version: number;
  name: string;
  tier: string;
  billing_interval: string;
  price_minor: number;
  currency: string;
}>;

type SubscriptionPlanChangeTargetRow = Readonly<{
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

type ScheduledPlanChangeRow = Readonly<{
  change_id: string;
  subscription_id: string;
  subscriber_id: string;
  source_plan_id: string;
  source_plan_version: number;
  target_plan_id: string;
  target_plan_version: number;
  change_type: 'DOWNGRADE' | 'BILLING_INTERVAL_CHANGE' | 'SAME_PRICE_CHANGE';
  effective_at: string;
  status: 'SCHEDULED' | 'APPLIED' | 'CANCELED';
  request_hash: string;
  version: number;
  created_at: string;
  updated_at: string;
}>;

export type ScheduledSubscriptionPlanChangeDto = Readonly<{
  changeId: string;
  subscriptionId: string;
  sourcePlanId: string;
  sourcePlanVersion: number;
  targetPlanId: string;
  targetPlanVersion: number;
  changeType: ScheduledPlanChangeRow['change_type'];
  status: ScheduledPlanChangeRow['status'];
  effectiveAt: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  subscriptionVersion: number;
  etag: string;
  replayed: boolean;
}>;

export type ScheduleSubscriptionPlanChangeDependencies = Readonly<{
  now?: () => Date;
}>;

const PLAN_ID_PATTERN = /^plan_[a-f0-9]{64}$/;
const CHANGE_ID_PATTERN = /^spc_[A-Za-z0-9]{26}$/;
const MAX_MINOR = 2_147_483_647;

function isBoundedText(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function isCanonicalIso(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function validPlan(
  value: {
    plan_id: string;
    current_version: number;
    name: string;
    tier: string;
    billing_interval: string;
    price_minor: number;
    currency: string;
  },
): boolean {
  return PLAN_ID_PATTERN.test(value.plan_id) &&
    Number.isSafeInteger(value.current_version) && value.current_version >= 1 &&
    typeof value.name === 'string' && value.name.trim().length > 0 && value.name.length <= 120 &&
    typeof value.tier === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(value.tier) &&
    (value.billing_interval === 'MONTHLY' || value.billing_interval === 'YEARLY') &&
    Number.isSafeInteger(value.price_minor) && value.price_minor >= 0 && value.price_minor <= MAX_MINOR &&
    typeof value.currency === 'string' && /^[A-Z]{3}$/.test(value.currency);
}

function versionFromIfMatch(value: string): number {
  const match = /^"lr-v([1-9]\d*)"$/.exec(value);
  const version = match?.[1] ? Number(match[1]) : Number.NaN;
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412);
  }
  return version;
}

function nextTimestamp(now: string, previous: string): string {
  const previousMs = Date.parse(previous);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(previousMs) || !Number.isFinite(nowMs)) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  return new Date(Math.max(nowMs, previousMs + 1)).toISOString();
}

async function idsForRequest(
  subscriberId: string,
  subscriptionId: string,
  targetPlanId: string,
  idempotencyKey: string,
): Promise<Readonly<{ changeId: string; requestHash: string }>> {
  const keyMaterial = new TextEncoder().encode(
    'subscription-plan-change-v1\u0000' + subscriberId + '\u0000' + idempotencyKey,
  );
  const requestMaterial = new TextEncoder().encode(
    JSON.stringify({ subscriptionId, targetPlanId }),
  );
  try {
    const [keyHash, requestHash] = await Promise.all([
      sha256BytesToHex(keyMaterial),
      sha256BytesToHex(requestMaterial),
    ]);
    return { changeId: 'spc_' + keyHash.slice(0, 26), requestHash };
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
}

function toPublic(
  row: ScheduledPlanChangeRow,
  subscriptionVersion: number,
  replayed: boolean,
): ScheduledSubscriptionPlanChangeDto {
  if (!CHANGE_ID_PATTERN.test(row.change_id) ||
      !isBoundedText(row.subscription_id) ||
      !isBoundedText(row.subscriber_id) ||
      !PLAN_ID_PATTERN.test(row.source_plan_id) ||
      !PLAN_ID_PATTERN.test(row.target_plan_id) ||
      !Number.isSafeInteger(row.source_plan_version) || row.source_plan_version < 1 ||
      !Number.isSafeInteger(row.target_plan_version) || row.target_plan_version < 1 ||
      !isCanonicalIso(row.effective_at) ||
      !isCanonicalIso(row.created_at) || !isCanonicalIso(row.updated_at) ||
      !Number.isSafeInteger(row.version) || row.version < 1 ||
      !Number.isSafeInteger(subscriptionVersion) || subscriptionVersion < 1) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  return {
    changeId: row.change_id,
    subscriptionId: row.subscription_id,
    sourcePlanId: row.source_plan_id,
    sourcePlanVersion: row.source_plan_version,
    targetPlanId: row.target_plan_id,
    targetPlanVersion: row.target_plan_version,
    changeType: row.change_type,
    status: row.status,
    effectiveAt: row.effective_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    subscriptionVersion,
    etag: etagForVersion(subscriptionVersion),
    replayed,
  };
}

async function readChangeById(db: D1Database, changeId: string): Promise<ScheduledPlanChangeRow | null> {
  try {
    return await db.prepare(
      'SELECT change_id, subscription_id, subscriber_id, source_plan_id, source_plan_version, ' +
      'target_plan_id, target_plan_version, change_type, effective_at, status, request_hash, ' +
      'version, created_at, updated_at FROM membership_subscription_plan_changes ' +
      'WHERE change_id = ? LIMIT 1',
    ).bind(changeId).first<ScheduledPlanChangeRow>();
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
}

/**
 * Schedules a downgrade or billing-interval change for the current period end.
 * It does not create an Order, charge a Payment, or change current entitlements.
 * The plan switch is completed by the verified renewal outcome sync only.
 */
export async function scheduleSubscriptionPlanChange(
  db: D1Database,
  subscriberIdInput: string,
  subscriptionIdInput: string,
  targetPlanIdInput: string,
  ifMatchInput: string | null,
  idempotencyKeyInput: string | null,
  dependencies: ScheduleSubscriptionPlanChangeDependencies = {},
): Promise<ScheduledSubscriptionPlanChangeDto> {
  const subscriberId = validatePrincipal(subscriberIdInput);
  const subscriptionId = subscriptionIdInput.trim();
  const targetPlanId = targetPlanIdInput.trim();
  if (subscriptionId !== subscriptionIdInput || !isBoundedText(subscriptionId) ||
      targetPlanId !== targetPlanIdInput || !PLAN_ID_PATTERN.test(targetPlanId)) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
  }
  const ifMatch = ifMatchInput?.trim() ?? '';
  if (!ifMatch) throw new SubscriptionRuntimeError('PRECONDITION_REQUIRED', 428);
  const expectedVersion = versionFromIfMatch(ifMatch);
  const idempotencyKey = validateIdempotencyKey(idempotencyKeyInput);
  if (idempotencyKey !== idempotencyKeyInput || /[\u0000-\u001f\u007f]/.test(idempotencyKey)) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
  }

  const ids = await idsForRequest(subscriberId, subscriptionId, targetPlanId, idempotencyKey);
  const existing = await readChangeById(db, ids.changeId);
  if (existing) {
    if (existing.subscriber_id !== subscriberId ||
        existing.subscription_id !== subscriptionId ||
        existing.request_hash !== ids.requestHash ||
        existing.target_plan_id !== targetPlanId) {
      throw new SubscriptionRuntimeError('CONFLICT', 409);
    }
    const current = await db.prepare(
      'SELECT version FROM membership_subscriptions WHERE subscription_id = ? AND subscriber_id = ? LIMIT 1',
    ).bind(subscriptionId, subscriberId).first<{ version: number }>();
    return toPublic(existing, current?.version ?? expectedVersion + 1, true);
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
  const now = nowDate.toISOString();

  let source: SubscriptionPlanChangeSourceRow | null;
  try {
    source = await db.prepare(
      'SELECT s.subscription_id, s.subscriber_id, s.plan_id, s.plan_version, s.creator_id, s.status, ' +
      's.current_period_start, s.current_period_end, s.cancel_at, s.updated_at, s.version, ' +
      'v.name, v.tier, v.billing_interval, v.price_minor, v.currency ' +
      'FROM membership_subscriptions s ' +
      'INNER JOIN membership_plan_versions v ON v.plan_id = s.plan_id AND v.plan_version = s.plan_version ' +
      'WHERE s.subscription_id = ? AND s.subscriber_id = ? LIMIT 1',
    ).bind(subscriptionId, subscriberId).first<SubscriptionPlanChangeSourceRow>();
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  if (!source) throw new SubscriptionRuntimeError('RESOURCE_NOT_FOUND', 404);
  if (source.version !== expectedVersion) throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412);
  if (source.status !== 'ACTIVE' || source.cancel_at !== null ||
      !isCanonicalIso(source.current_period_start) || !isCanonicalIso(source.current_period_end) ||
      source.current_period_end <= now || source.current_period_start >= source.current_period_end ||
      !isCanonicalIso(source.updated_at) ||
      !validPlan({
        plan_id: source.plan_id,
        current_version: source.plan_version,
        name: source.name,
        tier: source.tier,
        billing_interval: source.billing_interval,
        price_minor: source.price_minor,
        currency: source.currency,
      })) {
    throw new SubscriptionRuntimeError('INVALID_STATE', 409);
  }

  let target: SubscriptionPlanChangeTargetRow | null;
  try {
    target = await db.prepare(
      'SELECT p.plan_id, p.owner_type, p.owner_id, p.current_version, p.status, p.visibility, ' +
      'v.name, v.tier, v.billing_interval, v.price_minor, v.currency ' +
      'FROM membership_plans p ' +
      'INNER JOIN membership_plan_versions v ON v.plan_id = p.plan_id AND v.plan_version = p.current_version ' +
      'WHERE p.plan_id = ? LIMIT 1',
    ).bind(targetPlanId).first<SubscriptionPlanChangeTargetRow>();
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  if (!target || target.owner_type !== 'CREATOR' || target.owner_id !== source.creator_id ||
      target.status !== 'ACTIVE' || target.visibility !== 'PUBLIC') {
    throw new SubscriptionRuntimeError('PLAN_NOT_ACTIVE', 409);
  }
  if (!validPlan({
    plan_id: target.plan_id,
    current_version: target.current_version,
    name: target.name,
    tier: target.tier,
    billing_interval: target.billing_interval,
    price_minor: target.price_minor,
    currency: target.currency,
  })) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  if (target.currency !== source.currency) throw new SubscriptionRuntimeError('CONFLICT', 409);
  if (target.plan_id === source.plan_id && target.current_version === source.plan_version) {
    throw new SubscriptionRuntimeError('INVALID_STATE', 409);
  }

  let changeType: ScheduledPlanChangeRow['change_type'];
  if (target.billing_interval !== source.billing_interval) {
    changeType = 'BILLING_INTERVAL_CHANGE';
  } else if (target.price_minor < source.price_minor) {
    changeType = 'DOWNGRADE';
  } else if (target.price_minor === source.price_minor) {
    changeType = 'SAME_PRICE_CHANGE';
  } else {
    // Immediate upgrades require a customer-present proration Order and verified
    // payment. They remain closed until the separate upgrade-payment module exists.
    throw new SubscriptionRuntimeError('PAYMENT_REQUIRED', 409);
  }

  const updatedAt = nextTimestamp(now, source.updated_at);
  const change: ScheduledPlanChangeRow = {
    change_id: ids.changeId,
    subscription_id: source.subscription_id,
    subscriber_id: source.subscriber_id,
    source_plan_id: source.plan_id,
    source_plan_version: source.plan_version,
    target_plan_id: target.plan_id,
    target_plan_version: target.current_version,
    change_type: changeType,
    effective_at: source.current_period_end,
    status: 'SCHEDULED',
    request_hash: ids.requestHash,
    version: 1,
    created_at: now,
    updated_at: now,
  };

  let results: D1Result[];
  try {
    results = await db.batch([
      db.prepare(
        'INSERT INTO membership_subscription_plan_changes ' +
        '(change_id, subscription_id, subscriber_id, source_plan_id, source_plan_version, ' +
        'target_plan_id, target_plan_version, change_type, effective_at, status, request_hash, version, created_at, updated_at) ' +
        'SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, \'SCHEDULED\', ?, 1, ?, ? ' +
        'WHERE EXISTS (SELECT 1 FROM membership_subscriptions WHERE subscription_id = ? AND subscriber_id = ? AND status = \'ACTIVE\' AND cancel_at IS NULL AND version = ? AND current_period_end = ?) ' +
        'AND EXISTS (SELECT 1 FROM membership_plans WHERE plan_id = ? AND owner_type = \'CREATOR\' AND owner_id = ? AND status = \'ACTIVE\' AND visibility = \'PUBLIC\' AND current_version = ?)',
      ).bind(
        change.change_id, change.subscription_id, change.subscriber_id,
        change.source_plan_id, change.source_plan_version, change.target_plan_id, change.target_plan_version,
        change.change_type, change.effective_at, change.request_hash, change.created_at, change.updated_at,
        subscriptionId, subscriberId, expectedVersion, source.current_period_end,
        target.plan_id, source.creator_id, target.current_version,
      ),
      db.prepare(
        'UPDATE membership_subscriptions SET version = version + 1, updated_at = ? ' +
        'WHERE subscription_id = ? AND subscriber_id = ? AND version = ? AND status = \'ACTIVE\' ' +
        'AND EXISTS (SELECT 1 FROM membership_subscription_plan_changes WHERE change_id = ? AND status = \'SCHEDULED\')',
      ).bind(updatedAt, subscriptionId, subscriberId, expectedVersion, change.change_id),
    ]);
  } catch (error) {
    if (error instanceof Error && /unique/i.test(error.message)) {
      const replay = await readChangeById(db, ids.changeId);
      if (replay && replay.request_hash === ids.requestHash) {
        const latest = await db.prepare(
          'SELECT version FROM membership_subscriptions WHERE subscription_id = ? AND subscriber_id = ? LIMIT 1',
        ).bind(subscriptionId, subscriberId).first<{ version: number }>();
        return toPublic(replay, latest?.version ?? expectedVersion + 1, true);
      }
      throw new SubscriptionRuntimeError('CONFLICT', 409);
    }
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  if (results.length !== 2 || Number(results[0]?.meta?.changes ?? 0) !== 1 ||
      Number(results[1]?.meta?.changes ?? 0) !== 1) {
    const replay = await readChangeById(db, ids.changeId);
    if (replay && replay.request_hash === ids.requestHash) {
      const latest = await db.prepare(
        'SELECT version FROM membership_subscriptions WHERE subscription_id = ? AND subscriber_id = ? LIMIT 1',
      ).bind(subscriptionId, subscriberId).first<{ version: number }>();
      return toPublic(replay, latest?.version ?? expectedVersion + 1, true);
    }
    throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412);
  }

  console.log(JSON.stringify({
    event: 'membership.subscription.plan_change_scheduled',
    changeId: change.change_id,
    subscriptionId: change.subscription_id,
    subscriberId: change.subscriber_id,
    sourcePlanId: change.source_plan_id,
    targetPlanId: change.target_plan_id,
    effectiveAt: change.effective_at,
    changeType: change.change_type,
  }));
  return toPublic(change, expectedVersion + 1, false);
}


export type ScheduledSubscriptionPlanChangeReadDto = Readonly<{
  changeId: string;
  status: 'SCHEDULED';
  changeType: ScheduledPlanChangeRow['change_type'];
  effectiveAt: string;
  version: number;
  targetPlan: Readonly<{
    planId: string;
    planVersion: number;
    name: string;
    tier: string;
    billingInterval: 'MONTHLY' | 'YEARLY';
    priceMinor: number;
    currency: string;
  }>;
}>;

/** Subscriber-owned read of the one pending plan change, if any. */
export async function getScheduledSubscriptionPlanChange(
  db: D1Database,
  subscriberIdInput: string,
  subscriptionIdInput: string,
): Promise<ScheduledSubscriptionPlanChangeReadDto | null> {
  const subscriberId = validatePrincipal(subscriberIdInput);
  const subscriptionId = subscriptionIdInput.trim();
  if (subscriptionId !== subscriptionIdInput || !isBoundedText(subscriptionId)) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
  }

  let row: (ScheduledPlanChangeRow & {
    name: string;
    tier: string;
    billing_interval: string;
    price_minor: number;
    currency: string;
  }) | null;
  try {
    row = await db.prepare(
      'SELECT sc.change_id, sc.subscription_id, sc.subscriber_id, sc.source_plan_id, ' +
      'sc.source_plan_version, sc.target_plan_id, sc.target_plan_version, sc.change_type, ' +
      'sc.effective_at, sc.status, sc.request_hash, sc.version, sc.created_at, sc.updated_at, ' +
      'pv.name, pv.tier, pv.billing_interval, pv.price_minor, pv.currency ' +
      'FROM membership_subscription_plan_changes sc ' +
      'INNER JOIN membership_subscriptions s ON s.subscription_id = sc.subscription_id AND s.subscriber_id = sc.subscriber_id ' +
      'INNER JOIN membership_plan_versions pv ON pv.plan_id = sc.target_plan_id AND pv.plan_version = sc.target_plan_version ' +
      "WHERE sc.subscription_id = ? AND sc.subscriber_id = ? AND sc.status = 'SCHEDULED' " +
      'AND s.plan_id = sc.source_plan_id AND s.plan_version = sc.source_plan_version LIMIT 1',
    ).bind(subscriptionId, subscriberId).first<(ScheduledPlanChangeRow & {
      name: string; tier: string; billing_interval: string; price_minor: number; currency: string;
    })>();
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  if (!row) return null;
  const dto = toPublic(row, 1, false);
  if (!['DOWNGRADE', 'BILLING_INTERVAL_CHANGE', 'SAME_PRICE_CHANGE'].includes(row.change_type) ||
      typeof row.name !== 'string' || !row.name.trim() || row.name.length > 120 ||
      !/^[a-z][a-z0-9_-]{0,63}$/.test(row.tier) ||
      (row.billing_interval !== 'MONTHLY' && row.billing_interval !== 'YEARLY') ||
      !Number.isSafeInteger(row.price_minor) || row.price_minor < 0 || row.price_minor > MAX_MINOR ||
      !/^[A-Z]{3}$/.test(row.currency)) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  return {
    changeId: dto.changeId,
    status: 'SCHEDULED',
    changeType: dto.changeType,
    effectiveAt: dto.effectiveAt,
    version: dto.version,
    targetPlan: {
      planId: row.target_plan_id,
      planVersion: row.target_plan_version,
      name: row.name,
      tier: row.tier,
      billingInterval: row.billing_interval,
      priceMinor: row.price_minor,
      currency: row.currency,
    },
  };
}
