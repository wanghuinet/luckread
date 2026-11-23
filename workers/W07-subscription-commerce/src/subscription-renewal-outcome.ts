/// <reference types="@cloudflare/workers-types" />

import { strictlyAfterCanonicalUtcTimestamp } from './canonical-utc-timestamp.js';
import {
  getW07PaymentWebhookPostgresPool,
  type W07PaymentMethodReadRuntimeEnv,
} from './neon/payment-method-read-runtime.js';
import { getW07MembershipPostgresPool, type W07MembershipDatabaseRuntimeEnv } from './neon/membership-database-runtime.js';
import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js';
import {
  readRenewalCycleByIdPostgres,
  readRenewalCycleByPaymentPostgres,
  listPendingRenewalCycleIdsPostgres,
  markRenewalCycleSyncStatePostgres,
  type RenewalCycleRow,
} from './renewal-cycle-postgres.js';
import {
  readScheduledSubscriptionPlanDowngradeForPeriod,
  readScheduledDowngradeTargetPlan,
  type ScheduledSubscriptionPlanDowngrade,
} from './subscription-plan-change-schedule.js';
import {
  applyRenewalSubscriptionUpdatePostgres,
  readSubscriptionOutcomePostgres,
  readRenewalCycleReceiptPostgres,
} from './subscription-renewal-outcome-postgres.js';

type RenewalOutcomeMembershipStore = W07WebhookPostgresPool;

function getRenewalOutcomeFinanceStore(
  env: OutcomeSyncEnv,
  dependencies: Pick<RenewalOutcomeSyncDependencies, 'getFinancePostgresPool'> = {},
): W07WebhookPostgresPool {
  try {
    const pool = (dependencies.getFinancePostgresPool ?? getW07PaymentWebhookPostgresPool)(env);
    if (!pool) throw new Error('finance pool unavailable');
    return pool;
  } catch {
    throw new RenewalOutcomeSyncError('SERVICE_UNAVAILABLE', 503);
  }
}

function getRenewalOutcomeMembershipStore(
  env: OutcomeSyncEnv,
  dependencies: Pick<RenewalOutcomeSyncDependencies, 'getMembershipPostgresPool'> = {},
): RenewalOutcomeMembershipStore {
  try {
    const pool = (dependencies.getMembershipPostgresPool ?? getW07MembershipPostgresPool)(env);
    if (!pool) throw new Error('membership pool unavailable');
    return pool;
  } catch {
    throw new RenewalOutcomeSyncError('SERVICE_UNAVAILABLE', 503);
  }
}

export type RenewalSubscriptionSyncOutcome =
  | 'APPLIED' | 'ALREADY_APPLIED' | 'NO_RENEWAL_CYCLE' | 'NOT_TERMINAL'
  | 'RECONCILIATION_REQUIRED' | 'PENDING_RETRY';

export class RenewalOutcomeSyncError extends Error {
  constructor(readonly code: 'VALIDATION_FAILED' | 'SERVICE_UNAVAILABLE', readonly status: number) {
    super(code);
    this.name = 'RenewalOutcomeSyncError';
  }
}

type RenewalOutcomeCycle = RenewalCycleRow;

export type SubscriptionOutcomeRow = Readonly<{
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

export type RenewalOutcomeSyncDependencies = Readonly<{
  now?: () => Date;
  getFinancePostgresPool?: (env: OutcomeSyncEnv) => W07WebhookPostgresPool | undefined;
  getMembershipPostgresPool?: (env: OutcomeSyncEnv) => W07WebhookPostgresPool | undefined;
}>;
type OutcomeSyncEnv =
  Pick<W07PaymentMethodReadRuntimeEnv, 'W07_DATABASE_DRIVER' | 'HYPERDRIVE_FINANCE_DB'> &
  W07MembershipDatabaseRuntimeEnv &
  Readonly<{ W06_GOVERNANCE?: Fetcher }>;

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

async function readCycleById(db: W07WebhookPostgresPool, cycleId: string): Promise<RenewalOutcomeCycle | null> {
  try {
    return await readRenewalCycleByIdPostgres(db, cycleId);
  } catch {
    throw new RenewalOutcomeSyncError('SERVICE_UNAVAILABLE', 503);
  }
}

async function readSubscription(
  db: RenewalOutcomeMembershipStore,
  subscriptionId: string,
  subscriberId: string,
): Promise<SubscriptionOutcomeRow | null> {
  try {
    const row = await readSubscriptionOutcomePostgres(db, subscriptionId, subscriberId);
    return row ? {
      ...row,
      trial_started_at: row.trial_started_at ?? null,
      trial_ends_at: row.trial_ends_at ?? null,
      trial_converted_at: row.trial_converted_at ?? null,
    } : null;
  } catch {
    throw new RenewalOutcomeSyncError('SERVICE_UNAVAILABLE', 503);
  }
}

async function markCycleSyncState(
  db: W07WebhookPostgresPool, cycle: RenewalOutcomeCycle,
  nextState: 'APPLIED' | 'RECONCILIATION_REQUIRED', errorCode: string | null, now: string,
): Promise<boolean> {
  const updatedAt = strictlyAfter(now, cycle.updated_at);
  const syncUpdatedAt = strictlyAfter(now, cycle.subscription_sync_updated_at ?? cycle.updated_at);
  try {
    return await markRenewalCycleSyncStatePostgres(
      db, cycle, nextState, errorCode, syncUpdatedAt, updatedAt,
    );
  } catch {
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
  env: OutcomeSyncEnv,
  cycleStore: W07WebhookPostgresPool,
  cycle: RenewalOutcomeCycle,
  reasonCode: string,
  now: string,
): Promise<RenewalOutcomeSyncResult> {
  const marked = await markCycleSyncState(cycleStore, cycle, 'RECONCILIATION_REQUIRED', reasonCode, now);
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
  membershipStore: RenewalOutcomeMembershipStore,
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
    const result = await applyRenewalSubscriptionUpdatePostgres(membershipStore, {
      cycle: {
        subscription_id: cycle.subscription_id,
        subscriber_id: cycle.subscriber_id,
        cycle_start: cycle.cycle_start,
        cycle_id: cycle.cycle_id,
        cycle_end: cycle.cycle_end,
      },
      subscription,
      nextStatus,
      nextPeriodStart,
      nextPeriodEnd,
      updatedAt,
      convertedAt,
      scheduledChange,
    });
    if (result === 'APPLIED') return 'APPLIED';
    if (result === 'ALREADY_APPLIED') return 'ALREADY_APPLIED';
  } catch {
    throw new RenewalOutcomeSyncError('SERVICE_UNAVAILABLE', 503);
  }

  const latest = await readSubscription(membershipStore, cycle.subscription_id, cycle.subscriber_id);
  if (!latest) return 'CAS_LOST';
  // A post-CAS state read is not cycle-specific durable proof. Treat a lost
  // compare-and-set as a conflict and let reconciliation resolve it.
  return 'CAS_LOST';
}

/**
 * Applies a terminal Neon finance renewal result to the authoritative membership
 * Subscription row. Payment/order facts stay in the finance database; the finance
 * sync marker makes cross-database synchronization retryable.
 */
export async function syncTerminalRenewalCycleToSubscription(
  env: OutcomeSyncEnv, cycleIdInput: string, dependencies: RenewalOutcomeSyncDependencies = {},
): Promise<RenewalOutcomeSyncResult> {
  const cycleStore = getRenewalOutcomeFinanceStore(env, dependencies);
  if (!CYCLE_ID_PATTERN.test(cycleIdInput)) throw new RenewalOutcomeSyncError('VALIDATION_FAILED', 400);
  const now = nowIso(dependencies.now ?? (() => new Date()));
  const cycle = await readCycleById(cycleStore, cycleIdInput);
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
  // Do not normalize malformed persisted ordering data or mutate membership state first:
  // the finance sync marker must remain retryable when its own timestamp is corrupt.
  if (!isCanonicalIso(cycle.updated_at) ||
      (cycle.subscription_sync_updated_at !== null && !isCanonicalIso(cycle.subscription_sync_updated_at))) {
    throw new RenewalOutcomeSyncError('SERVICE_UNAVAILABLE', 503);
  }
  if (!validTerminalCycle(cycle)) return reconcile(env, cycleStore, cycle, 'TERMINAL_CYCLE_SNAPSHOT_INVALID', now);

  const membershipStore = getRenewalOutcomeMembershipStore(env, dependencies);
  const subscription = await readSubscription(membershipStore, cycle.subscription_id, cycle.subscriber_id);
  if (!subscription) return reconcile(env, cycleStore, cycle, 'SUBSCRIPTION_NOT_FOUND', now);
  if (subscription.subscription_id !== cycle.subscription_id || subscription.subscriber_id !== cycle.subscriber_id) {
    return reconcile(env, cycleStore, cycle, 'SUBSCRIPTION_IDENTITY_MISMATCH', now);
  }
  if (!isCanonicalIso(subscription.updated_at)) {
    return reconcile(env, cycleStore, cycle, 'SUBSCRIPTION_UPDATED_AT_INVALID', now);
  }

  // Recover cross-store sync after the Membership transaction committed but the
  // Finance marker did not. The receipt is cycle-specific durable proof.
  const receipt = await readRenewalCycleReceiptPostgres(membershipStore, cycle.cycle_id);
  if (receipt) {
    const identityMatches = receipt.cycle_id === cycle.cycle_id &&
      receipt.subscription_id === cycle.subscription_id && receipt.subscriber_id === cycle.subscriber_id &&
      receipt.cycle_start === cycle.cycle_start && receipt.cycle_end === cycle.cycle_end &&
      Number.isSafeInteger(receipt.applied_subscription_version) &&
      receipt.applied_subscription_version > 0 && receipt.applied_subscription_version <= subscription.version &&
      Number.isSafeInteger(receipt.plan_version) && receipt.plan_version > 0 &&
      isCanonicalIso(receipt.applied_at);
    const activePeriodMatches = receipt.outcome === 'ACTIVE' &&
      subscription.status === 'ACTIVE' && subscription.current_period_start === cycle.cycle_start &&
      subscription.current_period_end === cycle.cycle_end && subscription.plan_id === receipt.plan_id &&
      subscription.plan_version === receipt.plan_version;
    const pastDueMatches = receipt.outcome === 'PAST_DUE' && subscription.status === 'PAST_DUE' &&
      subscription.current_period_start < cycle.cycle_start && subscription.current_period_end === cycle.cycle_start &&
      subscription.plan_id === receipt.plan_id && subscription.plan_version === receipt.plan_version;
    if (identityMatches && (activePeriodMatches || pastDueMatches) &&
        receipt.outcome === (cycle.state === 'SUCCEEDED' ? 'ACTIVE' : 'PAST_DUE')) {
      // A membership receipt proves the transaction committed, but not that its
      // cross-service governance audit was delivered. Replay the deterministic
      // audit before acknowledging the finance cycle.
      const hasTrialMetadata = subscription.trial_started_at !== null ||
        subscription.trial_ends_at !== null || subscription.trial_converted_at !== null;
      if (receipt.outcome === 'ACTIVE' && hasTrialMetadata &&
          (!isCanonicalIso(subscription.trial_started_at) ||
           !isCanonicalIso(subscription.trial_ends_at) ||
           subscription.trial_started_at >= subscription.trial_ends_at ||
           subscription.trial_ends_at !== cycle.cycle_start ||
           subscription.trial_converted_at !== cycle.cycle_start)) {
        return reconcile(env, cycleStore, cycle, 'TRIAL_RECEIPT_METADATA_MISMATCH', now);
      }
      if (receipt.outcome === 'ACTIVE' && hasTrialMetadata &&
          !(await auditAppliedSubscriptionTrialConversion(env, cycle, subscription))) {
        return { cycleId: cycle.cycle_id, subscriptionId: cycle.subscription_id, outcome: 'PENDING_RETRY' };
      }
      if (receipt.outcome === 'ACTIVE') {
        const recoveredChange = await readScheduledSubscriptionPlanDowngradeForPeriod(
          membershipStore, cycle.subscription_id, cycle.subscriber_id, cycle.cycle_start, true,
        );
        if (recoveredChange?.status === 'APPLIED' &&
            !(await auditAppliedSubscriptionPlanChange(env, cycle, recoveredChange))) {
          return { cycleId: cycle.cycle_id, subscriptionId: cycle.subscription_id, outcome: 'PENDING_RETRY' };
        }
      }
      const marked = await markCycleSyncState(cycleStore, cycle, 'APPLIED', null, now);
      return { cycleId: cycle.cycle_id, subscriptionId: cycle.subscription_id,
        outcome: marked ? 'ALREADY_APPLIED' : 'PENDING_RETRY' };
    }
    const retryCanPromotePastDueReceipt = identityMatches &&
      cycle.state === 'SUCCEEDED' && receipt.outcome === 'PAST_DUE' &&
      subscription.status === 'PAST_DUE' &&
      receipt.applied_subscription_version === subscription.version &&
      receipt.plan_id === subscription.plan_id &&
      receipt.plan_version === subscription.plan_version &&
      subscription.current_period_end === cycle.cycle_start;
    if (!retryCanPromotePastDueReceipt) {
      return reconcile(env, cycleStore, cycle, 'CYCLE_RECEIPT_SUBSCRIPTION_STATE_MISMATCH', now);
    }
    // Continue into the normal ACTIVE subscription CAS. The transaction rechecks
    // the receipt and performs the PAST_DUE -> ACTIVE receipt promotion atomically.
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
      return reconcile(env, cycleStore, cycle, 'TRIAL_PERIOD_BOUNDARY_MISMATCH', now);
    }
  }

  const scheduledChange = await readScheduledSubscriptionPlanDowngradeForPeriod(
    membershipStore, cycle.subscription_id, cycle.subscriber_id, cycle.cycle_start, true,
  );
  const currentPlanMatchesCycle =
    subscription.plan_id === cycle.plan_id && subscription.plan_version === cycle.plan_version;
  const cycleMatchesScheduledTarget = !!scheduledChange &&
    scheduledChange.expectedPlanId === subscription.plan_id &&
    scheduledChange.expectedPlanVersion === subscription.plan_version &&
    scheduledChange.targetPlanId === cycle.plan_id &&
    scheduledChange.targetPlanVersion === cycle.plan_version;
  if (!currentPlanMatchesCycle && !(scheduledChange?.status === 'SCHEDULED' && cycleMatchesScheduledTarget)) {
    return reconcile(env, cycleStore, cycle, 'SUBSCRIPTION_IDENTITY_OR_PLAN_MISMATCH', now);
  }
  if (scheduledChange) {
    if (scheduledChange.effectiveAt !== cycle.cycle_start ||
        scheduledChange.subscriberId !== cycle.subscriber_id ||
        scheduledChange.subscriptionId !== cycle.subscription_id) {
      return reconcile(env, cycleStore, cycle, 'SCHEDULED_PLAN_CHANGE_IDENTITY_MISMATCH', now);
    }
    const target = await readScheduledDowngradeTargetPlan(membershipStore, scheduledChange);
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
      return reconcile(env, cycleStore, cycle, 'SCHEDULED_PLAN_TARGET_INVALID', now);
    }
    if (scheduledChange.status === 'APPLIED' &&
        (!currentPlanMatchesCycle ||
         scheduledChange.appliedSubscriptionVersion === null ||
         scheduledChange.appliedSubscriptionVersion !== subscription.version)) {
      return reconcile(env, cycleStore, cycle, 'SCHEDULED_PLAN_APPLIED_MARKER_MISMATCH', now);
    }
  }

  // Period timestamps alone are not durable proof that this particular finance cycle
  // was applied. Without a cycle-specific application receipt, fail closed into
  // reconciliation rather than marking Finance synchronization complete.
  if (subscription.current_period_end !== cycle.cycle_start ||
      subscription.current_period_start >= cycle.cycle_start) {
    return reconcile(env, cycleStore, cycle, 'SUBSCRIPTION_PERIOD_CAS_MISMATCH', now);
  }
  if (subscription.cancel_at !== null &&
      (!isCanonicalIso(subscription.cancel_at) || subscription.cancel_at <= cycle.cycle_start)) {
    return reconcile(env, cycleStore, cycle, 'SUBSCRIPTION_CANCELLED_BEFORE_RENEWAL_PERIOD', now);
  }

  if (cycle.state === 'SUCCEEDED') {
    if (!['TRIALING', 'ACTIVE', 'PAST_DUE'].includes(subscription.status)) {
      return reconcile(env, cycleStore, cycle, 'SUBSCRIPTION_STATE_FORBIDS_REACTIVATION', now);
    }
    if (scheduledChange?.status === 'APPLIED') {
      return reconcile(env, cycleStore, cycle, 'SCHEDULED_PLAN_ALREADY_APPLIED_WITHOUT_PERIOD_ADVANCE', now);
    }
    const result = await applySubscriptionUpdate(
      membershipStore, cycle, subscription, 'ACTIVE', cycle.cycle_start, cycle.cycle_end, now,
      scheduledChange?.status === 'SCHEDULED' ? scheduledChange : undefined,
    );
    if (result === 'CAS_LOST') {
      // A competing delivery may have committed the cycle receipt while this
      // transaction lost the subscription CAS. Keep Finance retryable: the next
      // pass will read the durable receipt or reconcile a persistent mismatch.
      return { cycleId: cycle.cycle_id, subscriptionId: cycle.subscription_id, outcome: 'PENDING_RETRY' };
    }

    const appliedSubscription = await readSubscription(membershipStore, cycle.subscription_id, cycle.subscriber_id);
    if (appliedSubscription?.trial_started_at && appliedSubscription.trial_ends_at === cycle.cycle_start &&
        appliedSubscription.trial_converted_at === cycle.cycle_start &&
        !(await auditAppliedSubscriptionTrialConversion(env, cycle, appliedSubscription))) {
      return { cycleId: cycle.cycle_id, subscriptionId: cycle.subscription_id, outcome: 'PENDING_RETRY' };
    }
    if (scheduledChange?.status === 'SCHEDULED') {
      const appliedChange = await readScheduledSubscriptionPlanDowngradeForPeriod(
        membershipStore, cycle.subscription_id, cycle.subscriber_id, cycle.cycle_start, true,
      );
      if (!appliedChange || appliedChange.status !== 'APPLIED' ||
          !(await auditAppliedSubscriptionPlanChange(env, cycle, appliedChange))) {
        return { cycleId: cycle.cycle_id, subscriptionId: cycle.subscription_id, outcome: 'PENDING_RETRY' };
      }
    }
    const marked = await markCycleSyncState(cycleStore, cycle, 'APPLIED', null, now);
    return {
      cycleId: cycle.cycle_id, subscriptionId: cycle.subscription_id,
      outcome: !marked ? 'PENDING_RETRY' : result,
    };
  }


  // A failed renewal moves only ACTIVE -> PAST_DUE. The paid-through period does
  // not advance, and duplicate failure delivery does not increment version twice.
  if (subscription.status === 'PAST_DUE') {
    // Avoid treating status alone as proof; the cycle receipt is created via the
    // transactional application path when transitioning to PAST_DUE.
    return reconcile(env, cycleStore, cycle, 'PAST_DUE_WITHOUT_CYCLE_RECEIPT', now);
  }
  if (subscription.status !== 'ACTIVE' && subscription.status !== 'TRIALING') {
    return reconcile(env, cycleStore, cycle, 'SUBSCRIPTION_STATE_FORBIDS_PAST_DUE_TRANSITION', now);
  }
  const result = await applySubscriptionUpdate(
    membershipStore, cycle, subscription, 'PAST_DUE',
    subscription.current_period_start, subscription.current_period_end, now,
  );
  if (result === 'CAS_LOST') {
    // A competing delivery may have committed the cycle receipt while this
    // transaction lost the subscription CAS. Keep Finance retryable: the next
    // pass will read the durable receipt or reconcile a persistent mismatch.
    return { cycleId: cycle.cycle_id, subscriptionId: cycle.subscription_id, outcome: 'PENDING_RETRY' };
  }
  const marked = await markCycleSyncState(cycleStore, cycle, 'APPLIED', null, now);
  return {
    cycleId: cycle.cycle_id, subscriptionId: cycle.subscription_id,
    outcome: !marked ? 'PENDING_RETRY' : result,
  };
}

export async function syncRenewalCycleOutcomeForPayment(
  env: OutcomeSyncEnv, paymentIdInput: string, expectedMerchantIdInput: string,
  dependencies: RenewalOutcomeSyncDependencies = {},
): Promise<RenewalOutcomeSyncResult> {
  const cycleStore = getRenewalOutcomeFinanceStore(env, dependencies);
  if (!PAYMENT_ID_PATTERN.test(paymentIdInput) || !isBoundedId(expectedMerchantIdInput)) {
    throw new RenewalOutcomeSyncError('VALIDATION_FAILED', 400);
  }
  let row: { cycle_id: string } | null;
  try {
    row = await readRenewalCycleByPaymentPostgres(cycleStore, expectedMerchantIdInput, paymentIdInput);
  } catch {
    throw new RenewalOutcomeSyncError('SERVICE_UNAVAILABLE', 503);
  }
  if (!row) return { cycleId: '', outcome: 'NO_RENEWAL_CYCLE' };
  return syncTerminalRenewalCycleToSubscription(env, row.cycle_id, dependencies);
}

export async function syncPendingRenewalOutcomes(
  env: OutcomeSyncEnv, options: Readonly<{ limit?: number }> = {},
  dependencies: RenewalOutcomeSyncDependencies = {},
): Promise<Readonly<{ scanned: number; applied: number; reconciliationRequired: number; pendingRetry: number }>> {
  const cycleStore = getRenewalOutcomeFinanceStore(env, dependencies);
  const limit = Number.isSafeInteger(options.limit) ? Math.min(Math.max(options.limit ?? 20, 1), MAX_PAGE_SIZE) : 20;
  let cycles: Array<{ cycle_id: string }>;
  try {
    cycles = await listPendingRenewalCycleIdsPostgres(cycleStore, limit);
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
