/// <reference types="@cloudflare/workers-types" />

import { strictlyAfterCanonicalUtcTimestamp } from './canonical-utc-timestamp.js';

export type RenewalSubscriptionSyncOutcome =
  | 'APPLIED' | 'ALREADY_APPLIED' | 'NO_RENEWAL_CYCLE' | 'NOT_TERMINAL'
  | 'RECONCILIATION_REQUIRED' | 'PENDING_RETRY';

export class RenewalOutcomeSyncError extends Error {
  constructor(readonly code: 'VALIDATION_FAILED' | 'SERVICE_UNAVAILABLE', readonly status: number) {
    super(code);
    this.name = 'RenewalOutcomeSyncError';
  }
}

type RenewalOutcomeCycle = Readonly<{
  cycle_id: string; provider: string; merchant_id: string; subscription_id: string;
  subscriber_id: string; plan_id: string; plan_version: number; cycle_start: string; cycle_end: string;
  amount_minor: number | null; order_id: string | null; payment_id: string | null; state: string;
  provider_response_status: string | null; pricing_snapshot_json: string | null;
  subscription_sync_state: 'PENDING' | 'APPLIED' | 'RECONCILIATION_REQUIRED';
  subscription_sync_updated_at: string | null; subscription_sync_error_code: string | null;
  version: number; updated_at: string;
}>;

type SubscriptionOutcomeRow = Readonly<{
  subscription_id: string; subscriber_id: string; plan_id: string; plan_version: number;
  status: 'PENDING' | 'ACTIVE' | 'PAST_DUE' | 'PAUSED' | 'CANCELED' | 'EXPIRED';
  current_period_start: string; current_period_end: string; cancel_at: string | null;
  pending_plan_id: string | null; pending_plan_version: number | null;
  pending_plan_effective_at: string | null; pending_plan_change_id: string | null;
  updated_at: string; version: number;
}>;

export type RenewalOutcomeSyncResult = Readonly<{
  cycleId: string;
  subscriptionId?: string;
  outcome: RenewalSubscriptionSyncOutcome;
  reasonCode?: string;
}>;

export type RenewalOutcomeSyncDependencies = Readonly<{ now?: () => Date }>;
type OutcomeSyncEnv = Readonly<{ D1_01: D1Database; D1_04: D1Database }>;

const PROVIDER = 'hyperswitch';
const MAX_PAGE_SIZE = 50;
const CYCLE_ID_PATTERN = /^rcy_[A-Za-z0-9]{26}$/;
const PAYMENT_ID_PATTERN = /^pay_[A-Za-z0-9]{26}$/;

function isBoundedId(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function isCanonicalIso(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function nowIso(now: () => Date): string {
  const date = now();
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new RenewalOutcomeSyncError('SERVICE_UNAVAILABLE', 503);
  }
  return date.toISOString();
}

function strictlyAfter(now: string, previous: string): string {
  const next = strictlyAfterCanonicalUtcTimestamp(now, previous);
  if (next === null) throw new RenewalOutcomeSyncError('SERVICE_UNAVAILABLE', 503);
  return next;
}

async function readCycleById(db: D1Database, cycleId: string): Promise<RenewalOutcomeCycle | null> {
  try {
    return await db.prepare(
      'SELECT cycle_id, provider, merchant_id, subscription_id, subscriber_id, plan_id, plan_version, ' +
      'cycle_start, cycle_end, amount_minor, order_id, payment_id, state, provider_response_status, ' +
      'pricing_snapshot_json, subscription_sync_state, subscription_sync_updated_at, subscription_sync_error_code, ' +
      'version, updated_at FROM subscription_renewal_cycles WHERE cycle_id = ? LIMIT 1',
    ).bind(cycleId).first<RenewalOutcomeCycle>();
  } catch {
    throw new RenewalOutcomeSyncError('SERVICE_UNAVAILABLE', 503);
  }
}

async function readSubscription(
  db: D1Database, subscriptionId: string, subscriberId: string,
): Promise<SubscriptionOutcomeRow | null> {
  try {
    return await db.prepare(
      'SELECT subscription_id, subscriber_id, plan_id, plan_version, status, current_period_start, ' +
      'current_period_end, cancel_at, pending_plan_id, pending_plan_version, pending_plan_effective_at, ' +
      'pending_plan_change_id, updated_at, version FROM membership_subscriptions ' +
      'WHERE subscription_id = ? AND subscriber_id = ? LIMIT 1',
    ).bind(subscriptionId, subscriberId).first<SubscriptionOutcomeRow>();
  } catch {
    throw new RenewalOutcomeSyncError('SERVICE_UNAVAILABLE', 503);
  }
}

async function markCycleSyncState(
  db: D1Database, cycle: RenewalOutcomeCycle,
  nextState: 'APPLIED' | 'RECONCILIATION_REQUIRED', errorCode: string | null, now: string,
): Promise<boolean> {
  const updatedAt = strictlyAfter(now, cycle.updated_at);
  const syncUpdatedAt = strictlyAfter(now, cycle.subscription_sync_updated_at ?? cycle.updated_at);
  try {
    const result = await db.prepare(
      'UPDATE subscription_renewal_cycles SET subscription_sync_state = ?, ' +
      'subscription_sync_updated_at = ?, subscription_sync_error_code = ?, ' +
      'version = version + 1, updated_at = ? ' +
      "WHERE cycle_id = ? AND version = ? AND state = ? AND subscription_sync_state = 'PENDING'",
    ).bind(nextState, syncUpdatedAt, errorCode, updatedAt, cycle.cycle_id, cycle.version, cycle.state).run();
    if (Number(result.meta?.changes ?? 0) === 1) return true;
    const latest = await readCycleById(db, cycle.cycle_id);
    if (!latest) throw new RenewalOutcomeSyncError('SERVICE_UNAVAILABLE', 503);
    return latest.subscription_sync_state === nextState;
  } catch (error) {
    if (error instanceof RenewalOutcomeSyncError) throw error;
    throw new RenewalOutcomeSyncError('SERVICE_UNAVAILABLE', 503);
  }
}

function validTerminalCycle(cycle: RenewalOutcomeCycle): boolean {
  if (cycle.provider !== PROVIDER || !CYCLE_ID_PATTERN.test(cycle.cycle_id) ||
      !isBoundedId(cycle.subscription_id) || !isBoundedId(cycle.subscriber_id) ||
      !isBoundedId(cycle.plan_id) || !Number.isSafeInteger(cycle.plan_version) || cycle.plan_version < 1 ||
      !isCanonicalIso(cycle.cycle_start) || !isCanonicalIso(cycle.cycle_end) ||
      cycle.cycle_end <= cycle.cycle_start ||
      !Number.isSafeInteger(cycle.amount_minor) || (cycle.amount_minor ?? 0) < 1 ||
      !isBoundedId(cycle.order_id, 255) || !cycle.payment_id || !PAYMENT_ID_PATTERN.test(cycle.payment_id) ||
      !cycle.pricing_snapshot_json || cycle.pricing_snapshot_json.length > 65_536) return false;
  if (cycle.state === 'SUCCEEDED') return cycle.provider_response_status === 'succeeded';
  if (cycle.state === 'FAILED') return ['failed', 'cancelled', 'expired'].includes(cycle.provider_response_status ?? '');
  return false;
}

async function reconcile(
  env: OutcomeSyncEnv, cycle: RenewalOutcomeCycle, reasonCode: string, now: string,
): Promise<RenewalOutcomeSyncResult> {
  const marked = await markCycleSyncState(env.D1_04, cycle, 'RECONCILIATION_REQUIRED', reasonCode, now);
  return marked
    ? { cycleId: cycle.cycle_id, subscriptionId: cycle.subscription_id, outcome: 'RECONCILIATION_REQUIRED', reasonCode }
    : { cycleId: cycle.cycle_id, subscriptionId: cycle.subscription_id, outcome: 'PENDING_RETRY' };
}

async function applySubscriptionUpdate(
  env: OutcomeSyncEnv, cycle: RenewalOutcomeCycle, subscription: SubscriptionOutcomeRow,
  nextStatus: 'ACTIVE' | 'PAST_DUE', nextPeriodStart: string, nextPeriodEnd: string, now: string,
): Promise<'APPLIED' | 'ALREADY_APPLIED' | 'CAS_LOST'> {
  const updatedAt = strictlyAfter(now, subscription.updated_at);
  const currentPlanCycle = subscription.pending_plan_id === null &&
    subscription.plan_id === cycle.plan_id && subscription.plan_version === cycle.plan_version;
  const scheduledPlanCycle = subscription.pending_plan_id === cycle.plan_id &&
    subscription.pending_plan_version === cycle.plan_version &&
    subscription.pending_plan_effective_at === cycle.cycle_start &&
    typeof subscription.pending_plan_change_id === 'string' &&
    /^sps_[a-f0-9]{60}$/.test(subscription.pending_plan_change_id);
  if (!currentPlanCycle && !scheduledPlanCycle) return 'CAS_LOST';

  let result: D1Result;
  try {
    result = await env.D1_01.prepare(
      'UPDATE membership_subscriptions SET status = ?, current_period_start = ?, current_period_end = ?, ' +
      'plan_id = CASE WHEN ? = \'ACTIVE\' AND pending_plan_id IS NOT NULL THEN ? ELSE plan_id END, ' +
      'plan_version = CASE WHEN ? = \'ACTIVE\' AND pending_plan_id IS NOT NULL THEN ? ELSE plan_version END, ' +
      'pending_plan_id = CASE WHEN ? = \'ACTIVE\' AND pending_plan_id IS NOT NULL THEN NULL ELSE pending_plan_id END, ' +
      'pending_plan_version = CASE WHEN ? = \'ACTIVE\' AND pending_plan_id IS NOT NULL THEN NULL ELSE pending_plan_version END, ' +
      'pending_plan_effective_at = CASE WHEN ? = \'ACTIVE\' AND pending_plan_id IS NOT NULL THEN NULL ELSE pending_plan_effective_at END, ' +
      'pending_plan_change_id = CASE WHEN ? = \'ACTIVE\' AND pending_plan_id IS NOT NULL THEN NULL ELSE pending_plan_change_id END, ' +
      'updated_at = ?, version = version + 1 WHERE subscription_id = ? AND subscriber_id = ? ' +
      'AND status = ? AND version = ? AND current_period_start = ? AND current_period_end = ? ' +
      'AND (cancel_at IS NULL OR cancel_at > ?) AND (' +
      '(pending_plan_id IS NULL AND plan_id = ? AND plan_version = ?) OR ' +
      '(pending_plan_id = ? AND pending_plan_version = ? AND pending_plan_effective_at = ? AND pending_plan_change_id IS NOT NULL))',
    ).bind(
      nextStatus, nextPeriodStart, nextPeriodEnd,
      nextStatus, cycle.plan_id, nextStatus, cycle.plan_version,
      nextStatus, nextStatus, nextStatus, nextStatus,
      updatedAt, cycle.subscription_id, cycle.subscriber_id, subscription.status, subscription.version,
      subscription.current_period_start, subscription.current_period_end, cycle.cycle_start,
      cycle.plan_id, cycle.plan_version, cycle.plan_id, cycle.plan_version, cycle.cycle_start,
    ).run();
  } catch {
    throw new RenewalOutcomeSyncError('SERVICE_UNAVAILABLE', 503);
  }
  if (Number(result.meta?.changes ?? 0) === 1) return 'APPLIED';

  const latest = await readSubscription(env.D1_01, cycle.subscription_id, cycle.subscriber_id);
  if (!latest) return 'CAS_LOST';
  if (latest.plan_id === cycle.plan_id && latest.plan_version === cycle.plan_version &&
      latest.pending_plan_id === null &&
      latest.current_period_start === cycle.cycle_start && latest.current_period_end === cycle.cycle_end) {
    return 'ALREADY_APPLIED';
  }
  const latestMatchesScheduled = latest.pending_plan_id === cycle.plan_id &&
    latest.pending_plan_version === cycle.plan_version &&
    latest.pending_plan_effective_at === cycle.cycle_start &&
    typeof latest.pending_plan_change_id === 'string' &&
    /^sps_[a-f0-9]{60}$/.test(latest.pending_plan_change_id);
  if (cycle.state === 'FAILED' && latest.status === 'PAST_DUE' &&
      latest.current_period_end === cycle.cycle_start &&
      ((latest.pending_plan_id === null && latest.plan_id === cycle.plan_id && latest.plan_version === cycle.plan_version) ||
        latestMatchesScheduled)) {
    return 'ALREADY_APPLIED';
  }
  return 'CAS_LOST';
}

/**
 * Applies a terminal W07 D1-04 renewal result to the authoritative D1-01
 * Subscription row. No Entitlement copy or payment/order facts are written to
 * D1-01. The D1-04 marker makes cross-database synchronization retryable.
 */
export async function syncTerminalRenewalCycleToSubscription(
  env: OutcomeSyncEnv, cycleIdInput: string, dependencies: RenewalOutcomeSyncDependencies = {},
): Promise<RenewalOutcomeSyncResult> {
  if (!CYCLE_ID_PATTERN.test(cycleIdInput)) throw new RenewalOutcomeSyncError('VALIDATION_FAILED', 400);
  const now = nowIso(dependencies.now ?? (() => new Date()));
  const cycle = await readCycleById(env.D1_04, cycleIdInput);
  if (!cycle) return { cycleId: cycleIdInput, outcome: 'RECONCILIATION_REQUIRED', reasonCode: 'CYCLE_NOT_FOUND' };
  if (cycle.subscription_sync_state === 'APPLIED') {
    return { cycleId: cycle.cycle_id, subscriptionId: cycle.subscription_id, outcome: 'ALREADY_APPLIED' };
  }
  if (cycle.subscription_sync_state === 'RECONCILIATION_REQUIRED') {
    return { cycleId: cycle.cycle_id, subscriptionId: cycle.subscription_id, outcome: 'RECONCILIATION_REQUIRED', reasonCode: cycle.subscription_sync_error_code ?? 'SYNC_REQUIRES_RECONCILIATION' };
  }
  if (cycle.state === 'RECONCILIATION_REQUIRED') {
    return { cycleId: cycle.cycle_id, subscriptionId: cycle.subscription_id, outcome: 'RECONCILIATION_REQUIRED', reasonCode: 'CYCLE_REQUIRES_RECONCILIATION' };
  }
  if (cycle.state !== 'SUCCEEDED' && cycle.state !== 'FAILED') {
    return { cycleId: cycle.cycle_id, subscriptionId: cycle.subscription_id, outcome: 'NOT_TERMINAL' };
  }
  // Do not normalize malformed persisted ordering data or mutate D1-01 first:
  // the D1-04 sync marker must remain retryable when its own timestamp is corrupt.
  if (!isCanonicalIso(cycle.updated_at) ||
      (cycle.subscription_sync_updated_at !== null && !isCanonicalIso(cycle.subscription_sync_updated_at))) {
    throw new RenewalOutcomeSyncError('SERVICE_UNAVAILABLE', 503);
  }
  if (!validTerminalCycle(cycle)) return reconcile(env, cycle, 'TERMINAL_CYCLE_SNAPSHOT_INVALID', now);

  const subscription = await readSubscription(env.D1_01, cycle.subscription_id, cycle.subscriber_id);
  if (!subscription) return reconcile(env, cycle, 'SUBSCRIPTION_NOT_FOUND', now);
  if (subscription.subscription_id !== cycle.subscription_id || subscription.subscriber_id !== cycle.subscriber_id) {
    return reconcile(env, cycle, 'SUBSCRIPTION_IDENTITY_MISMATCH', now);
  }
  if (!isCanonicalIso(subscription.updated_at)) {
    return reconcile(env, cycle, 'SUBSCRIPTION_UPDATED_AT_INVALID', now);
  }

  // A successful replay must prove that the scheduled target version is already
  // current and the pending schedule has been cleared by the same D1-01 CAS.
  if (subscription.current_period_start === cycle.cycle_start &&
      subscription.current_period_end === cycle.cycle_end &&
      subscription.plan_id === cycle.plan_id &&
      subscription.plan_version === cycle.plan_version &&
      subscription.pending_plan_id === null) {
    const marked = await markCycleSyncState(env.D1_04, cycle, 'APPLIED', null, now);
    return {
      cycleId: cycle.cycle_id, subscriptionId: cycle.subscription_id,
      outcome: marked ? 'ALREADY_APPLIED' : 'PENDING_RETRY',
    };
  }

  const currentPlanCycle = subscription.pending_plan_id === null &&
    subscription.plan_id === cycle.plan_id && subscription.plan_version === cycle.plan_version;
  const scheduledPlanCycle = subscription.pending_plan_id === cycle.plan_id &&
    subscription.pending_plan_version === cycle.plan_version &&
    subscription.pending_plan_effective_at === cycle.cycle_start &&
    typeof subscription.pending_plan_change_id === 'string' &&
    /^sps_[a-f0-9]{60}$/.test(subscription.pending_plan_change_id);
  if (!currentPlanCycle && !scheduledPlanCycle) {
    return reconcile(env, cycle, 'SUBSCRIPTION_IDENTITY_OR_PLAN_MISMATCH', now);
  }
  if (subscription.current_period_end !== cycle.cycle_start ||
      subscription.current_period_start >= cycle.cycle_start) {
    return reconcile(env, cycle, 'SUBSCRIPTION_PERIOD_CAS_MISMATCH', now);
  }
  if (subscription.cancel_at !== null &&
      (!isCanonicalIso(subscription.cancel_at) || subscription.cancel_at <= cycle.cycle_start)) {
    return reconcile(env, cycle, 'SUBSCRIPTION_CANCELLED_BEFORE_RENEWAL_PERIOD', now);
  }

  if (cycle.state === 'SUCCEEDED') {
    if (!['ACTIVE', 'PAST_DUE'].includes(subscription.status)) {
      return reconcile(env, cycle, 'SUBSCRIPTION_STATE_FORBIDS_REACTIVATION', now);
    }
    const result = await applySubscriptionUpdate(
      env, cycle, subscription, 'ACTIVE', cycle.cycle_start, cycle.cycle_end, now,
    );
    if (result === 'CAS_LOST') return reconcile(env, cycle, 'SUBSCRIPTION_CAS_LOST', now);
    const marked = await markCycleSyncState(env.D1_04, cycle, 'APPLIED', null, now);
    return {
      cycleId: cycle.cycle_id, subscriptionId: cycle.subscription_id,
      outcome: !marked ? 'PENDING_RETRY' : result,
    };
  }

  // A failed renewal moves only ACTIVE -> PAST_DUE. The paid-through period does
  // not advance, and duplicate failure delivery does not increment version twice.
  if (subscription.status === 'PAST_DUE' &&
      subscription.current_period_end === cycle.cycle_start &&
      (currentPlanCycle || scheduledPlanCycle)) {
    const marked = await markCycleSyncState(env.D1_04, cycle, 'APPLIED', null, now);
    return {
      cycleId: cycle.cycle_id, subscriptionId: cycle.subscription_id,
      outcome: marked ? 'ALREADY_APPLIED' : 'PENDING_RETRY',
    };
  }
  if (subscription.status !== 'ACTIVE') {
    return reconcile(env, cycle, 'SUBSCRIPTION_STATE_FORBIDS_PAST_DUE_TRANSITION', now);
  }
  const result = await applySubscriptionUpdate(
    env, cycle, subscription, 'PAST_DUE',
    subscription.current_period_start, subscription.current_period_end, now,
  );
  if (result === 'CAS_LOST') return reconcile(env, cycle, 'SUBSCRIPTION_CAS_LOST', now);
  const marked = await markCycleSyncState(env.D1_04, cycle, 'APPLIED', null, now);
  return {
    cycleId: cycle.cycle_id, subscriptionId: cycle.subscription_id,
    outcome: !marked ? 'PENDING_RETRY' : result,
  };
}

export async function syncRenewalCycleOutcomeForPayment(
  env: OutcomeSyncEnv, paymentIdInput: string, expectedMerchantIdInput: string,
  dependencies: RenewalOutcomeSyncDependencies = {},
): Promise<RenewalOutcomeSyncResult> {
  if (!PAYMENT_ID_PATTERN.test(paymentIdInput) || !isBoundedId(expectedMerchantIdInput)) {
    throw new RenewalOutcomeSyncError('VALIDATION_FAILED', 400);
  }
  let row: { cycle_id: string } | null;
  try {
    row = await env.D1_04.prepare(
      'SELECT cycle_id FROM subscription_renewal_cycles WHERE provider = ? AND merchant_id = ? AND payment_id = ? LIMIT 1',
    ).bind(PROVIDER, expectedMerchantIdInput, paymentIdInput).first<{ cycle_id: string }>();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Before candidate migration 0004 is applied there can be no renewal-cycle
    // rows. Ordinary customer-present payments must still receive a normal
    // webhook acknowledgement; only non-missing-table D1 failures are retried.
    if (/no such table:\s*subscription_renewal_cycles/i.test(message)) {
      return { cycleId: '', outcome: 'NO_RENEWAL_CYCLE' };
    }
    throw new RenewalOutcomeSyncError('SERVICE_UNAVAILABLE', 503);
  }
  if (!row) return { cycleId: '', outcome: 'NO_RENEWAL_CYCLE' };
  return syncTerminalRenewalCycleToSubscription(env, row.cycle_id, dependencies);
}

export async function syncPendingRenewalOutcomes(
  env: OutcomeSyncEnv, options: Readonly<{ limit?: number }> = {},
  dependencies: RenewalOutcomeSyncDependencies = {},
): Promise<Readonly<{ scanned: number; applied: number; reconciliationRequired: number; pendingRetry: number }>> {
  const limit = Number.isSafeInteger(options.limit) ? Math.min(Math.max(options.limit ?? 20, 1), MAX_PAGE_SIZE) : 20;
  let cycles: Array<{ cycle_id: string }>;
  try {
    cycles = (await env.D1_04.prepare(
      "SELECT cycle_id FROM subscription_renewal_cycles WHERE state IN ('SUCCEEDED','FAILED') " +
      "AND subscription_sync_state = 'PENDING' ORDER BY updated_at ASC, cycle_id ASC LIMIT ?",
    ).bind(limit).all<{ cycle_id: string }>()).results ?? [];
  } catch {
    throw new RenewalOutcomeSyncError('SERVICE_UNAVAILABLE', 503);
  }
  let applied = 0, reconciliationRequired = 0, pendingRetry = 0;
  for (const row of cycles) {
    try {
      const result = await syncTerminalRenewalCycleToSubscription(env, row.cycle_id, dependencies);
      if (result.outcome === 'APPLIED' || result.outcome === 'ALREADY_APPLIED') applied += 1;
      else if (result.outcome === 'RECONCILIATION_REQUIRED') reconciliationRequired += 1;
      else pendingRetry += 1;
    } catch {
      pendingRetry += 1;
    }
  }
  return { scanned: cycles.length, applied, reconciliationRequired, pendingRetry };
}
