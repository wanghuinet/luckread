/// <reference types="@cloudflare/workers-types" />

import { sha256BytesToHex } from '../../W10-async/src/canonical-json-idempotency.js';
import {
  etagForVersion,
  SubscriptionRuntimeError,
  validateIdempotencyKey,
  validatePrincipal,
} from './subscription-runtime.js';

type TrialSubscriptionRow = Readonly<{
  subscription_id: string;
  subscriber_id: string;
  plan_id: string;
  plan_version: number;
  creator_id: string | null;
  status: string;
  started_at: string;
  current_period_start: string;
  current_period_end: string;
  cancel_at: string | null;
  updated_at: string;
  version: number;
}>;

type TrialRow = Readonly<{
  trial_id: string;
  subscription_id: string;
  subscriber_id: string;
  plan_id: string;
  plan_version: number;
  source: 'WEB' | 'APP_STORE' | 'PLAY_STORE';
  provider_app_id: string | null;
  product_id: string | null;
  original_transaction_id: string | null;
  started_at: string;
  trial_ends_at: string;
  status: 'TRIALING' | 'CANCELED' | 'PAYMENT_FAILED' | 'CONVERTED' | 'EXPIRED';
  request_hash: string;
  version: number;
  created_at: string;
  updated_at: string;
}>;

type TrialPlanRow = Readonly<{
  plan_id: string;
  owner_type: string;
  owner_id: string;
  current_version: number;
  status: string;
  visibility: string;
  trial_days: number;
}>;

export type MembershipTrialDto = Readonly<{
  trialId: string;
  subscriptionId: string;
  planId: string;
  planVersion: number;
  source: TrialRow['source'];
  startedAt: string;
  trialEndsAt: string;
  status: TrialRow['status'];
  version: number;
}>;

export type StartWebMembershipTrialResult = Readonly<{
  subscription: Readonly<{
    subscriptionId: string;
    subscriberId: string;
    planId: string;
    planVersion: number;
    creatorId: string | null;
    status: string;
    startedAt: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    cancelAt: string | null;
    updatedAt: string;
    version: number;
    etag: string;
  }>;
  trial: MembershipTrialDto;
  replayed: boolean;
  etag: string;
}>;

const PLAN_ID = /^plan_[a-f0-9]{64}$/;
const TRIAL_ID = /^mtr_[A-Za-z0-9]{26}$/;
const SUBSCRIPTION_ID = /^sub_[a-f0-9]{64}$/;
const HASH = /^[a-f0-9]{64}$/;

function boundedText(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function canonicalUtc(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function addTrialDays(start: string, days: number): string {
  if (!canonicalUtc(start) || !Number.isSafeInteger(days) || days < 1 || days > 90) {
    throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
  }
  return new Date(Date.parse(start) + days * 86_400_000).toISOString();
}

async function digest(value: string): Promise<string> {
  try {
    return await sha256BytesToHex(new TextEncoder().encode(value));
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
}

function toTrial(row: TrialRow): MembershipTrialDto {
  if (!TRIAL_ID.test(row.trial_id) || !boundedText(row.subscription_id) ||
      !boundedText(row.subscriber_id) || !PLAN_ID.test(row.plan_id) ||
      !Number.isSafeInteger(row.plan_version) || row.plan_version < 1 ||
      !canonicalUtc(row.started_at) || !canonicalUtc(row.trial_ends_at) ||
      Date.parse(row.trial_ends_at) <= Date.parse(row.started_at) ||
      !Number.isSafeInteger(row.version) || row.version < 1) {
    throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
  }
  return {
    trialId: row.trial_id,
    subscriptionId: row.subscription_id,
    planId: row.plan_id,
    planVersion: row.plan_version,
    source: row.source,
    startedAt: row.started_at,
    trialEndsAt: row.trial_ends_at,
    status: row.status,
    version: row.version,
  };
}

function toSubscription(row: TrialSubscriptionRow) {
  if (!boundedText(row.subscription_id) || !boundedText(row.subscriber_id) ||
      !PLAN_ID.test(row.plan_id) || !Number.isSafeInteger(row.plan_version) ||
      row.plan_version < 1 || !canonicalUtc(row.started_at) ||
      !canonicalUtc(row.current_period_start) || !canonicalUtc(row.current_period_end) ||
      !canonicalUtc(row.updated_at) || !Number.isSafeInteger(row.version) ||
      row.version < 1) {
    throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
  }
  return {
    subscriptionId: row.subscription_id,
    subscriberId: row.subscriber_id,
    planId: row.plan_id,
    planVersion: row.plan_version,
    creatorId: row.creator_id,
    status: row.status,
    startedAt: row.started_at,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    cancelAt: row.cancel_at,
    updatedAt: row.updated_at,
    version: row.version,
    etag: etagForVersion(row.version),
  };
}

async function readTrialBySubscription(db: D1Database, subscriptionId: string): Promise<TrialRow | null> {
  try {
    return await db.prepare(
      'SELECT trial_id, subscription_id, subscriber_id, plan_id, plan_version, source, provider_app_id, ' +
      'product_id, original_transaction_id, started_at, trial_ends_at, status, request_hash, version, created_at, updated_at ' +
      'FROM membership_subscription_trials WHERE subscription_id = ? LIMIT 1',
    ).bind(subscriptionId).first<TrialRow>();
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
}

/**
 * Starts a web trial under the existing Subscription authority. The trial is
 * available only on an active immutable plan version with trial_days > 0 and
 * an already active Hyperswitch MIT mandate; no payment is fabricated at trial
 * start. The existing renewal-cycle scheduler owns the first post-trial charge.
 */
export async function startWebMembershipTrial(
  d1_01: D1Database,
  d1_04: D1Database,
  subscriberIdInput: string,
  planIdInput: string,
  merchantIdInput: string | null | undefined,
  idempotencyKeyInput: string | null,
  dependencies: Readonly<{ now?: () => Date }> = {},
): Promise<StartWebMembershipTrialResult> {
  const subscriberId = validatePrincipal(subscriberIdInput);
  const planId = planIdInput;
  const merchantId = merchantIdInput ?? '';
  const idempotencyKey = validateIdempotencyKey(idempotencyKeyInput);
  if (!PLAN_ID.test(planId) || !boundedText(merchantId)) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
  }

  let nowDate: Date;
  try { nowDate = (dependencies.now ?? (() => new Date()))(); }
  catch { throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503); }
  if (!(nowDate instanceof Date) || !Number.isFinite(nowDate.getTime())) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  const startedAt = nowDate.toISOString();

  let mandate: { mandate_record_id: string } | null;
  try {
    mandate = await d1_04.prepare(
      'SELECT m.mandate_record_id FROM payment_mandates m ' +
      'INNER JOIN saved_payment_methods s ON s.provider = m.provider AND s.merchant_id = m.merchant_id ' +
      'AND s.customer_id = m.customer_id AND s.payment_method_id = m.payment_method_id ' +
      "WHERE m.provider = 'hyperswitch' AND m.merchant_id = ? AND m.customer_id = ? " +
      "AND m.status = 'ACTIVE' AND m.provider_mandate_id IS NOT NULL LIMIT 1",
    ).bind(merchantId, subscriberId).first<{ mandate_record_id: string }>();
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  if (!mandate || !boundedText(mandate.mandate_record_id, 255)) {
    throw new SubscriptionRuntimeError('PAYMENT_MANDATE_REQUIRED', 409);
  }

  let plan: TrialPlanRow | null;
  try {
    plan = await d1_01.prepare(
      'SELECT p.plan_id, p.owner_type, p.owner_id, p.current_version, p.status, p.visibility, v.trial_days ' +
      'FROM membership_plans p INNER JOIN membership_plan_versions v ' +
      'ON v.plan_id = p.plan_id AND v.plan_version = p.current_version ' +
      'WHERE p.plan_id = ? LIMIT 1',
    ).bind(planId).first<TrialPlanRow>();
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  if (!plan || plan.owner_type !== 'CREATOR' || plan.status !== 'ACTIVE' || plan.visibility !== 'PUBLIC') {
    throw new SubscriptionRuntimeError('PLAN_NOT_ACTIVE', 409);
  }
  if (!Number.isSafeInteger(plan.current_version) || plan.current_version < 1 ||
      !Number.isSafeInteger(plan.trial_days) || plan.trial_days < 1 || plan.trial_days > 90) {
    throw new SubscriptionRuntimeError('TRIAL_NOT_AVAILABLE', 409);
  }
  const trialEndsAt = addTrialDays(startedAt, plan.trial_days);
  const requestHash = await digest(JSON.stringify({
    version: 1, source: 'WEB', subscriberId, planId, idempotencyKey,
  }));
  const idempotencyDigest = await digest('membership-web-trial-v1\u0000' + subscriberId + '\u0000' + planId + '\u0000' + idempotencyKey);
  const subscriptionId = 'sub_' + idempotencyDigest;
  const trialId = 'mtr_' + idempotencyDigest.slice(0, 26);

  const existing = await readTrialBySubscription(d1_01, subscriptionId);
  if (existing) {
    if (existing.subscriber_id !== subscriberId || existing.plan_id !== planId ||
        existing.request_hash !== requestHash || existing.source !== 'WEB') {
      throw new SubscriptionRuntimeError('CONFLICT', 409);
    }
    const subscription = await d1_01.prepare(
      'SELECT * FROM membership_subscriptions WHERE subscription_id = ? AND subscriber_id = ? LIMIT 1',
    ).bind(subscriptionId, subscriberId).first<TrialSubscriptionRow>();
    if (!subscription) throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
    return {
      subscription: toSubscription(subscription),
      trial: toTrial(existing),
      replayed: true,
      etag: etagForVersion(subscription.version),
    };
  }

  let prior: { subscription_id: string } | null;
  try {
    prior = await d1_01.prepare(
      "SELECT subscription_id FROM membership_subscriptions WHERE subscriber_id = ? AND creator_id = ? " +
      "AND status IN ('TRIALING','ACTIVE','PAST_DUE') AND current_period_end > ? " +
      "AND (cancel_at IS NULL OR cancel_at > ?) LIMIT 1",
    ).bind(subscriberId, plan.owner_id, startedAt, startedAt).first<{ subscription_id: string }>();
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  if (prior) throw new SubscriptionRuntimeError('INVALID_STATE', 409);

  try {
    const results = await d1_01.batch([
      d1_01.prepare(
        "INSERT INTO membership_subscriptions " +
        "(subscription_id, subscriber_id, plan_id, plan_version, creator_id, status, started_at, current_period_start, current_period_end, cancel_at, entitlement_snapshot_ref, created_at, updated_at, version) " +
        "SELECT ?, ?, p.plan_id, p.current_version, p.owner_id, 'TRIALING', ?, ?, ?, NULL, NULL, ?, ?, 1 " +
        "FROM membership_plans p INNER JOIN membership_plan_versions v ON v.plan_id = p.plan_id AND v.plan_version = p.current_version " +
        "WHERE p.plan_id = ? AND p.owner_type = 'CREATOR' AND p.status = 'ACTIVE' AND p.visibility = 'PUBLIC' " +
        "AND p.current_version = ? AND v.trial_days = ? " +
        "AND NOT EXISTS (SELECT 1 FROM membership_subscriptions s WHERE s.subscriber_id = ? AND s.creator_id = p.owner_id " +
        "AND s.status IN ('TRIALING','ACTIVE','PAST_DUE') AND s.current_period_end > ? AND (s.cancel_at IS NULL OR s.cancel_at > ?))",
      ).bind(
        subscriptionId, subscriberId, startedAt, startedAt, trialEndsAt, startedAt, startedAt,
        planId, plan.current_version, plan.trial_days, subscriberId, startedAt, startedAt,
      ),
      d1_01.prepare(
        'INSERT INTO membership_subscription_trials ' +
        '(trial_id, subscription_id, subscriber_id, plan_id, plan_version, source, provider_app_id, product_id, original_transaction_id, started_at, trial_ends_at, status, request_hash, version, created_at, updated_at) ' +
        "VALUES (?, ?, ?, ?, ?, 'WEB', NULL, NULL, NULL, ?, ?, 'TRIALING', ?, 1, ?, ?)",
      ).bind(
        trialId, subscriptionId, subscriberId, planId, plan.current_version,
        startedAt, trialEndsAt, requestHash, startedAt, startedAt,
      ),
    ]);
    if (results.length !== 2 || Number(results[0]?.meta?.changes ?? 0) !== 1 ||
        Number(results[1]?.meta?.changes ?? 0) !== 1) {
      throw new SubscriptionRuntimeError('CONFLICT', 409);
    }
  } catch (error) {
    if (error instanceof SubscriptionRuntimeError) throw error;
    throw new SubscriptionRuntimeError('CONFLICT', 409);
  }

  const [subscription, trial] = await Promise.all([
    d1_01.prepare('SELECT * FROM membership_subscriptions WHERE subscription_id = ? AND subscriber_id = ? LIMIT 1')
      .bind(subscriptionId, subscriberId).first<TrialSubscriptionRow>(),
    readTrialBySubscription(d1_01, subscriptionId),
  ]);
  if (!subscription || !trial || trial.trial_id !== trialId ||
      trial.request_hash !== requestHash || trial.status !== 'TRIALING' ||
      subscription.status !== 'TRIALING' || subscription.current_period_end !== trialEndsAt) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  const dto = toSubscription(subscription);
  console.log(JSON.stringify({
    event: 'membership.subscription.trial_started',
    subscriptionId, subscriberId, planId, planVersion: trial.plan_version,
    trialEndsAt, source: 'WEB',
  }));
  return { subscription: dto, trial: toTrial(trial), replayed: false, etag: dto.etag };
}

/** Cancel only the trial's future conversion. Current access remains until trial_ends_at. */
export async function cancelWebMembershipTrial(
  db: D1Database,
  subscriberIdInput: string,
  subscriptionIdInput: string,
  ifMatchInput: string | null,
): Promise<Readonly<{ subscription: ReturnType<typeof toSubscription>; trial: MembershipTrialDto; replayed: boolean }>> {
  const subscriberId = validatePrincipal(subscriberIdInput);
  const subscriptionId = subscriptionIdInput;
  const ifMatch = ifMatchInput ?? '';
  const match = /^"lr-v([1-9]\d*)"$/.exec(ifMatch);
  const expectedVersion = match?.[1] ? Number(match[1]) : Number.NaN;
  if (!boundedText(subscriptionId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new SubscriptionRuntimeError(ifMatch ? 'PRECONDITION_FAILED' : 'PRECONDITION_REQUIRED', ifMatch ? 412 : 428);
  }
  const trial = await readTrialBySubscription(db, subscriptionId);
  if (!trial || trial.subscriber_id !== subscriberId || trial.source !== 'WEB') {
    throw new SubscriptionRuntimeError('RESOURCE_NOT_FOUND', 404);
  }
  let subscription = await db.prepare(
    'SELECT * FROM membership_subscriptions WHERE subscription_id = ? AND subscriber_id = ? LIMIT 1',
  ).bind(subscriptionId, subscriberId).first<TrialSubscriptionRow>();
  if (!subscription) throw new SubscriptionRuntimeError('RESOURCE_NOT_FOUND', 404);
  if (trial.status === 'CANCELED' && subscription.cancel_at === trial.trial_ends_at) {
    return { subscription: toSubscription(subscription), trial: toTrial(trial), replayed: true };
  }
  if (subscription.status !== 'TRIALING' || trial.status !== 'TRIALING') {
    throw new SubscriptionRuntimeError('INVALID_STATE', 409);
  }
  if (subscription.version !== expectedVersion) throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412);
  const updatedAt = new Date(Math.max(Date.now(), Date.parse(subscription.updated_at) + 1)).toISOString();
  const results = await db.batch([
    db.prepare(
      "UPDATE membership_subscriptions SET cancel_at = ?, updated_at = ?, version = version + 1 " +
      "WHERE subscription_id = ? AND subscriber_id = ? AND status = 'TRIALING' AND cancel_at IS NULL AND version = ?",
    ).bind(trial.trial_ends_at, updatedAt, subscriptionId, subscriberId, expectedVersion),
    db.prepare(
      "UPDATE membership_subscription_trials SET status = 'CANCELED', version = version + 1, updated_at = ? " +
      "WHERE trial_id = ? AND subscriber_id = ? AND status = 'TRIALING' AND version = ?",
    ).bind(updatedAt, trial.trial_id, subscriberId, trial.version),
  ]);
  if (results.length !== 2 || Number(results[0]?.meta?.changes ?? 0) !== 1 ||
      Number(results[1]?.meta?.changes ?? 0) !== 1) {
    throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412);
  }
  subscription = await db.prepare(
    'SELECT * FROM membership_subscriptions WHERE subscription_id = ? AND subscriber_id = ? LIMIT 1',
  ).bind(subscriptionId, subscriberId).first<TrialSubscriptionRow>();
  const updatedTrial = await readTrialBySubscription(db, subscriptionId);
  if (!subscription || !updatedTrial || updatedTrial.status !== 'CANCELED' ||
      subscription.cancel_at !== trial.trial_ends_at) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  return { subscription: toSubscription(subscription), trial: toTrial(updatedTrial), replayed: false };
}

/** Returns the subscriber-visible trial record without exposing provider payment identifiers. */
export async function getMembershipTrialDetails(
  db: D1Database,
  subscriberIdInput: string,
  subscriptionIdInput: string,
): Promise<MembershipTrialDto | null> {
  const subscriberId = validatePrincipal(subscriberIdInput);
  let row: TrialRow | null;
  try {
    row = await db.prepare(
      'SELECT trial_id, subscription_id, subscriber_id, plan_id, plan_version, source, provider_app_id, ' +
      'product_id, original_transaction_id, started_at, trial_ends_at, status, request_hash, version, created_at, updated_at ' +
      'FROM membership_subscription_trials WHERE subscription_id = ? AND subscriber_id = ? LIMIT 1',
    ).bind(subscriptionIdInput, subscriberId).first<TrialRow>();
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  return row ? toTrial(row) : null;
}

/**
 * Store trials are authoritative in App Store / Google Play via RevenueCat.
 * Expiry merely closes D1-01 access after the store-reported trial term ends;
 * it never creates or charges a web order.
 */
export async function expireDueStoreMembershipTrials(
  db: D1Database,
  now = new Date(),
  limit = 100,
): Promise<Readonly<{ scanned: number; expired: number }>> {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  const safeLimit = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), 200) : 100;
  const nowIsoValue = now.toISOString();
  const rows = (await db.prepare(
    "SELECT t.trial_id, t.subscription_id, t.subscriber_id, t.status AS trial_status, t.version AS trial_version, " +
    "s.version AS subscription_version, s.status AS subscription_status, s.updated_at AS subscription_updated_at " +
    "FROM membership_subscription_trials t INNER JOIN membership_subscriptions s " +
    "ON s.subscription_id = t.subscription_id AND s.subscriber_id = t.subscriber_id " +
    "WHERE t.source IN ('APP_STORE','PLAY_STORE') AND t.status IN ('TRIALING','CANCELED','PAYMENT_FAILED') " +
    "AND t.trial_ends_at <= ? AND s.status IN ('TRIALING','PAST_DUE') " +
    "ORDER BY t.trial_ends_at ASC, t.trial_id ASC LIMIT ?",
  ).bind(nowIsoValue, safeLimit).all<{
    trial_id: string; subscription_id: string; subscriber_id: string;
    trial_status: TrialRow['status']; trial_version: number;
    subscription_version: number; subscription_status: string; subscription_updated_at: string;
  }>()).results ?? [];
  let expired = 0;
  for (const row of rows) {
    const updatedAt = new Date(Math.max(Date.parse(nowIsoValue), Date.parse(row.subscription_updated_at) + 1)).toISOString();
    const result = await db.prepare(
      "UPDATE membership_subscriptions SET status = 'EXPIRED', updated_at = ?, version = version + 1 " +
      "WHERE subscription_id = ? AND subscriber_id = ? AND status IN ('TRIALING','PAST_DUE') AND version = ?",
    ).bind(updatedAt, row.subscription_id, row.subscriber_id, row.subscription_version).run();
    // The D1-01 AFTER UPDATE trigger transitions the linked trial record in the
    // same database statement; do not race it with a second explicit update.
    if (Number(result.meta?.changes ?? 0) === 1) expired += 1;
  }
  return { scanned: rows.length, expired };
}


export type RevenueCatStoreTrialCandidate = Readonly<{
  planId: string;
  planVersion: number;
  creatorId: string;
  store: 'APP_STORE' | 'PLAY_STORE';
  productId: string;
  currentState: 'TRIALING' | 'ACTIVE' | 'EXPIRED' | 'REFUNDED';
  purchaseDate: string;
  effectiveExpiresAt: string | null;
  originalTransactionId: string | number | null;
  periodType: string | null;
  unsubscribeDetectedAt: string | null;
}>;

export type RevenueCatStoreTrialSyncResult = Readonly<{
  created: number;
  canceled: number;
  converted: number;
  expired: number;
  unchanged: number;
}>;

function canonicalDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
  return date.toISOString();
}

async function readStoreTrial(
  db: D1Database,
  source: 'APP_STORE' | 'PLAY_STORE',
  appId: string,
  originalTransactionId: string,
): Promise<TrialRow | null> {
  try {
    return await db.prepare(
      'SELECT trial_id, subscription_id, subscriber_id, plan_id, plan_version, source, provider_app_id, ' +
      'product_id, original_transaction_id, started_at, trial_ends_at, status, request_hash, version, created_at, updated_at ' +
      'FROM membership_subscription_trials WHERE source = ? AND provider_app_id = ? AND original_transaction_id = ? LIMIT 1',
    ).bind(source, appId, originalTransactionId).first<TrialRow>();
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
}

async function applyStoreTrialCancellation(
  db: D1Database,
  trial: TrialRow,
  subscription: TrialSubscriptionRow,
): Promise<boolean> {
  if (trial.status === 'CANCELED' && subscription.cancel_at === trial.trial_ends_at) return false;
  if (trial.status !== 'TRIALING' || subscription.status !== 'TRIALING') {
    throw new SubscriptionRuntimeError('CONFLICT', 409);
  }
  const updatedAt = new Date(Math.max(Date.now(), Date.parse(subscription.updated_at) + 1)).toISOString();
  const results = await db.batch([
    db.prepare(
      "UPDATE membership_subscriptions SET cancel_at = ?, updated_at = ?, version = version + 1 " +
      "WHERE subscription_id = ? AND subscriber_id = ? AND status = 'TRIALING' AND cancel_at IS NULL AND version = ?",
    ).bind(trial.trial_ends_at, updatedAt, subscription.subscription_id, subscription.subscriber_id, subscription.version),
    db.prepare(
      "UPDATE membership_subscription_trials SET status = 'CANCELED', version = version + 1, updated_at = ? " +
      "WHERE trial_id = ? AND subscriber_id = ? AND status = 'TRIALING' AND version = ?",
    ).bind(updatedAt, trial.trial_id, trial.subscriber_id, trial.version),
  ]);
  if (results.length !== 2 || Number(results[0]?.meta?.changes ?? 0) !== 1 ||
      Number(results[1]?.meta?.changes ?? 0) !== 1) {
    throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412);
  }
  return true;
}

/**
 * Materializes store trial/renewal lifecycle from a RevenueCat current customer
 * snapshot whose queried App User ID has already been verified against W02.
 * This is the only store-trial D1-01 write path; client-supplied purchase data
 * is never accepted and RevenueCat webhook inbox rows remain receipt-only.
 */
export async function syncRevenueCatStoreTrialCandidates(
  db: D1Database,
  subscriberIdInput: string,
  appIdInput: string,
  candidates: readonly RevenueCatStoreTrialCandidate[],
): Promise<RevenueCatStoreTrialSyncResult> {
  const subscriberId = validatePrincipal(subscriberIdInput);
  if (!boundedText(appIdInput, 255) || !Array.isArray(candidates) || candidates.length > 256) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
  }

  let created = 0;
  let canceled = 0;
  let converted = 0;
  let expired = 0;
  let unchanged = 0;

  for (const candidate of candidates) {
    if (candidate.currentState === 'TRIALING' && candidate.periodType !== 'TRIAL') {
      throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
    }
    if (candidate.periodType !== 'TRIAL' &&
        candidate.currentState !== 'ACTIVE' &&
        candidate.currentState !== 'EXPIRED' &&
        candidate.currentState !== 'REFUNDED') {
      continue;
    }
    const originalTransactionId = candidate.originalTransactionId === null
      ? ''
      : String(candidate.originalTransactionId);
    if (!boundedText(originalTransactionId, 255) ||
        !boundedText(candidate.productId, 255) ||
        !PLAN_ID.test(candidate.planId) ||
        !Number.isSafeInteger(candidate.planVersion) || candidate.planVersion < 1 ||
        !boundedText(candidate.creatorId) ||
        (candidate.store !== 'APP_STORE' && candidate.store !== 'PLAY_STORE')) {
      if (candidate.periodType === 'TRIAL' || candidate.currentState === 'TRIALING') {
        throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
      }
      continue;
    }

    const existing = await readStoreTrial(db, candidate.store, appIdInput, originalTransactionId);
    if (!existing) {
      if (candidate.currentState !== 'TRIALING' || candidate.periodType !== 'TRIAL' ||
          !candidate.effectiveExpiresAt) {
        unchanged += 1;
        continue;
      }
      const startedAt = canonicalDate(candidate.purchaseDate);
      const trialEndsAt = canonicalDate(candidate.effectiveExpiresAt);
      if (Date.parse(trialEndsAt) <= Date.parse(startedAt)) {
        throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
      }
      const identityMaterial = 'revenuecat-store-trial-v1\u0000' + candidate.store + '\u0000' +
        appIdInput + '\u0000' + originalTransactionId;
      const identityHash = await digest(identityMaterial);
      const subscriptionId = 'sub_' + identityHash;
      const trialId = 'mtr_' + identityHash.slice(0, 26);
      const requestHash = await digest(JSON.stringify({
        version: 1, subscriberId, appId: appIdInput, source: candidate.store,
        originalTransactionId, planId: candidate.planId, planVersion: candidate.planVersion,
      }));
      const cancelAt = candidate.unsubscribeDetectedAt ? trialEndsAt : null;
      try {
        const results = await db.batch([
          db.prepare(
            'INSERT INTO membership_subscriptions ' +
            '(subscription_id, subscriber_id, plan_id, plan_version, creator_id, status, started_at, current_period_start, current_period_end, cancel_at, entitlement_snapshot_ref, created_at, updated_at, version) ' +
            "VALUES (?, ?, ?, ?, ?, 'TRIALING', ?, ?, ?, ?, NULL, ?, ?, 1)",
          ).bind(
            subscriptionId, subscriberId, candidate.planId, candidate.planVersion, candidate.creatorId,
            startedAt, startedAt, trialEndsAt, cancelAt, startedAt, startedAt,
          ),
          db.prepare(
            'INSERT INTO membership_subscription_trials ' +
            '(trial_id, subscription_id, subscriber_id, plan_id, plan_version, source, provider_app_id, product_id, original_transaction_id, started_at, trial_ends_at, status, request_hash, version, created_at, updated_at) ' +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
          ).bind(
            trialId, subscriptionId, subscriberId, candidate.planId, candidate.planVersion,
            candidate.store, appIdInput, candidate.productId, originalTransactionId, startedAt,
            trialEndsAt, cancelAt ? 'CANCELED' : 'TRIALING', requestHash, startedAt, startedAt,
          ),
        ]);
        if (results.length !== 2 || Number(results[0]?.meta?.changes ?? 0) !== 1 ||
            Number(results[1]?.meta?.changes ?? 0) !== 1) {
          throw new SubscriptionRuntimeError('CONFLICT', 409);
        }
        created += 1;
        if (cancelAt) canceled += 1;
      } catch (error) {
        if (error instanceof SubscriptionRuntimeError) throw error;
        throw new SubscriptionRuntimeError('CONFLICT', 409);
      }
      continue;
    }

    if (existing.subscriber_id !== subscriberId || existing.plan_id !== candidate.planId ||
        existing.plan_version !== candidate.planVersion || existing.source !== candidate.store ||
        existing.provider_app_id !== appIdInput || existing.product_id !== candidate.productId) {
      throw new SubscriptionRuntimeError('CONFLICT', 409);
    }

    let subscription: TrialSubscriptionRow | null;
    try {
      subscription = await db.prepare(
        'SELECT * FROM membership_subscriptions WHERE subscription_id = ? AND subscriber_id = ? LIMIT 1',
      ).bind(existing.subscription_id, subscriberId).first<TrialSubscriptionRow>();
    } catch {
      throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
    }
    if (!subscription) throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);

    if (candidate.periodType === 'TRIAL' && candidate.currentState === 'TRIALING') {
      if (candidate.unsubscribeDetectedAt && existing.status === 'TRIALING') {
        if (await applyStoreTrialCancellation(db, existing, subscription)) canceled += 1;
        else unchanged += 1;
      } else {
        unchanged += 1;
      }
      continue;
    }

    if (candidate.currentState === 'ACTIVE' && candidate.periodType !== 'TRIAL' &&
        ['TRIALING','CANCELED','PAYMENT_FAILED'].includes(existing.status)) {
      if (!candidate.effectiveExpiresAt) throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
      const paidPeriodEnd = canonicalDate(candidate.effectiveExpiresAt);
      const paidPeriodStart = existing.trial_ends_at;
      if (Date.parse(paidPeriodEnd) <= Date.parse(paidPeriodStart)) {
        throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
      }
      const cancelAt = candidate.unsubscribeDetectedAt ? paidPeriodEnd : null;
      const updatedAt = new Date(Math.max(Date.now(), Date.parse(subscription.updated_at) + 1)).toISOString();
      const result = await db.prepare(
        "UPDATE membership_subscriptions SET status = 'ACTIVE', current_period_start = ?, current_period_end = ?, " +
        'cancel_at = ?, updated_at = ?, version = version + 1 ' +
        "WHERE subscription_id = ? AND subscriber_id = ? AND status IN ('TRIALING','PAST_DUE') AND version = ?",
      ).bind(
        paidPeriodStart, paidPeriodEnd, cancelAt, updatedAt,
        subscription.subscription_id, subscriberId, subscription.version,
      ).run();
      if (Number(result.meta?.changes ?? 0) !== 1) throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412);
      converted += 1;
      continue;
    }

    if ((candidate.currentState === 'EXPIRED' || candidate.currentState === 'REFUNDED') &&
        ['TRIALING','CANCELED','PAYMENT_FAILED'].includes(existing.status) &&
        subscription.status !== 'EXPIRED') {
      const updatedAt = new Date(Math.max(Date.now(), Date.parse(subscription.updated_at) + 1)).toISOString();
      const result = await db.prepare(
        "UPDATE membership_subscriptions SET status = 'EXPIRED', updated_at = ?, version = version + 1 " +
        "WHERE subscription_id = ? AND subscriber_id = ? AND status IN ('TRIALING','PAST_DUE') AND version = ?",
      ).bind(updatedAt, subscription.subscription_id, subscriberId, subscription.version).run();
      if (Number(result.meta?.changes ?? 0) !== 1) throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412);
      expired += 1;
      continue;
    }

    unchanged += 1;
  }

  return { created, canceled, converted, expired, unchanged };
}
