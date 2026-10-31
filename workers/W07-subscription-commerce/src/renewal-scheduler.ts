/// <reference types="@cloudflare/workers-types" />

import {
  scanDueSubscriptionRenewals,
  processSubscriptionRenewalCycle,
  type RenewalRuntimeEnv,
  type RenewalScanResult,
  type RenewalProcessResult,
} from './renewal-runtime.js';
import {
  syncPendingRenewalOutcomes,
  type RenewalOutcomeSyncResult,
} from './subscription-renewal-outcome.js';
import { expireDueWebMembershipTrials } from './membership-trial-runtime.js';

const MAX_CYCLES_PER_TICK = 5;
const MAX_OUTCOMES_PER_TICK = 10;

const REQUIRED_D1_01_TABLES = [
  'membership_subscriptions',
  'membership_plans',
  'membership_plan_versions',
  'membership_subscription_trials',
] as const;

const REQUIRED_D1_04_TABLES = [
  'orders',
  'order_lines',
  'payments',
  'payment_mandates',
  'saved_payment_methods',
  'subscription_renewal_cycles',
  'subscription_renewal_scheduler_state',
] as const;

type OutcomeBatch = Awaited<ReturnType<typeof syncPendingRenewalOutcomes>>;

export type RenewalScheduledBatchResult =
  | Readonly<{
      status: 'SCHEMA_NOT_READY';
      reason: 'SCHEMA_PROBE_FAILED' | 'REQUIRED_TABLES_MISSING';
      missingTables: string[];
    }>
  | Readonly<{
      status: 'PARTIAL';
      phase: 'OUTCOME_SYNC_BEFORE' | 'TRIAL_EXPIRY' | 'DUE_SCAN' | 'OUTCOME_SYNC_AFTER';
      beforeRecovery?: OutcomeBatch;
    }>
  | Readonly<{
      status: 'COMPLETED' | 'PARTIAL';
      dueScan: RenewalScanResult;
      processed: number;
      processFailures: number;
      cycleResults: readonly RenewalProcessResult[];
      beforeRecovery: OutcomeBatch;
      trialExpiry: Readonly<{ scanned: number; expired: number }>;
      afterRecovery: OutcomeBatch | null;
    }>;

export type RenewalScheduledDependencies = Readonly<{
  readTableNames?: (db: D1Database, expected: readonly string[]) => Promise<Set<string>>;
  syncPending?: typeof syncPendingRenewalOutcomes;
  scanDue?: typeof scanDueSubscriptionRenewals;
  processCycle?: typeof processSubscriptionRenewalCycle;
  expireTrials?: typeof expireDueWebMembershipTrials;
}>;

async function readTableNames(db: D1Database, expected: readonly string[]): Promise<Set<string>> {
  const placeholders = expected.map(() => '?').join(', ');
  const result = await db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (" + placeholders + ')',
  ).bind(...expected).all<{ name: string }>();
  return new Set((result.results ?? []).map((row) => row.name));
}

/**
 * Bounded Cron tick for existing W07 state only.
 *
 * The schema preflight prevents a newly deployed Cron trigger from repeatedly
 * querying a D1-04 candidate migration that has not been applied. New cycles
 * remain AWAITING_PRICING unless a real pricing/tax decision is explicitly
 * wired into the runtime; this scheduler never invents a price or tax result.
 */
export async function runRenewalScheduledBatch(
  env: RenewalRuntimeEnv,
  dependencies: RenewalScheduledDependencies = {},
): Promise<RenewalScheduledBatchResult> {
  const getTableNames = dependencies.readTableNames ?? readTableNames;
  let d1_01: Set<string>;
  let d1_04: Set<string>;
  try {
    [d1_01, d1_04] = await Promise.all([
      getTableNames(env.D1_01, REQUIRED_D1_01_TABLES),
      getTableNames(env.D1_04, REQUIRED_D1_04_TABLES),
    ]);
  } catch {
    return { status: 'SCHEMA_NOT_READY', reason: 'SCHEMA_PROBE_FAILED', missingTables: [] };
  }

  const missingTables = [
    ...REQUIRED_D1_01_TABLES.filter((name) => !d1_01.has(name)).map((name) => 'D1-01.' + name),
    ...REQUIRED_D1_04_TABLES.filter((name) => !d1_04.has(name)).map((name) => 'D1-04.' + name),
  ];
  if (missingTables.length > 0) {
    return { status: 'SCHEMA_NOT_READY', reason: 'REQUIRED_TABLES_MISSING', missingTables };
  }

  const syncPending = dependencies.syncPending ?? syncPendingRenewalOutcomes;
  const scanDue = dependencies.scanDue ?? scanDueSubscriptionRenewals;
  const processCycle = dependencies.processCycle ?? processSubscriptionRenewalCycle;
  const expireTrials = dependencies.expireTrials ?? expireDueWebMembershipTrials;

  let beforeRecovery: OutcomeBatch;
  try {
    beforeRecovery = await syncPending(env, { limit: MAX_OUTCOMES_PER_TICK });
  } catch {
    // Do not start new provider-side work when prior cross-D1 outcome recovery
    // is failing. The next Cron tick can retry the bounded reconciliation.
    return { status: 'PARTIAL', phase: 'OUTCOME_SYNC_BEFORE' };
  }

  // The batch helper reports per-cycle failures as counts instead of throwing.
  // Treat unresolved pre-existing cross-D1 outcomes as a stop condition so a
  // later provider charge cannot race ahead of subscription-state recovery.
  if (beforeRecovery.pendingRetry > 0 || beforeRecovery.reconciliationRequired > 0) {
    return {
      status: 'PARTIAL',
      phase: 'OUTCOME_SYNC_BEFORE',
      beforeRecovery,
    };
  }

  let dueScan: RenewalScanResult;
  try {
    dueScan = await scanDue(env, { limit: MAX_CYCLES_PER_TICK });
  } catch {
    return { status: 'PARTIAL', phase: 'DUE_SCAN' };
  }

  const cycleResults: RenewalProcessResult[] = [];
  let processFailures = 0;
  for (const cycleId of dueScan.cycleIds.slice(0, MAX_CYCLES_PER_TICK)) {
    try {
      cycleResults.push(await processCycle(env, cycleId));
    } catch (error) {
      processFailures += 1;
      console.error(JSON.stringify({
        event: 'membership.renewal.cron_cycle_failed',
        cycleId,
        errorCode: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
      }));
    }
  }

  let afterRecovery: OutcomeBatch;
  try {
    afterRecovery = await syncPending(env, { limit: MAX_OUTCOMES_PER_TICK });
  } catch {
    return { status: 'PARTIAL', phase: 'OUTCOME_SYNC_AFTER' };
  }

  // Report PARTIAL whenever this tick leaves an unresolved reconciliation,
  // including outcomes that are returned as data rather than thrown exceptions.
  // A terminal reconciliation state is not a successful scheduler completion.
  const reconciliationRequired =
    beforeRecovery.reconciliationRequired > 0 ||
    afterRecovery.reconciliationRequired > 0 ||
    cycleResults.some((result) => result.state === 'RECONCILIATION_REQUIRED');
  const outcomeSyncPending = afterRecovery.pendingRetry > 0;

  // Scan and process due renewals before considering trial expiry. The first
  // web-trial renewal cycle may not exist until this exact tick; expiring the
  // TRIALING Subscription first would suppress the initial MIT charge.
  let trialExpiry: Readonly<{ scanned: number; expired: number }> = { scanned: 0, expired: 0 };
  if (!reconciliationRequired && !outcomeSyncPending) {
    try {
      trialExpiry = await expireTrials(env.D1_01, env.D1_04, new Date(), 100);
    } catch {
      return { status: 'PARTIAL', phase: 'TRIAL_EXPIRY', beforeRecovery };
    }
  }

  return {
    status: processFailures === 0 && !reconciliationRequired && !outcomeSyncPending
      ? 'COMPLETED'
      : 'PARTIAL',
    dueScan,
    processed: cycleResults.length,
    processFailures,
    cycleResults,
    beforeRecovery,
    trialExpiry,
    afterRecovery,
  };
}
