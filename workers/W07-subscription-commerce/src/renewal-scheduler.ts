/// <reference types="@cloudflare/workers-types" />

import {
  scanDueSubscriptionRenewals,
  processSubscriptionRenewalCycle,
  type RenewalRuntimeEnv,
  type RenewalScanResult,
  type RenewalProcessResult,
  type RenewalRuntimeDependencies,
} from './renewal-runtime.js';
import {
  syncPendingRenewalOutcomes,
  type RenewalOutcomeSyncResult,
} from './subscription-renewal-outcome.js';
import { getW07PaymentWebhookPostgresPool } from './neon/payment-method-read-runtime.js';
import { getW07RenewalCycleStore, type RenewalCycleStore } from './renewal-cycle-postgres.js';
import { getW07MembershipPostgresPool } from './neon/membership-database-runtime.js';
import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js';

const MAX_CYCLES_PER_TICK = 5;
const MAX_OUTCOMES_PER_TICK = 10;

const REQUIRED_MEMBERSHIP_TABLES = [
  'membership_subscriptions',
  'membership_plans',
  'membership_plan_versions',
  'membership_subscription_scheduled_plan_changes',
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
      phase: 'OUTCOME_SYNC_BEFORE' | 'DUE_SCAN' | 'OUTCOME_SYNC_AFTER';
      beforeRecovery?: OutcomeBatch;
    }>
  | Readonly<{
      status: 'COMPLETED' | 'PARTIAL';
      dueScan: RenewalScanResult;
      processed: number;
      processFailures: number;
      cycleResults: readonly RenewalProcessResult[];
      beforeRecovery: OutcomeBatch;
      afterRecovery: OutcomeBatch | null;
    }>;

export type RenewalScheduledDependencies = Readonly<{
  readFinanceTableNames?: (pool: W07WebhookPostgresPool, expected: readonly string[]) => Promise<Set<string>>;
  readMembershipTableNames?: (db: W07WebhookPostgresPool, expected: readonly string[]) => Promise<Set<string>>;
  getMembershipPostgresPool?: (env: RenewalRuntimeEnv) => W07WebhookPostgresPool;
  getFinancePostgresPool?: (env: RenewalRuntimeEnv) => W07WebhookPostgresPool | undefined;
  getRenewalCycleStore?: (env: RenewalRuntimeEnv) => RenewalCycleStore;
  syncPending?: typeof syncPendingRenewalOutcomes;
  scanDue?: typeof scanDueSubscriptionRenewals;
  processCycle?: typeof processSubscriptionRenewalCycle;
  /** Reuse the admitted owning-domain price/tax resolver for each cycle. */
  resolvePricing?: RenewalRuntimeDependencies['resolvePricing'];
  /** Optional smaller bound for a single durable Workflow invocation. */
  maxCyclesPerBatch?: number;
}>;

async function readFinanceTableNames(
  pool: W07WebhookPostgresPool,
  expected: readonly string[],
): Promise<Set<string>> {
  const result = await pool.query<{ name: string } & Record<string, unknown>>(
    "SELECT table_name AS name FROM information_schema.tables " +
    "WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' AND table_name = ANY($1::text[])",
    [[...expected]],
  );
  return new Set(result.rows.map((row) => row.name));
}

async function readMembershipTableNames(
  pool: W07WebhookPostgresPool,
  expected: readonly string[],
): Promise<Set<string>> {
  const result = await pool.query<{ name: string } & Record<string, unknown>>(
    "SELECT table_name AS name FROM information_schema.tables " +
    "WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' AND table_name = ANY($1::text[])",
    [[...expected]],
  );
  return new Set(result.rows.map((row) => row.name));
}

/**
 * Bounded renewal batch for existing W07 state, invoked by the admitted W10 async runtime.
 *
 * The schema preflight prevents a newly deployed Cron trigger from repeatedly
 * querying an incomplete Neon finance schema. New cycles
 * remain AWAITING_PRICING unless a real pricing/tax decision is explicitly
 * wired into the runtime; this scheduler never invents a price or tax result.
 */
export async function runRenewalScheduledBatch(
  env: RenewalRuntimeEnv,
  dependencies: RenewalScheduledDependencies = {},
): Promise<RenewalScheduledBatchResult> {
  const getFinanceTableNames = dependencies.readFinanceTableNames ?? readFinanceTableNames;
  const selectedEnv = env;
  const selectedCycleStore = (dependencies.getRenewalCycleStore ?? getW07RenewalCycleStore)(env);
  const selectedFinancePool = (dependencies.getFinancePostgresPool ?? getW07PaymentWebhookPostgresPool)(env);
  if (!selectedFinancePool) {
    return { status: 'SCHEMA_NOT_READY', reason: 'SCHEMA_PROBE_FAILED', missingTables: [] };
  }
  const getSelectedCycleStore = () => selectedCycleStore;
  const getSelectedFinancePool = () => selectedFinancePool;
  const getSelectedMembershipPool = () => membershipPool;
  let membershipPool: W07WebhookPostgresPool;
  let membershipTables: Set<string>;
  let financeTables: Set<string>;
  try {
    membershipPool = (dependencies.getMembershipPostgresPool ?? getW07MembershipPostgresPool)(env);
    [membershipTables, financeTables] = await Promise.all([
      (dependencies.readMembershipTableNames ?? readMembershipTableNames)(membershipPool, REQUIRED_MEMBERSHIP_TABLES),
      getFinanceTableNames(selectedFinancePool, REQUIRED_D1_04_TABLES),
    ]);
  } catch {
    return { status: 'SCHEMA_NOT_READY', reason: 'SCHEMA_PROBE_FAILED', missingTables: [] };
  }

  const missingTables = [
    ...REQUIRED_MEMBERSHIP_TABLES.filter((name) => !membershipTables.has(name)).map((name) => 'D1-01.' + name),
    ...REQUIRED_D1_04_TABLES.filter((name) => !financeTables.has(name)).map((name) => 'D1-04.' + name),
  ];
  if (missingTables.length > 0) {
    return { status: 'SCHEMA_NOT_READY', reason: 'REQUIRED_TABLES_MISSING', missingTables };
  }

  const syncPending = dependencies.syncPending ?? syncPendingRenewalOutcomes;
  const scanDue = dependencies.scanDue ?? scanDueSubscriptionRenewals;
  const processCycle = dependencies.processCycle ?? processSubscriptionRenewalCycle;
  const maxCycles = Number.isSafeInteger(dependencies.maxCyclesPerBatch)
    ? Math.min(Math.max(dependencies.maxCyclesPerBatch!, 1), MAX_CYCLES_PER_TICK)
    : MAX_CYCLES_PER_TICK;

  let beforeRecovery: OutcomeBatch;
  try {
    beforeRecovery = await syncPending(selectedEnv, { limit: MAX_OUTCOMES_PER_TICK }, { getFinancePostgresPool: getSelectedFinancePool, getMembershipPostgresPool: getSelectedMembershipPool });
  } catch {
    // Do not start new provider-side work when prior finance-to-membership outcome recovery
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
    dueScan = dependencies.resolvePricing
      ? await scanDue(selectedEnv, { limit: maxCycles }, { resolvePricing: dependencies.resolvePricing, getRenewalCycleStore: getSelectedCycleStore, getMembershipPostgresPool: getSelectedMembershipPool })
      : await scanDue(selectedEnv, { limit: maxCycles }, { getRenewalCycleStore: getSelectedCycleStore, getMembershipPostgresPool: getSelectedMembershipPool });
  } catch {
    return { status: 'PARTIAL', phase: 'DUE_SCAN' };
  }

  const cycleResults: RenewalProcessResult[] = [];
  let processFailures = 0;
  for (const cycleId of dueScan.cycleIds.slice(0, maxCycles)) {
    try {
      cycleResults.push(dependencies.resolvePricing
        ? await processCycle(selectedEnv, cycleId, { resolvePricing: dependencies.resolvePricing, getRenewalCycleStore: getSelectedCycleStore, getMembershipPostgresPool: getSelectedMembershipPool })
        : await processCycle(selectedEnv, cycleId, { getRenewalCycleStore: getSelectedCycleStore, getMembershipPostgresPool: getSelectedMembershipPool }));
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
    afterRecovery = await syncPending(selectedEnv, { limit: MAX_OUTCOMES_PER_TICK }, { getFinancePostgresPool: getSelectedFinancePool, getMembershipPostgresPool: getSelectedMembershipPool });
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

  return {
    status: processFailures === 0 && !reconciliationRequired && !outcomeSyncPending
      ? 'COMPLETED'
      : 'PARTIAL',
    dueScan,
    processed: cycleResults.length,
    processFailures,
    cycleResults,
    beforeRecovery,
    afterRecovery,
  };
}
