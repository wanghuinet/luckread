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
  provider_response_status: string | null; offer_snapshot_json: string; pricing_snapshot_json: string | null;
  subscription_sync_state: 'PENDING' | 'APPLIED' | 'RECONCILIATION_REQUIRED';
  subscription_sync_updated_at: string | null; subscription_sync_error_code: string | null;
  version: number; updated_at: string;
}>;

type SubscriptionOutcomeRow = Readonly<{
  subscription_id: string; subscriber_id: string; plan_id: string; plan_version: number;
  status: 'PENDING' | 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'PAUSED' | 'CANCELED' | 'EXPIRED';
  current_period_start: string; current_period_end: string; cancel_at: string | null;
  updated_at: string; version: number;
  scheduled_change_id: string | null;
  scheduled_source_plan_id: string | null;
  scheduled_source_plan_version: number | null;
  scheduled_target_plan_id: string | null;
  scheduled_target_plan_version: number | null;
  scheduled_effective_at: string | null;
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
      'offer_snapshot_json, pricing_snapshot_json, subscription_sync_state, subscription_sync_updated_at, subscription_sync_error_code, ' +
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
      'SELECT s.subscription_id, s.subscriber_id, s.plan_id, s.plan_version, s.status, s.current_period_start, ' +
      's.current_period_end, s.cancel_at, s.updated_at, s.version, ' +
      'pc.change_id AS scheduled_change_id, pc.source_plan_id AS scheduled_source_plan_id, ' +
      'pc.source_plan_version AS scheduled_source_plan_version, pc.target_plan_id AS scheduled_target_plan_id, ' +
      'pc.target_plan_version AS scheduled_target_plan_version, pc.effective_at AS scheduled_effective_at ' +
      'FROM membership_subscriptions s LEFT JOIN membership_subscription_plan_changes pc ' +
      "ON pc.subscription_id = s.subscription_id AND pc.subscriber_id = s.subscriber_id AND pc.status = 'SCHEDULED' " +
      'WHERE s.subscription_id = ? AND s.subscriber_id = ? LIMIT 1',
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

type CyclePlanChange = Readonly<{
  changeId: string;
  sourcePlanId: string;
  sourcePlanVersion: number;
}>;

function planChangeFromCycle(cycle: RenewalOutcomeCycle): CyclePlanChange | null | false {
  let value: unknown;
  try { value = JSON.parse(cycle.offer_snapshot_json) as unknown; } catch { return false; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  const hasPlanChange = snapshot.planChangeId !== undefined ||
    snapshot.sourcePlanId !== undefined || snapshot.sourcePlanVersion !== undefined;
  if (!hasPlanChange) return null;
  if (typeof snapshot.planChangeId !== 'string' || !/^spc_[A-Za-z0-9]{26}$/.test(snapshot.planChangeId) ||
      !isBoundedId(snapshot.sourcePlanId) ||
      !Number.isSafeInteger(snapshot.sourcePlanVersion) || (snapshot.sourcePlanVersion as number) < 1 ||
      snapshot.planId !== cycle.plan_id || snapshot.planVersion !== cycle.plan_version ||
      snapshot.subscriptionId !== cycle.subscription_id || snapshot.subscriberId !== cycle.subscriber_id) {
    return false;
  }
  return {
    changeId: snapshot.planChangeId,
    sourcePlanId: snapshot.sourcePlanId,
    sourcePlanVersion: snapshot.sourcePlanVersion as number,
  };
}

function validTerminalCycle(cycle: RenewalOutcomeCycle): boolean {
  if (cycle.provider !== PROVIDER || !CYCLE_ID_PATTERN.test(cycle.cycle_id) ||
      !isBoundedId(cycle.subscription_id) || !isBoundedId(cycle.subscriber_id) ||
      !isBoundedId(cycle.plan_id) || !Number.isSafeInteger(cycle.plan_version) || cycle.plan_version < 1 ||
      !isCanonicalIso(cycle.cycle_start) || !isCanonicalIso(cycle.cycle_end) ||
      cycle.cycle_end <= cycle.cycle_start ||
      !Number.isSafeInteger(cycle.amount_minor) || (cycle.amount_minor ?? 0) < 1 ||
      !isBoundedId(cycle.order_id, 255) || !cycle.payment_id || !PAYMENT_ID_PATTERN.test(cycle.payment_id) ||
      !cycle.offer_snapshot_json || cycle.offer_snapshot_json.length > 65_536 ||
      planChangeFromCycle(cycle) === false ||
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
  nextStatus: 'ACTIVE' | 'PAST_DUE', nextPeriodStart: string, nextPeriodEnd: string,
  nextPlanId: string, nextPlanVersion: number, planChangeId: string | null, now: string,
  nextCancelAt: string | null = subscription.cancel_at,
): Promise<'APPLIED' | 'ALREADY_APPLIED' | 'CAS_LOST'> {
  const updatedAt = strictlyAfter(now, subscription.updated_at);
  let result: D1Result;
  try {
    result = await env.D1_01.prepare(
      'UPDATE membership_subscriptions SET plan_id = ?, plan_version = ?, status = ?, current_period_start = ?, current_period_end = ?, ' +
      'cancel_at = ?, updated_at = ?, version = version + 1 WHERE subscription_id = ? AND subscriber_id = ? ' +
      'AND plan_id = ? AND plan_version = ? AND status = ? AND version = ? ' +
      'AND current_period_start = ? AND current_period_end = ? AND cancel_at IS ? ' +
      'AND (? IS NULL OR EXISTS (SELECT 1 FROM membership_subscription_plan_changes pc ' +
      "WHERE pc.change_id = ? AND pc.subscription_id = membership_subscriptions.subscription_id " +
      "AND pc.subscriber_id = membership_subscriptions.subscriber_id AND pc.status = 'SCHEDULED' " +
      'AND pc.source_plan_id = ? AND pc.source_plan_version = ? AND pc.target_plan_id = ? ' +
      'AND pc.target_plan_version = ? AND pc.effective_at = ?))',
    ).bind(
      nextPlanId, nextPlanVersion, nextStatus, nextPeriodStart, nextPeriodEnd, nextCancelAt, updatedAt,
      cycle.subscription_id, cycle.subscriber_id, subscription.plan_id, subscription.plan_version,
      subscription.status, subscription.version, subscription.current_period_start,
      subscription.current_period_end, subscription.cancel_at,
      planChangeId, planChangeId, subscription.plan_id, subscription.plan_version,
      nextPlanId, nextPlanVersion, cycle.cycle_start,
    ).run();
  } catch {
    throw new RenewalOutcomeSyncError('SERVICE_UNAVAILABLE', 503);
  }
  if (Number(result.meta?.changes ?? 0) === 1) return 'APPLIED';

  const latest = await readSubscription(env.D1_01, cycle.subscription_id, cycle.subscriber_id);
  if (!latest) return 'CAS_LOST';
  if (latest.plan_id === cycle.plan_id && latest.plan_version === cycle.plan_version &&
      latest.current_period_start === cycle.cycle_start && latest.current_period_end === cycle.cycle_end) {
    return 'ALREADY_APPLIED';
  }
  if (cycle.state === 'FAILED' && latest.status === 'PAST_DUE' && latest.current_period_end === cycle.cycle_start) {
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
  const planChange = planChangeFromCycle(cycle);
  if (planChange === false) return reconcile(env, cycle, 'CYCLE_PLAN_CHANGE_SNAPSHOT_INVALID', now);
  if (subscription.subscription_id !== cycle.subscription_id || subscription.subscriber_id !== cycle.subscriber_id) {
    return reconcile(env, cycle, 'SUBSCRIPTION_IDENTITY_MISMATCH', now);
  }
  if (!isCanonicalIso(subscription.updated_at)) {
    return reconcile(env, cycle, 'SUBSCRIPTION_UPDATED_AT_INVALID', now);
  }

  // Matching target plan + paid period proves a prior successful plan switch.
  // A plan-change schedule may already be APPLIED and therefore no longer appear
  // in the scheduled row join; this replay check must run before schedule matching.
  if (subscription.current_period_start === cycle.cycle_start && subscription.current_period_end === cycle.cycle_end) {
    if (subscription.plan_id !== cycle.plan_id || subscription.plan_version !== cycle.plan_version) {
      return reconcile(env, cycle, 'APPLIED_PERIOD_PLAN_MISMATCH', now);
    }
    const marked = await markCycleSyncState(env.D1_04, cycle, 'APPLIED', null, now);
    return {
      cycleId: cycle.cycle_id, subscriptionId: cycle.subscription_id,
      outcome: marked ? 'ALREADY_APPLIED' : 'PENDING_RETRY',
    };
  }

  if (planChange) {
    if (subscription.plan_id !== planChange.sourcePlanId ||
        subscription.plan_version !== planChange.sourcePlanVersion ||
        subscription.scheduled_change_id !== planChange.changeId ||
        subscription.scheduled_source_plan_id !== planChange.sourcePlanId ||
        subscription.scheduled_source_plan_version !== planChange.sourcePlanVersion ||
        subscription.scheduled_target_plan_id !== cycle.plan_id ||
        subscription.scheduled_target_plan_version !== cycle.plan_version ||
        subscription.scheduled_effective_at !== cycle.cycle_start) {
      return reconcile(env, cycle, 'SCHEDULED_PLAN_CHANGE_MISMATCH', now);
    }
  } else if (subscription.plan_id !== cycle.plan_id || subscription.plan_version !== cycle.plan_version) {
    return reconcile(env, cycle, 'SUBSCRIPTION_IDENTITY_OR_PLAN_MISMATCH', now);
  }
  if (subscription.current_period_end !== cycle.cycle_start ||
      subscription.current_period_start >= cycle.cycle_start) {
    return reconcile(env, cycle, 'SUBSCRIPTION_PERIOD_CAS_MISMATCH', now);
  }
  let cancellationAtPaidBoundary = false;
  if (subscription.cancel_at !== null) {
    if (!isCanonicalIso(subscription.cancel_at) || subscription.cancel_at < cycle.cycle_start) {
      return reconcile(env, cycle, 'SUBSCRIPTION_CANCELLED_BEFORE_RENEWAL_PERIOD', now);
    }
    cancellationAtPaidBoundary = subscription.cancel_at === cycle.cycle_start;
  }

  // A cancellation at the trial boundary stops an unsubmitted/failed renewal.
  // If the provider confirms that the already-submitted payment succeeded,
  // record that paid cycle and move the existing cancellation boundary forward
  // to the end of the now-paid period; otherwise access would be cut off while
  // captured funds were retained.
  if (cancellationAtPaidBoundary && cycle.state === 'FAILED') {
    const marked = await markCycleSyncState(env.D1_04, cycle, 'APPLIED', null, now);
    return {
      cycleId: cycle.cycle_id,
      subscriptionId: cycle.subscription_id,
      outcome: marked ? 'APPLIED' : 'PENDING_RETRY',
    };
  }

  if (cycle.state === 'SUCCEEDED') {
    if (!['TRIALING', 'ACTIVE', 'PAST_DUE'].includes(subscription.status)) {
      return reconcile(env, cycle, 'SUBSCRIPTION_STATE_FORBIDS_REACTIVATION', now);
    }
    const result = await applySubscriptionUpdate(
      env, cycle, subscription, 'ACTIVE', cycle.cycle_start, cycle.cycle_end,
      cycle.plan_id, cycle.plan_version, planChange?.changeId ?? null, now,
      cancellationAtPaidBoundary ? cycle.cycle_end : subscription.cancel_at,
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
  if (subscription.status === 'PAST_DUE') {
    const marked = await markCycleSyncState(env.D1_04, cycle, 'APPLIED', null, now);
    return {
      cycleId: cycle.cycle_id, subscriptionId: cycle.subscription_id,
      outcome: marked ? 'ALREADY_APPLIED' : 'PENDING_RETRY',
    };
  }
  if (subscription.status !== 'ACTIVE' && subscription.status !== 'TRIALING') {
    return reconcile(env, cycle, 'SUBSCRIPTION_STATE_FORBIDS_PAST_DUE_TRANSITION', now);
  }
  const result = await applySubscriptionUpdate(
    env, cycle, subscription, 'PAST_DUE',
    subscription.current_period_start, subscription.current_period_end,
    subscription.plan_id, subscription.plan_version, null, now,
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
