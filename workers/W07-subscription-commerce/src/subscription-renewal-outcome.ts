/// <reference types="@cloudflare/workers-types" />

import { strictlyAfterCanonicalUtcTimestamp } from './canonical-utc-timestamp.js';
import {
  readScheduledSubscriptionPlanDowngradeForPeriod,
  readScheduledDowngradeTargetPlan,
  type ScheduledSubscriptionPlanDowngrade,
} from './subscription-plan-change-schedule.js';

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
  billing_interval: 'MONTHLY' | 'YEARLY';
  amount_minor: number | null; order_id: string | null; payment_id: string | null; state: string;
  provider_response_status: string | null; pricing_snapshot_json: string | null;
  subscription_sync_state: 'PENDING' | 'APPLIED' | 'RECONCILIATION_REQUIRED';
  subscription_sync_updated_at: string | null; subscription_sync_error_code: string | null;
  version: number; updated_at: string;
}>;

type SubscriptionOutcomeRow = Readonly<{
  subscription_id: string; subscriber_id: string; plan_id: string; plan_version: number;
  creator_id: string | null;
  billing_interval: 'MONTHLY' | 'YEARLY';
  tier: string;
  price_minor: number;
  currency: string;
  status: 'PENDING' | 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'PAUSED' | 'CANCELED' | 'EXPIRED';
  current_period_start: string; current_period_end: string;
  trial_started_at: string | null; trial_ends_at: string | null; trial_converted_at: string | null;
  cancel_at: string | null;
  updated_at: string; version: number;
}>;

export type RenewalOutcomeSyncResult = Readonly<{
  cycleId: string;
  subscriptionId?: string;
  outcome: RenewalSubscriptionSyncOutcome;
  reasonCode?: string;
}>;

export type RenewalOutcomeSyncDependencies = Readonly<{ now?: () => Date }>;
type OutcomeSyncEnv = Readonly<{ D1_01: D1Database; D1_04: D1Database; W06_GOVERNANCE?: Fetcher }>;

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
      'cycle_start, cycle_end, billing_interval, amount_minor, order_id, payment_id, state, provider_response_status, ' +
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
    const row = await db.prepare(
      'SELECT s.subscription_id, s.subscriber_id, s.plan_id, s.plan_version, s.creator_id, v.billing_interval, ' +
      'v.tier, v.price_minor, v.currency, s.status, s.current_period_start, s.current_period_end, ' +
      's.trial_started_at, s.trial_ends_at, s.trial_converted_at, s.cancel_at, s.updated_at, s.version ' +
      'FROM membership_subscriptions s INNER JOIN membership_plan_versions v ' +
      'ON v.plan_id = s.plan_id AND v.plan_version = s.plan_version ' +
      'WHERE s.subscription_id = ? AND s.subscriber_id = ? LIMIT 1',
    ).bind(subscriptionId, subscriberId).first<SubscriptionOutcomeRow>();
    return row ? {
      ...row,
      trial_started_at: row.trial_started_at ?? null,
      trial_ends_at: row.trial_ends_at ?? null,
      trial_converted_at: row.trial_converted_at ?? null,
    } : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/no such column:\s*(?:s\.)?trial_(?:started|ends|converted)_at/i.test(message)) {
      throw new RenewalOutcomeSyncError('SERVICE_UNAVAILABLE', 503);
    }
    // A worker can be deployed ahead of migration 0008. Existing paid renewal
    // webhook synchronization must continue to work; no trial row can be
    // created before the migration-backed trial endpoint is available.
    try {
      const legacy = await db.prepare(
        'SELECT s.subscription_id, s.subscriber_id, s.plan_id, s.plan_version, s.creator_id, v.billing_interval, ' +
        'v.tier, v.price_minor, v.currency, s.status, s.current_period_start, s.current_period_end, ' +
        's.cancel_at, s.updated_at, s.version ' +
        'FROM membership_subscriptions s INNER JOIN membership_plan_versions v ' +
        'ON v.plan_id = s.plan_id AND v.plan_version = s.plan_version ' +
        'WHERE s.subscription_id = ? AND s.subscriber_id = ? LIMIT 1',
      ).bind(subscriptionId, subscriberId).first<Omit<SubscriptionOutcomeRow, 'trial_started_at' | 'trial_ends_at' | 'trial_converted_at'>>();
      return legacy ? { ...legacy, trial_started_at: null, trial_ends_at: null, trial_converted_at: null } : null;
    } catch {
      throw new RenewalOutcomeSyncError('SERVICE_UNAVAILABLE', 503);
    }
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
      (cycle.billing_interval !== 'MONTHLY' && cycle.billing_interval !== 'YEARLY') ||
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

async function auditAppliedSubscriptionPlanChange(
  env: OutcomeSyncEnv,
  cycle: RenewalOutcomeCycle,
  change: ScheduledSubscriptionPlanDowngrade,
): Promise<boolean> {
  if (!env.W06_GOVERNANCE || change.status !== 'APPLIED' ||
      !change.appliedAt || !change.appliedSubscriptionVersion) return false;
  const eventId = change.changeType === 'DOWNGRADE'
    ? 'evt_subscription_plan_downgrade_applied_' + change.changeId
    : 'evt_subscription_billing_interval_changed_' + change.changeId;
  const action = change.changeType === 'DOWNGRADE'
    ? 'subscription.plan_downgraded'
    : 'subscription.billing_interval_changed';
  const requestId = 'req_' + change.changeId.slice('sudc_'.length);
  const payload = {
    eventId,
    changeId: change.changeId,
    changeType: change.changeType,
    subscriberId: change.subscriberId,
    subscriptionId: change.subscriptionId,
    fromPlanId: change.expectedPlanId,
    fromPlanVersion: change.expectedPlanVersion,
    toPlanId: change.targetPlanId,
    toPlanVersion: change.targetPlanVersion,
    expectedSubscriptionVersion: change.appliedSubscriptionVersion - 1,
    appliedSubscriptionVersion: change.appliedSubscriptionVersion,
    effectiveAt: change.effectiveAt,
    occurredAt: cycle.updated_at,
  };
  try {
    const response = await env.W06_GOVERNANCE.fetch(new Request(
      'https://luckread-w06.internal/internal/audit-events/subscription-plan-change-applied',
      {
        method: 'POST',
        headers: {
          'X-LuckRead-Caller': 'W07',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'subscription-plan-change:' + change.changeId,
          'X-LuckRead-Request-Id': requestId,
          'X-LuckRead-Principal-User-Id': change.subscriberId,
          'content-type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(payload),
      },
    ));
    const result: unknown = await response.json().catch((): null => null);
    return (response.status === 200 || response.status === 201) &&
      !!result && typeof result === 'object' && !Array.isArray(result) &&
      (result as { eventId?: unknown }).eventId === eventId &&
      (result as { action?: unknown }).action === action &&
      (result as { targetType?: unknown }).targetType === 'Subscription' &&
      (result as { targetId?: unknown }).targetId === change.subscriptionId;
  } catch {
    return false;
  }
}



async function auditAppliedSubscriptionTrialConversion(
  env: OutcomeSyncEnv,
  cycle: RenewalOutcomeCycle,
  subscription: SubscriptionOutcomeRow,
): Promise<boolean> {
  if (!env.W06_GOVERNANCE || !subscription.trial_started_at || !subscription.trial_ends_at ||
      !subscription.trial_converted_at || subscription.trial_ends_at !== cycle.cycle_start ||
      subscription.trial_converted_at !== cycle.cycle_start || cycle.state !== 'SUCCEEDED' ||
      !cycle.order_id || !cycle.payment_id) return false;
  const eventId = 'evt_subscription_trial_converted_' + subscription.subscription_id;
  const payload = {
    eventId,
    subscriptionId: subscription.subscription_id,
    subscriberId: subscription.subscriber_id,
    creatorId: subscription.creator_id,
    planId: subscription.plan_id,
    planVersion: subscription.plan_version,
    trialStartedAt: subscription.trial_started_at,
    trialEndsAt: subscription.trial_ends_at,
    convertedAt: subscription.trial_converted_at,
    paidPeriodStartedAt: cycle.cycle_start,
    paidPeriodEndsAt: cycle.cycle_end,
    orderId: cycle.order_id,
    paymentId: cycle.payment_id,
    cycleId: cycle.cycle_id,
  };
  try {
    const response = await env.W06_GOVERNANCE.fetch(new Request(
      'https://luckread-w06.internal/internal/audit-events/subscription-trial-converted',
      {
        method: 'POST',
        headers: {
          'X-LuckRead-Caller': 'W07',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'subscription-trial-conversion:' + subscription.subscription_id,
          'X-LuckRead-Request-Id': 'req_' + subscription.subscription_id.slice('sub_'.length),
          'X-LuckRead-Principal-User-Id': subscription.subscriber_id,
          'content-type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(payload),
      },
    ));
    const result: unknown = await response.json().catch((): null => null);
    return (response.status === 200 || response.status === 201) &&
      !!result && typeof result === 'object' && !Array.isArray(result) &&
      (result as { eventId?: unknown }).eventId === eventId &&
      (result as { action?: unknown }).action === 'subscription.trial_converted' &&
      (result as { targetType?: unknown }).targetType === 'Subscription' &&
      (result as { targetId?: unknown }).targetId === subscription.subscription_id;
  } catch {
    return false;
  }
}

async function applySubscriptionUpdate(
  env: OutcomeSyncEnv,
  cycle: RenewalOutcomeCycle,
  subscription: SubscriptionOutcomeRow,
  nextStatus: 'ACTIVE' | 'PAST_DUE',
  nextPeriodStart: string,
  nextPeriodEnd: string,
  now: string,
  scheduledChange?: ScheduledSubscriptionPlanDowngrade,
): Promise<'APPLIED' | 'ALREADY_APPLIED' | 'CAS_LOST'> {
  const updatedAt = strictlyAfter(now, subscription.updated_at);
  const convertedAt = nextStatus === 'ACTIVE' && subscription.trial_started_at !== null &&
    subscription.trial_converted_at === null ? nextPeriodStart : subscription.trial_converted_at;
  const nextPlanId = scheduledChange && nextStatus === 'ACTIVE'
    ? scheduledChange.targetPlanId
    : subscription.plan_id;
  const nextPlanVersion = scheduledChange && nextStatus === 'ACTIVE'
    ? scheduledChange.targetPlanVersion
    : subscription.plan_version;
  try {
    if (scheduledChange && nextStatus === 'ACTIVE') {
      const results = await env.D1_01.batch([
        env.D1_01.prepare(
          'UPDATE membership_subscriptions SET plan_id = ?, plan_version = ?, status = ?, ' +
          'current_period_start = ?, current_period_end = ?, trial_converted_at = ?, updated_at = ?, version = version + 1 ' +
          'WHERE subscription_id = ? AND subscriber_id = ? AND plan_id = ? AND plan_version = ? ' +
          'AND status = ? AND version = ? AND current_period_start = ? AND current_period_end = ? ' +
          'AND (cancel_at IS NULL OR cancel_at > ?) ' +
          "AND EXISTS (SELECT 1 FROM membership_subscription_scheduled_plan_changes c WHERE c.change_id = ? " +
          "AND c.status = 'SCHEDULED' AND c.subscription_id = ? AND c.subscriber_id = ? " +
          'AND c.expected_plan_id = ? AND c.expected_plan_version = ? AND c.target_plan_id = ? ' +
          'AND c.target_plan_version = ? AND c.effective_at = ?)',
        ).bind(
          nextPlanId, nextPlanVersion, nextStatus, nextPeriodStart, nextPeriodEnd, convertedAt, updatedAt,
          cycle.subscription_id, cycle.subscriber_id, subscription.plan_id, subscription.plan_version,
          subscription.status, subscription.version, subscription.current_period_start,
          subscription.current_period_end, cycle.cycle_start,
          scheduledChange.changeId, scheduledChange.subscriptionId, scheduledChange.subscriberId,
          scheduledChange.expectedPlanId, scheduledChange.expectedPlanVersion,
          scheduledChange.targetPlanId, scheduledChange.targetPlanVersion, scheduledChange.effectiveAt,
        ),
        env.D1_01.prepare(
          "UPDATE membership_subscription_scheduled_plan_changes SET status = 'APPLIED', " +
          'applied_at = ?, applied_subscription_version = ?, updated_at = ?, version = version + 1 ' +
          "WHERE change_id = ? AND status = 'SCHEDULED' AND subscription_id = ? AND subscriber_id = ? " +
          'AND expected_plan_id = ? AND expected_plan_version = ? AND target_plan_id = ? ' +
          'AND target_plan_version = ? AND effective_at = ? ' +
          'AND EXISTS (SELECT 1 FROM membership_subscriptions s WHERE s.subscription_id = ? ' +
          'AND s.subscriber_id = ? AND s.plan_id = ? AND s.plan_version = ? ' +
          'AND s.version = ? AND s.current_period_start = ? AND s.current_period_end = ?)',
        ).bind(
          cycle.cycle_start, subscription.version + 1, updatedAt,
          scheduledChange.changeId, scheduledChange.subscriptionId, scheduledChange.subscriberId,
          scheduledChange.expectedPlanId, scheduledChange.expectedPlanVersion,
          scheduledChange.targetPlanId, scheduledChange.targetPlanVersion, scheduledChange.effectiveAt,
          cycle.subscription_id, cycle.subscriber_id, nextPlanId, nextPlanVersion,
          subscription.version + 1, nextPeriodStart, nextPeriodEnd,
        ),
      ]);
      if (Number(results[0]?.meta?.changes ?? 0) === 1 &&
          Number(results[1]?.meta?.changes ?? 0) === 1) return 'APPLIED';
    } else {
      const result = await env.D1_01.prepare(
        'UPDATE membership_subscriptions SET plan_id = ?, plan_version = ?, status = ?, ' +
        'current_period_start = ?, current_period_end = ?, trial_converted_at = ?, updated_at = ?, version = version + 1 ' +
        'WHERE subscription_id = ? AND subscriber_id = ? AND plan_id = ? AND plan_version = ? ' +
        'AND status = ? AND version = ? AND current_period_start = ? AND current_period_end = ? ' +
        'AND (cancel_at IS NULL OR cancel_at > ?)',
      ).bind(
        nextPlanId, nextPlanVersion, nextStatus, nextPeriodStart, nextPeriodEnd, convertedAt, updatedAt,
        cycle.subscription_id, cycle.subscriber_id, subscription.plan_id, subscription.plan_version,
        subscription.status, subscription.version, subscription.current_period_start,
        subscription.current_period_end, cycle.cycle_start,
      ).run();
      if (Number(result.meta?.changes ?? 0) === 1) return 'APPLIED';
    }
  } catch {
    throw new RenewalOutcomeSyncError('SERVICE_UNAVAILABLE', 503);
  }

  const latest = await readSubscription(env.D1_01, cycle.subscription_id, cycle.subscriber_id);
  if (!latest) return 'CAS_LOST';
  if (latest.plan_id === nextPlanId && latest.plan_version === nextPlanVersion &&
      latest.current_period_start === nextPeriodStart && latest.current_period_end === nextPeriodEnd) {
    return 'ALREADY_APPLIED';
  }
  if (nextStatus === 'PAST_DUE' && latest.status === 'PAST_DUE' &&
      latest.plan_id === subscription.plan_id && latest.plan_version === subscription.plan_version &&
      latest.current_period_end === cycle.cycle_start) return 'ALREADY_APPLIED';
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

  const trialHasAnyMetadata = subscription.trial_started_at !== null ||
    subscription.trial_ends_at !== null || subscription.trial_converted_at !== null;
  if (subscription.status === 'TRIALING' || (trialHasAnyMetadata && subscription.trial_converted_at === null)) {
    if (!isCanonicalIso(subscription.trial_started_at) ||
        !isCanonicalIso(subscription.trial_ends_at) ||
        subscription.trial_started_at >= subscription.trial_ends_at ||
        subscription.current_period_start !== subscription.trial_started_at ||
        subscription.current_period_end !== subscription.trial_ends_at ||
        subscription.trial_ends_at !== cycle.cycle_start ||
        subscription.trial_converted_at !== null) {
      return reconcile(env, cycle, 'TRIAL_PERIOD_BOUNDARY_MISMATCH', now);
    }
  }

  const scheduledChange = await readScheduledSubscriptionPlanDowngradeForPeriod(
    env.D1_01, cycle.subscription_id, cycle.subscriber_id, cycle.cycle_start, true,
  );
  const currentPlanMatchesCycle =
    subscription.plan_id === cycle.plan_id && subscription.plan_version === cycle.plan_version;
  const cycleMatchesScheduledTarget = !!scheduledChange &&
    scheduledChange.expectedPlanId === subscription.plan_id &&
    scheduledChange.expectedPlanVersion === subscription.plan_version &&
    scheduledChange.targetPlanId === cycle.plan_id &&
    scheduledChange.targetPlanVersion === cycle.plan_version;
  if (!currentPlanMatchesCycle && !(scheduledChange?.status === 'SCHEDULED' && cycleMatchesScheduledTarget)) {
    return reconcile(env, cycle, 'SUBSCRIPTION_IDENTITY_OR_PLAN_MISMATCH', now);
  }
  if (scheduledChange) {
    if (scheduledChange.effectiveAt !== cycle.cycle_start ||
        scheduledChange.subscriberId !== cycle.subscriber_id ||
        scheduledChange.subscriptionId !== cycle.subscription_id) {
      return reconcile(env, cycle, 'SCHEDULED_PLAN_CHANGE_IDENTITY_MISMATCH', now);
    }
    const target = await readScheduledDowngradeTargetPlan(env.D1_01, scheduledChange);
    const validScheduledChange = scheduledChange.status === 'APPLIED'
      ? target?.billingInterval === subscription.billing_interval &&
        target.tier === subscription.tier && target.currency === subscription.currency
      : scheduledChange.changeType === 'DOWNGRADE'
        ? target?.billingInterval === subscription.billing_interval &&
          target.currency === subscription.currency && target.priceMinor < subscription.price_minor
        : scheduledChange.changeType === 'BILLING_INTERVAL_CHANGE'
          ? !!target && target.billingInterval !== subscription.billing_interval &&
            target.tier === subscription.tier && target.currency === subscription.currency
          : false;
    if (!target || target.creatorId !== subscription.creator_id ||
        target.billingInterval !== cycle.billing_interval || !validScheduledChange) {
      return reconcile(env, cycle, 'SCHEDULED_PLAN_TARGET_INVALID', now);
    }
    if (scheduledChange.status === 'APPLIED' &&
        (!currentPlanMatchesCycle ||
         scheduledChange.appliedSubscriptionVersion === null ||
         scheduledChange.appliedSubscriptionVersion !== subscription.version)) {
      return reconcile(env, cycle, 'SCHEDULED_PLAN_APPLIED_MARKER_MISMATCH', now);
    }
  }

  // A matching period proves another concurrent/replayed sync applied this cycle.
  // Preserve any subsequent user lifecycle state; never reactivate canceled/paused subscriptions.
  if (subscription.current_period_start === cycle.cycle_start && subscription.current_period_end === cycle.cycle_end) {
    if (subscription.trial_started_at && subscription.trial_ends_at === cycle.cycle_start &&
        subscription.trial_converted_at === cycle.cycle_start &&
        !(await auditAppliedSubscriptionTrialConversion(env, cycle, subscription))) {
      return { cycleId: cycle.cycle_id, subscriptionId: cycle.subscription_id, outcome: 'PENDING_RETRY' };
    }
    if (scheduledChange?.status === 'APPLIED' &&
        !(await auditAppliedSubscriptionPlanChange(env, cycle, scheduledChange))) {
      return { cycleId: cycle.cycle_id, subscriptionId: cycle.subscription_id, outcome: 'PENDING_RETRY' };
    }
    if (scheduledChange?.status === 'SCHEDULED') {
      return reconcile(env, cycle, 'SCHEDULED_PLAN_CHANGE_NOT_MARKED_APPLIED', now);
    }
    const marked = await markCycleSyncState(env.D1_04, cycle, 'APPLIED', null, now);
    return {
      cycleId: cycle.cycle_id, subscriptionId: cycle.subscription_id,
      outcome: marked ? 'ALREADY_APPLIED' : 'PENDING_RETRY',
    };
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
    if (!['TRIALING', 'ACTIVE', 'PAST_DUE'].includes(subscription.status)) {
      return reconcile(env, cycle, 'SUBSCRIPTION_STATE_FORBIDS_REACTIVATION', now);
    }
    if (scheduledChange?.status === 'APPLIED') {
      return reconcile(env, cycle, 'SCHEDULED_PLAN_ALREADY_APPLIED_WITHOUT_PERIOD_ADVANCE', now);
    }
    const result = await applySubscriptionUpdate(
      env, cycle, subscription, 'ACTIVE', cycle.cycle_start, cycle.cycle_end, now,
      scheduledChange?.status === 'SCHEDULED' ? scheduledChange : undefined,
    );
    if (result === 'CAS_LOST') return reconcile(env, cycle, 'SUBSCRIPTION_CAS_LOST', now);

    const appliedSubscription = await readSubscription(env.D1_01, cycle.subscription_id, cycle.subscriber_id);
    if (appliedSubscription?.trial_started_at && appliedSubscription.trial_ends_at === cycle.cycle_start &&
        appliedSubscription.trial_converted_at === cycle.cycle_start &&
        !(await auditAppliedSubscriptionTrialConversion(env, cycle, appliedSubscription))) {
      return { cycleId: cycle.cycle_id, subscriptionId: cycle.subscription_id, outcome: 'PENDING_RETRY' };
    }
    if (scheduledChange?.status === 'SCHEDULED') {
      const appliedChange = await readScheduledSubscriptionPlanDowngradeForPeriod(
        env.D1_01, cycle.subscription_id, cycle.subscriber_id, cycle.cycle_start, true,
      );
      if (!appliedChange || appliedChange.status !== 'APPLIED' ||
          !(await auditAppliedSubscriptionPlanChange(env, cycle, appliedChange))) {
        return { cycleId: cycle.cycle_id, subscriptionId: cycle.subscription_id, outcome: 'PENDING_RETRY' };
      }
    }
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
