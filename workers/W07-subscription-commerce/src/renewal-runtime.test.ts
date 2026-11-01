import { describe, expect, it, vi } from 'vitest';
import { runRenewalScheduledBatch, type RenewalScheduledDependencies } from './renewal-scheduler.js';
import {
  processSubscriptionRenewalCycle,
  renewalCycleIdFor,
  scanDueSubscriptionRenewals,
  type RenewalRuntimeEnv,
} from './renewal-runtime.js';

const CYCLE_START = '2026-10-28T00:00:00.000Z';
const CYCLE_END = '2026-11-28T00:00:00.000Z';
const SCAN_NOW = '2026-10-28T12:00:00.000Z';

describe('renewal cycle runtime', () => {
  it('uses a stable cycle id for a subscription and one exact billing period', async () => {
    const first = await renewalCycleIdFor('sub_creator_monthly', CYCLE_START, CYCLE_END);
    const replay = await renewalCycleIdFor('sub_creator_monthly', CYCLE_START, CYCLE_END);
    const next = await renewalCycleIdFor('sub_creator_monthly', CYCLE_END, '2026-12-28T00:00:00.000Z');

    expect(first).toMatch(/^rcy_[a-f0-9]{26}$/);
    expect(first).toBe('rcy_bbae99b2fa87f365e01ecf0dae');
    expect(replay).toBe(first);
    expect(next).not.toBe(first);
    await expect(renewalCycleIdFor('', CYCLE_START, CYCLE_END)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(renewalCycleIdFor('sub_creator_monthly', CYCLE_END, CYCLE_START)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('fails closed without an admitted pricing and tax decision and never calls a provider', async () => {
    const cycle = {
      cycle_id: 'rcy_' + 'a'.repeat(26),
      provider: 'hyperswitch',
      merchant_id: 'merchant_test',
      subscription_id: 'sub_creator_monthly',
      subscriber_id: 'user_1',
      plan_id: 'plan_' + 'b'.repeat(64),
      plan_version: 1,
      cycle_start: CYCLE_START,
      cycle_end: CYCLE_END,
      billing_interval: 'MONTHLY',
      currency: 'USD',
      offer_snapshot_json: JSON.stringify({
        subscriptionId: 'sub_creator_monthly',
        subscriberId: 'user_1',
        creatorId: 'creator_1',
        planId: 'plan_' + 'b'.repeat(64),
        planVersion: 1,
        name: 'Creator Plus',
        tier: 'plus',
        billingInterval: 'MONTHLY',
        priceMinor: 1000,
        currency: 'USD',
        benefits: ['member-posts'],
      }),
      amount_minor: null,
      pricing_snapshot_json: null,
      payment_method_id: null,
      mandate_record_id: null,
      order_id: null,
      payment_id: null,
      state: 'AWAITING_PRICING',
      attempt_number: 0,
      provider_response_status: null,
      outcome_code: null,
      lease_token: null,
      lease_expires_at: null,
      version: 1,
      created_at: CYCLE_START,
      updated_at: CYCLE_START,
    };
    let providerCalled = false;
    const statement = {
      values: [] as unknown[],
      bind(...values: unknown[]) { this.values = values; return this; },
      async first() { return structuredClone(cycle); },
      async run() { throw new Error('No writes should occur when pricing is not admitted'); },
      async all() { return { results: [] }; },
    };
    const db = { prepare: () => statement } as unknown as D1Database;
    const env: RenewalRuntimeEnv = { D1_01: db, D1_04: db };
    const result = await processSubscriptionRenewalCycle(env, cycle.cycle_id, {
      createProviderCharge: async () => {
        providerCalled = true;
        throw new Error('must not call provider');
      },
    });

    expect(result).toMatchObject({ state: 'AWAITING_PRICING', action: 'AWAITING_PRICING' });
    expect(providerCalled).toBe(false);
  });
});

type ScanSubscription = {
  subscription_id: string;
  subscriber_id: string;
  plan_id: string;
  plan_version: number;
  creator_id: string | null;
  status: 'ACTIVE' | 'PAST_DUE' | 'CANCELED';
  current_period_start: string;
  current_period_end: string;
  cancel_at: string | null;
  billing_interval: 'MONTHLY' | 'YEARLY';
  price_minor: number;
  currency: string;
  name: string;
  tier: string;
  benefits_json: string;
};

type ScanCursor = {
  state_id: 'subscription-renewals';
  cursor_period_end: string | null;
  cursor_subscription_id: string | null;
  version: number;
  updated_at: string;
};

type StoredCycle = Record<string, unknown> & {
  cycle_id: string;
  subscription_id: string;
  cycle_start: string;
  cycle_end: string;
  state: string;
  version: number;
};

const makeScanSubscription = (overrides: Partial<ScanSubscription> = {}): ScanSubscription => ({
  subscription_id: 'sub_due_monthly',
  subscriber_id: 'user_due',
  plan_id: 'plan_due',
  plan_version: 1,
  creator_id: 'creator_due',
  status: 'ACTIVE',
  current_period_start: '2026-09-28T11:00:00.000Z',
  current_period_end: '2026-10-28T11:00:00.000Z',
  cancel_at: null,
  billing_interval: 'MONTHLY',
  price_minor: 1200,
  currency: 'USD',
  name: 'Creator Plus',
  tier: 'plus',
  benefits_json: JSON.stringify(['member-posts']),
  ...overrides,
});

const d1Result = (changes: number): D1Result => ({ success: true, meta: { changes } }) as D1Result;

class ScanStatement {
  private values: unknown[] = [];

  constructor(private readonly db: ScanDatabase, private readonly sql: string) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this as unknown as D1PreparedStatement;
  }

  async first<T>() {
    return this.db.first<T>(this.sql, this.values);
  }

  async all<T>() {
    return this.db.all<T>(this.sql, this.values);
  }

  async run<T>() {
    return this.db.run<T>(this.sql, this.values) as Promise<D1Result<T>>;
  }
}

/** Narrow D1 fake for the public due-scan primitive; it models the SQL filters and CAS cursor. */
class ScanDatabase {
  cursor: ScanCursor | null = {
    state_id: 'subscription-renewals',
    cursor_period_end: null,
    cursor_subscription_id: null,
    version: 1,
    updated_at: '2026-10-01T00:00:00.000Z',
  };
  readonly cycles = new Map<string, StoredCycle>();
  allCalls = 0;

  constructor(
    readonly role: 'subscriptions' | 'scheduler',
    readonly subscriptions: ScanSubscription[] = [],
    readonly failSubscriptionScan = false,
  ) {}

  prepare(sql: string) {
    return new ScanStatement(this, sql) as unknown as D1PreparedStatement;
  }

  async first<T>(sql: string, values: unknown[]): Promise<T | null> {
    if (sql.includes('FROM membership_subscription_scheduled_plan_changes')) return null;
    if (this.role !== 'scheduler') throw new Error('Unexpected D1-01 first() query: ' + sql);
    if (sql.includes('FROM subscription_renewal_scheduler_state')) {
      return this.cursor ? structuredClone(this.cursor) as T : null;
    }
    if (sql.includes('FROM subscription_renewal_cycles') && sql.includes('subscription_id = ? AND cycle_start = ?')) {
      const row = this.cycles.get(String(values[0]) + '|' + String(values[1]));
      return row ? structuredClone(row) as T : null;
    }
    throw new Error('Unexpected D1-04 first() query: ' + sql);
  }

  async all<T>(sql: string, values: unknown[]): Promise<{ results: T[] }> {
    if (this.role !== 'subscriptions' || !sql.includes('FROM membership_subscriptions s')) {
      throw new Error('Unexpected D1-04 all() query: ' + sql);
    }
    this.allCalls += 1;
    if (this.failSubscriptionScan) throw new Error('simulated D1-01 scan failure');

    const [now, cursorPeriod, , , cursorSubscription, limit] = values as [string, string | null, unknown, unknown, string | null, number];
    const results = this.subscriptions
      .filter((row) => ['ACTIVE', 'PAST_DUE'].includes(row.status))
      .filter((row) => row.current_period_end <= now)
      .filter((row) => row.cancel_at === null || row.cancel_at > row.current_period_end)
      .filter((row) => cursorPeriod === null ||
        row.current_period_end > cursorPeriod ||
        (row.current_period_end === cursorPeriod && row.subscription_id > String(cursorSubscription)))
      .sort((a, b) => a.current_period_end.localeCompare(b.current_period_end) ||
        a.subscription_id.localeCompare(b.subscription_id))
      .slice(0, Number(limit));
    return { results: structuredClone(results) as T[] };
  }

  async run<T>(sql: string, values: unknown[]): Promise<D1Result<T>> {
    if (this.role !== 'scheduler') throw new Error('Unexpected D1-01 run() query: ' + sql);
    if (sql.includes('INSERT INTO subscription_renewal_cycles')) {
      const [
        cycleId, merchantId, subscriptionId, subscriberId, planId, planVersion,
        cycleStart, cycleEnd, billingInterval, currency, offerSnapshot, now,
      ] = values as [string, string, string, string, string, number, string, string, string, string, string, string, string];
      const key = subscriptionId + '|' + cycleStart;
      if (!this.cycles.has(key)) {
        this.cycles.set(key, {
          cycle_id: cycleId,
          provider: 'hyperswitch',
          merchant_id: merchantId,
          subscription_id: subscriptionId,
          subscriber_id: subscriberId,
          plan_id: planId,
          plan_version: planVersion,
          cycle_start: cycleStart,
          cycle_end: cycleEnd,
          billing_interval: billingInterval,
          currency,
          offer_snapshot_json: offerSnapshot,
          amount_minor: null,
          pricing_snapshot_json: null,
          payment_method_id: null,
          mandate_record_id: null,
          order_id: null,
          payment_id: null,
          state: 'AWAITING_PRICING',
          subscription_sync_state: 'PENDING',
          subscription_sync_updated_at: null,
          subscription_sync_error_code: null,
          attempt_number: 0,
          provider_response_status: null,
          outcome_code: null,
          lease_token: null,
          lease_expires_at: null,
          version: 1,
          created_at: now,
          updated_at: now,
        });
        return d1Result(1) as D1Result<T>;
      }
      return d1Result(0) as D1Result<T>;
    }

    if (sql.includes('UPDATE subscription_renewal_scheduler_state')) {
      if (!this.cursor) return d1Result(0) as D1Result<T>;
      const [periodEnd, subscriptionId, updatedAt, expectedVersion] =
        values as [string | null, string | null, string, number];
      if (this.cursor.version !== expectedVersion) return d1Result(0) as D1Result<T>;
      this.cursor = {
        ...this.cursor,
        cursor_period_end: periodEnd,
        cursor_subscription_id: subscriptionId,
        updated_at: updatedAt,
        version: this.cursor.version + 1,
      };
      return d1Result(1) as D1Result<T>;
    }

    throw new Error('Unexpected D1-04 run() query: ' + sql);
  }
}

function scannerSetup(options: {
  subscriptions?: ScanSubscription[];
  missingCursor?: boolean;
  failSubscriptionScan?: boolean;
} = {}) {
  const d1_01 = new ScanDatabase('subscriptions', options.subscriptions ?? [], options.failSubscriptionScan);
  const d1_04 = new ScanDatabase('scheduler');
  if (options.missingCursor) d1_04.cursor = null;
  const env: RenewalRuntimeEnv = {
    D1_01: d1_01 as unknown as D1Database,
    D1_04: d1_04 as unknown as D1Database,
    HYPERSWITCH_ENVIRONMENT: 'sandbox',
    HYPERSWITCH_API_KEY: 'test-api-key',
    HYPERSWITCH_MERCHANT_ID: 'merchant_test',
  };
  const dependencies = {
    now: () => new Date(SCAN_NOW),
    // The scan only needs to know that the pricing authority has been admitted.
    // If the scanner tries to price anything directly, the test must fail.
    resolvePricing: async () => { throw new Error('scan must not invoke pricing'); },
  };
  return { env, d1_01, d1_04, dependencies };
}

describe('due subscription renewal scan', () => {
  it('selects only due, uncancelled subscriptions and persists one stable cycle with a CAS cursor', async () => {
    const due = makeScanSubscription();
    const future = makeScanSubscription({
      subscription_id: 'sub_future',
      current_period_end: '2026-10-29T11:00:00.000Z',
      current_period_start: '2026-09-29T11:00:00.000Z',
    });
    const canceledAtPeriodEnd = makeScanSubscription({
      subscription_id: 'sub_cancelled',
      cancel_at: '2026-10-28T11:00:00.000Z',
    });
    const f = scannerSetup({ subscriptions: [future, canceledAtPeriodEnd, due] });

    const result = await scanDueSubscriptionRenewals(f.env, { limit: 2 }, f.dependencies);
    const expectedCycle = await renewalCycleIdFor(
      due.subscription_id, due.current_period_end, '2026-11-28T11:00:00.000Z',
    );

    expect(result).toEqual({
      scanned: 1,
      cycleIds: [expectedCycle],
      cursorAdvanced: true,
      cursorReset: false,
    });
    expect(f.d1_04.cycles.size).toBe(1);
    expect(f.d1_04.cursor).toMatchObject({
      cursor_period_end: due.current_period_end,
      cursor_subscription_id: due.subscription_id,
      version: 2,
    });
  });

  it('resets an exhausted cursor and reuses the same cycle instead of duplicating a billing cycle', async () => {
    const due = makeScanSubscription();
    const f = scannerSetup({ subscriptions: [due] });

    const first = await scanDueSubscriptionRenewals(f.env, {}, f.dependencies);
    const exhausted = await scanDueSubscriptionRenewals(f.env, {}, f.dependencies);
    const replay = await scanDueSubscriptionRenewals(f.env, {}, f.dependencies);

    expect(first.cycleIds).toHaveLength(1);
    expect(exhausted).toMatchObject({ scanned: 0, cycleIds: [], cursorAdvanced: false, cursorReset: true });
    expect(replay.cycleIds).toEqual(first.cycleIds);
    expect(f.d1_04.cycles.size).toBe(1);
  });

  it('fails closed when the scheduler cursor is not initialized', async () => {
    const f = scannerSetup({ subscriptions: [makeScanSubscription()], missingCursor: true });

    await expect(scanDueSubscriptionRenewals(f.env, {}, f.dependencies))
      .rejects.toMatchObject({ code: 'SCHEDULER_STATE_NOT_INITIALIZED', status: 503 });
    expect(f.d1_01.allCalls).toBe(0);
  });

  it('fails closed on a D1-01 scan failure without advancing the cursor', async () => {
    const f = scannerSetup({ subscriptions: [makeScanSubscription()], failSubscriptionScan: true });

    await expect(scanDueSubscriptionRenewals(f.env, {}, f.dependencies))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    expect(f.d1_04.cursor).toMatchObject({ cursor_period_end: null, cursor_subscription_id: null, version: 1 });
  });
});


describe('W07 scheduled renewal batch', () => {
  const syncResult = { scanned: 0, applied: 0, reconciliationRequired: 0, pendingRetry: 0 };

  function scheduledSetup(missing: string[] = []) {
    const d1_01 = { marker: 'D1-01' } as unknown as D1Database;
    const d1_04 = { marker: 'D1-04' } as unknown as D1Database;
    const env: RenewalRuntimeEnv = {
      D1_01: d1_01, D1_04: d1_04,
      HYPERSWITCH_ENVIRONMENT: 'sandbox',
      HYPERSWITCH_API_KEY: 'test',
      HYPERSWITCH_MERCHANT_ID: 'merchant_test',
    };
    const readTableNames = vi.fn(async (db: D1Database, expected: readonly string[]) =>
      new Set(expected.filter((name) =>
        !(db === d1_04 && missing.includes('D1-04.' + name)) &&
        !(db === d1_01 && missing.includes('D1-01.' + name)))));
    const syncPending = vi.fn(async () => syncResult);
    const scanDue = vi.fn(async () => ({
      scanned: 2,
      cycleIds: ['rcy_' + 'a'.repeat(26), 'rcy_' + 'b'.repeat(26)],
      cursorAdvanced: true,
      cursorReset: false,
    }));
    const processCycle = vi.fn(async (_env: RenewalRuntimeEnv, cycleId: string) => ({
      cycleId,
      state: 'PREPARED' as const,
      action: 'PREPARED' as const,
    }));
    const dependencies: RenewalScheduledDependencies = { readTableNames, syncPending, scanDue, processCycle };
    return { env, dependencies, readTableNames, syncPending, scanDue, processCycle };
  }

  it('does not access renewal rows until the D1 schemas are ready', async () => {
    const f = scheduledSetup(['D1-04.subscription_renewal_cycles']);
    const result = await runRenewalScheduledBatch(f.env, f.dependencies);
    expect(result).toMatchObject({
      status: 'SCHEMA_NOT_READY',
      reason: 'REQUIRED_TABLES_MISSING',
      missingTables: ['D1-04.subscription_renewal_cycles'],
    });
    expect(f.syncPending).not.toHaveBeenCalled();
    expect(f.scanDue).not.toHaveBeenCalled();
    expect(f.processCycle).not.toHaveBeenCalled();
  });

  it('reconciles outcomes before and after a bounded due scan', async () => {
    const f = scheduledSetup();
    const result = await runRenewalScheduledBatch(f.env, f.dependencies);
    expect(result).toMatchObject({ status: 'COMPLETED', processed: 2, processFailures: 0 });
    expect(f.syncPending).toHaveBeenCalledTimes(2);
    expect(f.syncPending).toHaveBeenNthCalledWith(1, f.env, { limit: 10 });
    expect(f.syncPending).toHaveBeenNthCalledWith(2, f.env, { limit: 10 });
    expect(f.scanDue).toHaveBeenCalledWith(f.env, { limit: 5 });
    expect(f.processCycle).toHaveBeenCalledTimes(2);
  });

  it('forwards the admitted pricing and tax resolver to both cycle discovery and execution', async () => {
    const f = scheduledSetup();
    const resolvePricing: NonNullable<RenewalScheduledDependencies['resolvePricing']> = async () => {
      throw new Error('the scheduler must forward the resolver, not invent a pricing decision');
    };

    const result = await runRenewalScheduledBatch(f.env, { ...f.dependencies, resolvePricing });

    expect(result).toMatchObject({ status: 'COMPLETED', processed: 2 });
    expect(f.scanDue).toHaveBeenCalledWith(
      f.env,
      { limit: 5 },
      { resolvePricing },
    );
    expect(f.processCycle).toHaveBeenNthCalledWith(
      1,
      f.env,
      'rcy_' + 'a'.repeat(26),
      { resolvePricing },
    );
    expect(f.processCycle).toHaveBeenNthCalledWith(
      2,
      f.env,
      'rcy_' + 'b'.repeat(26),
      { resolvePricing },
    );
  });

  it('stops before scanning when existing cross-D1 recovery fails', async () => {
    const f = scheduledSetup();
    f.syncPending.mockRejectedValueOnce(new Error('D1-01 unavailable'));
    const result = await runRenewalScheduledBatch(f.env, f.dependencies);
    expect(result).toEqual({ status: 'PARTIAL', phase: 'OUTCOME_SYNC_BEFORE' });
    expect(f.scanDue).not.toHaveBeenCalled();
    expect(f.processCycle).not.toHaveBeenCalled();
  });

  it('continues other cycles after one bounded cycle fails and reports a partial tick', async () => {
    const f = scheduledSetup();
    f.processCycle.mockRejectedValueOnce(new Error('provider timeout'));
    const result = await runRenewalScheduledBatch(f.env, f.dependencies);
    expect(result).toMatchObject({ status: 'PARTIAL', processed: 1, processFailures: 1 });
    expect(f.processCycle).toHaveBeenCalledTimes(2);
    expect(f.syncPending).toHaveBeenCalledTimes(2);
  });
});
