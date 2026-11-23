import { describe, expect, it } from 'vitest';
import type { W07WebhookPostgresClient, W07WebhookPostgresPool } from './payment-webhook-database-postgres.js';
import {
  syncRenewalCycleOutcomeForPayment,
  syncTerminalRenewalCycleToSubscription,
} from './subscription-renewal-outcome.js';

const NOW = '2026-10-28T12:00:00.000Z';
const START = '2026-09-28T12:00:00.000Z';
const CYCLE_START = '2026-10-28T12:00:00.000Z';
const CYCLE_END = '2026-11-28T12:00:00.000Z';
const CYCLE_ID = 'rcy_' + 'a'.repeat(26);
const PAYMENT_ID = 'pay_' + 'b'.repeat(26);
const SUBSCRIPTION_ID = 'sub_' + 'c'.repeat(64);

type Cycle = {
  cycle_id: string; provider: string; merchant_id: string; subscription_id: string;
  subscriber_id: string; plan_id: string; plan_version: number; cycle_start: string; cycle_end: string;
  billing_interval: 'MONTHLY' | 'YEARLY';
  amount_minor: number | null; order_id: string | null; payment_id: string | null; state: string;
  provider_response_status: string | null; pricing_snapshot_json: string | null;
  subscription_sync_state: 'PENDING' | 'APPLIED' | 'RECONCILIATION_REQUIRED';
  subscription_sync_updated_at: string | null; subscription_sync_error_code: string | null;
  version: number; updated_at: string;
};
type Subscription = {
  subscription_id: string; subscriber_id: string; plan_id: string; plan_version: number;
  creator_id: string | null; billing_interval: 'MONTHLY' | 'YEARLY'; tier: string;
  price_minor: number; currency: string;
  status: 'PENDING' | 'ACTIVE' | 'PAST_DUE' | 'PAUSED' | 'CANCELED' | 'EXPIRED';
  current_period_start: string; current_period_end: string;
  trial_started_at: string | null; trial_ends_at: string | null; trial_converted_at: string | null;
  cancel_at: string | null;
  updated_at: string; version: number;
};

const makeCycle = (overrides: Partial<Cycle> = {}): Cycle => ({
  cycle_id: CYCLE_ID, provider: 'hyperswitch', merchant_id: 'merchant_test',
  subscription_id: SUBSCRIPTION_ID, subscriber_id: 'user_1', plan_id: 'plan_1', plan_version: 2,
  cycle_start: CYCLE_START, cycle_end: CYCLE_END, billing_interval: 'MONTHLY', amount_minor: 1200,
  order_id: 'ord_1', payment_id: PAYMENT_ID, state: 'SUCCEEDED',
  provider_response_status: 'succeeded', pricing_snapshot_json: JSON.stringify({ currency: 'USD', items: [] }),
  subscription_sync_state: 'PENDING', subscription_sync_updated_at: null,
  subscription_sync_error_code: null, version: 2, updated_at: NOW, ...overrides,
});

const makeSubscription = (overrides: Partial<Subscription> = {}): Subscription => ({
  subscription_id: SUBSCRIPTION_ID, subscriber_id: 'user_1', plan_id: 'plan_1',
  plan_version: 2, creator_id: 'creator_1', billing_interval: 'MONTHLY', tier: 'ENTRY',
  price_minor: 1200, currency: 'USD', status: 'ACTIVE', current_period_start: START,
  current_period_end: CYCLE_START, trial_started_at: null, trial_ends_at: null, trial_converted_at: null,
  cancel_at: null, updated_at: START, version: 3, ...overrides,
});

class MemoryStore {
  pendingScanLimit: number | null = null;
  failPendingScan = false;

  constructor(
    public cycle: Cycle | null,
    public subscription: Subscription | null,
    public failSubscriptionRead = false,
    public missingRenewalCycleTable = false,
  ) {}

  async first<T>(sql: string, values: unknown[]): Promise<T | null> {
    if (sql.includes('FROM membership_subscription_scheduled_plan_changes')) return null;
    if (this.missingRenewalCycleTable && sql.includes('FROM subscription_renewal_cycles')) {
      const error = new Error('relation "subscription_renewal_cycles" does not exist') as Error & { code: string };
      error.code = '42P01';
      throw error;
    }
    if (sql.includes('FROM subscription_renewal_cycles') && sql.includes('WHERE cycle_id =')) {
      return this.cycle ? structuredClone(this.cycle) as T : null;
    }
    if (sql.includes('FROM subscription_renewal_cycles') && sql.includes('payment_id =')) {
      if (this.cycle && this.cycle.merchant_id === values[0] && this.cycle.payment_id === values[1]) {
        return { cycle_id: this.cycle.cycle_id } as T;
      }
      return null;
    }
    if (sql.includes('FROM membership_subscriptions')) {
      if (this.failSubscriptionRead) throw new Error('temporary Neon Neon membership unavailable');
      if (this.subscription && this.subscription.subscription_id === values[0] && this.subscription.subscriber_id === values[1]) {
        return structuredClone(this.subscription) as T;
      }
      return null;
    }
    throw new Error('Unexpected memory read query: ' + sql);
  }

  async run<T>(sql: string, values: unknown[]): Promise<{ meta: { changes: number } }> {
    if (sql.includes('UPDATE membership_subscriptions SET')) {
      if (!this.subscription) return { meta: { changes: 0 } };
      const [planId, planVersion, status, periodStart, periodEnd, convertedAt, updatedAt, subscriptionId, subscriberId,
        expectedPlanId, expectedPlanVersion, expectedStatus, version, expectedStart, expectedEnd, cancelBoundary] = values;
      const row = this.subscription;
      if (row.subscription_id !== subscriptionId || row.subscriber_id !== subscriberId ||
          row.plan_id !== expectedPlanId || row.plan_version !== expectedPlanVersion ||
          row.status !== expectedStatus || row.version !== version ||
          row.current_period_start !== expectedStart || row.current_period_end !== expectedEnd ||
          (row.cancel_at !== null && row.cancel_at <= String(cancelBoundary))) return { meta: { changes: 0 } };
      this.subscription = { ...row, plan_id: String(planId), plan_version: Number(planVersion),
        status: status as Subscription['status'], current_period_start: String(periodStart),
        current_period_end: String(periodEnd),
        trial_converted_at: convertedAt === null ? row.trial_converted_at : String(convertedAt),
        updated_at: String(updatedAt), version: row.version + 1 };
      return { meta: { changes: 1 } };
    }
    if (sql.includes('UPDATE subscription_renewal_cycles SET subscription_sync_state')) {
      if (!this.cycle) return { meta: { changes: 0 } };
      const [syncState, syncUpdatedAt, errorCode, updatedAt, cycleId, version, state] = values;
      const row = this.cycle;
      if (row.cycle_id !== cycleId || row.version !== version || row.state !== state ||
          row.subscription_sync_state !== 'PENDING') return { meta: { changes: 0 } };
      this.cycle = { ...row, subscription_sync_state: syncState as Cycle['subscription_sync_state'],
        subscription_sync_updated_at: String(syncUpdatedAt),
        subscription_sync_error_code: errorCode === null ? null : String(errorCode),
        updated_at: String(updatedAt), version: row.version + 1 };
      return { meta: { changes: 1 } };
    }
    throw new Error('Unexpected memory update query: ' + sql);
  }

  async all<T>(sql: string, values: unknown[] = []): Promise<{ results: T[] }> {
    if (sql.includes('FROM subscription_renewal_cycles')) {
      this.pendingScanLimit = Number(values[0]);
      if (this.failPendingScan) throw new Error('temporary Neon finance pending-cycle scan failure');
      if (this.cycle && this.cycle.subscription_sync_state === 'PENDING' &&
          ['SUCCEEDED', 'FAILED'].includes(this.cycle.state)) {
        return { results: [{ cycle_id: this.cycle.cycle_id } as T] };
      }
    }
    return { results: [] };
  }
}

function membershipPoolFor(store: MemoryStore): W07WebhookPostgresPool {
  const query = async <Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return { rows: [] as Row[], rowCount: 0 };
    }
    if (sql.includes('FROM membership_subscription_renewal_cycle_applications')) {
      return { rows: [] as Row[], rowCount: 0 };
    }
    if (sql.includes('INSERT INTO membership_subscription_renewal_cycle_applications')) {
      return { rows: [{ cycle_id: values[0] } as Row], rowCount: 1 };
    }
    if (sql.includes('FROM membership_subscription_scheduled_plan_changes')) {
      return { rows: [] as Row[], rowCount: 0 };
    }
    if (sql.includes('FROM membership_subscriptions')) {
      const row = await store.first<Row>(sql, values);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.includes('UPDATE membership_subscriptions SET')) {
      const result = await store.run(sql, values);
      return {
        rows: Number(result.meta?.changes ?? 0) === 1
          ? [{ subscription_id: store.subscription?.subscription_id } as Row]
          : [],
        rowCount: Number(result.meta?.changes ?? 0),
      };
    }
    throw new Error('Unexpected Neon membership query: ' + sql);
  };
  const client: W07WebhookPostgresClient = {
    query,
    release() {},
  };
  return {
    query,
    async connect() { return client; },
  };
}

function financePoolFor(store: MemoryStore): W07WebhookPostgresPool {
  const query = async <Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ) => {
    if (store.missingRenewalCycleTable && sql.includes('FROM subscription_renewal_cycles')) {
      const error = new Error('relation "subscription_renewal_cycles" does not exist') as Error & { code: string };
      error.code = '42P01';
      throw error;
    }
    if (sql.startsWith('SELECT cycle_id FROM subscription_renewal_cycles') &&
        sql.includes('subscription_sync_state = \'PENDING\'') && sql.includes('ORDER BY')) {
      const result = await store.all<Row>(sql, values);
      return { rows: result.results, rowCount: result.results.length };
    }
    if (sql.startsWith('SELECT') && sql.includes('FROM subscription_renewal_cycles')) {
      const row = await store.first<Row>(sql, values);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith('UPDATE subscription_renewal_cycles SET subscription_sync_state')) {
      const result = await store.run(sql, values);
      const rows = result.meta.changes === 1 ? [{ cycle_id: store.cycle?.cycle_id } as Row] : [];
      return { rows, rowCount: rows.length };
    }
    throw new Error('Unexpected finance Neon query: ' + sql);
  };
  const client: W07WebhookPostgresClient = { query, release() {} };
  return { query, async connect() { return client; } };
}

function env(cycle: Cycle | null = makeCycle(), subscription: Subscription | null = makeSubscription(), failRead = false) {
  const membershipStore = new MemoryStore(null, subscription, failRead);
  const financeStore = new MemoryStore(cycle, null);
  const membershipPool = membershipPoolFor(membershipStore);
  const financePool = financePoolFor(financeStore);
  return {
    value: {
      W07_DATABASE_DRIVER: 'neon',
      W07_MEMBERSHIP_DATABASE_DRIVER: 'neon',
    },
    membershipStore,
    financeStore,
    membershipPool,
    financePool,
  };
}

function syncDependencies(e: ReturnType<typeof env>) {
  return {
    now: () => new Date(NOW),
    getFinancePostgresPool: () => e.financePool,
    getMembershipPostgresPool: () => e.membershipPool,
  };
}


describe('Neon finance renewal outcome to Neon membership Subscription synchronization', () => {
  it('fails closed when the finance Neon pool is unavailable', async () => {
    const e = env();
    await expect(
      syncTerminalRenewalCycleToSubscription(e.value, CYCLE_ID, {
        ...syncDependencies(e),
        getFinancePostgresPool: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    expect(e.membershipStore.subscription).toMatchObject({
      status: 'ACTIVE', current_period_start: START, current_period_end: CYCLE_START, version: 3,
    });
    expect(e.financeStore.cycle?.subscription_sync_state).toBe('PENDING');
  });

  it('fails closed on a malformed Neon finance cycle timestamp before changing Neon membership', async () => {
    const e = env(makeCycle({ updated_at: '2026-02-31T12:00:00.000Z' }));
    await expect(syncTerminalRenewalCycleToSubscription(e.value, CYCLE_ID, syncDependencies(e)))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    expect(e.membershipStore.subscription).toMatchObject({
      status: 'ACTIVE', current_period_start: START, current_period_end: CYCLE_START, version: 3,
    });
    expect(e.financeStore.cycle?.subscription_sync_state).toBe('PENDING');
  });

  it('requires canonical Neon membership updated_at and records reconciliation without changing the Subscription', async () => {
    const e = env(makeCycle(), makeSubscription({ updated_at: '2026-02-31T12:00:00.000Z' }));
    const result = await syncTerminalRenewalCycleToSubscription(e.value, CYCLE_ID, syncDependencies(e));
    expect(result).toMatchObject({ outcome: 'RECONCILIATION_REQUIRED', reasonCode: 'SUBSCRIPTION_UPDATED_AT_INVALID' });
    expect(e.membershipStore.subscription).toMatchObject({
      status: 'ACTIVE', current_period_start: START, current_period_end: CYCLE_START, version: 3,
    });
    expect(e.financeStore.cycle?.subscription_sync_state).toBe('RECONCILIATION_REQUIRED');
  });

  it('extends a subscription period on a signed succeeded cycle and is idempotent on replay', async () => {
    const e = env();
    const first = await syncTerminalRenewalCycleToSubscription(e.value, CYCLE_ID, syncDependencies(e));
    expect(first.outcome).toBe('APPLIED');
    expect(e.membershipStore.subscription).toMatchObject({
      status: 'ACTIVE', current_period_start: CYCLE_START, current_period_end: CYCLE_END, version: 4,
    });
    expect(e.financeStore.cycle).toMatchObject({ subscription_sync_state: 'APPLIED', subscription_sync_error_code: null });

    const replay = await syncTerminalRenewalCycleToSubscription(e.value, CYCLE_ID, syncDependencies(e));
    expect(replay.outcome).toBe('ALREADY_APPLIED');
    expect(e.membershipStore.subscription?.version).toBe(4);
  });

  it('moves ACTIVE to PAST_DUE on terminal payment failure without advancing paid-through dates', async () => {
    const e = env(makeCycle({ state: 'FAILED', provider_response_status: 'failed' }));
    const sync = await syncRenewalCycleOutcomeForPayment(e.value, PAYMENT_ID, 'merchant_test', syncDependencies(e));
    expect(sync.outcome).toBe('APPLIED');
    expect(e.membershipStore.subscription).toMatchObject({
      status: 'PAST_DUE', current_period_start: START, current_period_end: CYCLE_START, version: 4,
    });
    expect(e.financeStore.cycle).toMatchObject({ subscription_sync_state: 'APPLIED' });
  });

  it('does not reactivate canceled or paused subscriptions after a late successful payment', async () => {
    for (const status of ['CANCELED', 'PAUSED'] as const) {
      const e = env(makeCycle(), makeSubscription({ status, cancel_at: status === 'CANCELED' ? NOW : null }));
      const sync = await syncTerminalRenewalCycleToSubscription(e.value, CYCLE_ID, syncDependencies(e));
      expect(sync.outcome).toBe('RECONCILIATION_REQUIRED');
      expect(e.membershipStore.subscription?.status).toBe(status);
      expect(e.financeStore.cycle?.subscription_sync_state).toBe('RECONCILIATION_REQUIRED');
    }
  });

  it('records plan/period conflicts for reconciliation instead of granting access', async () => {
    const e = env(makeCycle(), makeSubscription({ plan_version: 3 }));
    const sync = await syncTerminalRenewalCycleToSubscription(e.value, CYCLE_ID, syncDependencies(e));
    expect(sync).toMatchObject({ outcome: 'RECONCILIATION_REQUIRED', reasonCode: 'SUBSCRIPTION_IDENTITY_OR_PLAN_MISMATCH' });
    expect(e.membershipStore.subscription?.version).toBe(3);
  });

  it('keeps Neon finance sync pending when Neon membership is unavailable so the operation is retryable', async () => {
    const e = env(makeCycle(), makeSubscription(), true);
    await expect(syncTerminalRenewalCycleToSubscription(e.value, CYCLE_ID, syncDependencies(e)))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    expect(e.financeStore.cycle?.subscription_sync_state).toBe('PENDING');
  });

  it('keeps ordinary payments remain valid when the optional renewal-cycle table is absent', async () => {
    const financeStore = new MemoryStore(null, null, false, true);
    const financePool = financePoolFor(financeStore);
    const membershipPool = { query: async () => ({ rows: [], rowCount: 0 }), connect: async () => { throw new Error('unused') } } as unknown as W07WebhookPostgresPool;
    const result = await syncRenewalCycleOutcomeForPayment(
      { W07_DATABASE_DRIVER: 'neon', W07_MEMBERSHIP_DATABASE_DRIVER: 'neon' },
      PAYMENT_ID,
      'merchant_test',
      { now: () => new Date(NOW), getFinancePostgresPool: () => financePool, getMembershipPostgresPool: () => membershipPool },
    );
    expect(result).toEqual({ cycleId: '', outcome: 'NO_RENEWAL_CYCLE' });
  });

  it('bounds the pending outcome reconciliation scan', async () => {
    const e = env();
    const result = await import('./subscription-renewal-outcome.js').then(({ syncPendingRenewalOutcomes }) =>
      syncPendingRenewalOutcomes(e.value, { limit: 10 }, syncDependencies(e)));
    expect(result).toEqual({ scanned: 1, applied: 1, reconciliationRequired: 0, pendingRetry: 0 });
    expect(e.financeStore.pendingScanLimit).toBe(10);
  });

  it('caps an oversized pending outcome batch to the runtime maximum', async () => {
    const e = env();
    const { syncPendingRenewalOutcomes } = await import('./subscription-renewal-outcome.js');
    const result = await syncPendingRenewalOutcomes(e.value, { limit: 100_000 }, syncDependencies(e));

    expect(e.financeStore.pendingScanLimit).toBe(50);
    expect(result).toEqual({ scanned: 1, applied: 1, reconciliationRequired: 0, pendingRetry: 0 });
  });

  it('fails closed when Neon finance cannot read the pending outcome batch', async () => {
    const e = env();
    e.financeStore.failPendingScan = true;
    const { syncPendingRenewalOutcomes } = await import('./subscription-renewal-outcome.js');

    await expect(syncPendingRenewalOutcomes(e.value, { limit: 20 }, syncDependencies(e)))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    expect(e.financeStore.pendingScanLimit).toBe(20);
  });
});
