import { describe, expect, it } from 'vitest';
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
  amount_minor: number | null; order_id: string | null; payment_id: string | null; state: string;
  provider_response_status: string | null; offer_snapshot_json: string; pricing_snapshot_json: string | null;
  subscription_sync_state: 'PENDING' | 'APPLIED' | 'RECONCILIATION_REQUIRED';
  subscription_sync_updated_at: string | null; subscription_sync_error_code: string | null;
  version: number; updated_at: string;
};
type Subscription = {
  subscription_id: string; subscriber_id: string; plan_id: string; plan_version: number;
  status: 'PENDING' | 'ACTIVE' | 'PAST_DUE' | 'PAUSED' | 'CANCELED' | 'EXPIRED';
  current_period_start: string; current_period_end: string; cancel_at: string | null;
  updated_at: string; version: number;
  scheduled_change_id: string | null;
  scheduled_source_plan_id: string | null;
  scheduled_source_plan_version: number | null;
  scheduled_target_plan_id: string | null;
  scheduled_target_plan_version: number | null;
  scheduled_effective_at: string | null;
};

const makeCycle = (overrides: Partial<Cycle> = {}): Cycle => ({
  cycle_id: CYCLE_ID, provider: 'hyperswitch', merchant_id: 'merchant_test',
  subscription_id: SUBSCRIPTION_ID, subscriber_id: 'user_1', plan_id: 'plan_1', plan_version: 2,
  cycle_start: CYCLE_START, cycle_end: CYCLE_END, amount_minor: 1200,
  order_id: 'ord_1', payment_id: PAYMENT_ID, state: 'SUCCEEDED',
  provider_response_status: 'succeeded',
  offer_snapshot_json: JSON.stringify({ subscriptionId: SUBSCRIPTION_ID, subscriberId: 'user_1', planId: 'plan_1', planVersion: 2 }),
  pricing_snapshot_json: JSON.stringify({ currency: 'USD', items: [] }),
  subscription_sync_state: 'PENDING', subscription_sync_updated_at: null,
  subscription_sync_error_code: null, version: 2, updated_at: NOW, ...overrides,
});

const makeSubscription = (overrides: Partial<Subscription> = {}): Subscription => ({
  subscription_id: SUBSCRIPTION_ID, subscriber_id: 'user_1', plan_id: 'plan_1',
  plan_version: 2, status: 'ACTIVE', current_period_start: START,
  current_period_end: CYCLE_START, cancel_at: null, updated_at: START, version: 3,
  scheduled_change_id: null, scheduled_source_plan_id: null, scheduled_source_plan_version: null,
  scheduled_target_plan_id: null, scheduled_target_plan_version: null, scheduled_effective_at: null,
  ...overrides,
});

const result = (changes: number): D1Result => ({ success: true, meta: { changes } }) as D1Result;

class MemoryStatement {
  values: unknown[] = [];
  constructor(readonly db: MemoryD1, readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this as unknown as D1PreparedStatement; }
  async first<T>() { return this.db.first<T>(this.sql, this.values); }
  async run<T>() { return this.db.run<T>(this.sql, this.values) as Promise<D1Result<T>>; }
  async all<T>() { return this.db.all<T>(this.sql, this.values); }
}

class MemoryD1 {
  pendingScanLimit: number | null = null;
  failPendingScan = false;

  constructor(
    public cycle: Cycle | null,
    public subscription: Subscription | null,
    public failSubscriptionRead = false,
    public missingRenewalCycleTable = false,
  ) {}
  prepare(sql: string) { return new MemoryStatement(this, sql) as unknown as D1PreparedStatement; }
  async first<T>(sql: string, values: unknown[]): Promise<T | null> {
    if (this.missingRenewalCycleTable && sql.includes('FROM subscription_renewal_cycles')) {
      throw new Error('D1_ERROR: no such table: subscription_renewal_cycles');
    }
    if (sql.includes('FROM subscription_renewal_cycles') && sql.includes('WHERE cycle_id = ?')) {
      return this.cycle ? structuredClone(this.cycle) as T : null;
    }
    if (sql.includes('FROM subscription_renewal_cycles') && sql.includes('payment_id = ?')) {
      if (this.cycle && this.cycle.provider === values[0] && this.cycle.merchant_id === values[1] && this.cycle.payment_id === values[2]) {
        return { cycle_id: this.cycle.cycle_id } as T;
      }
      return null;
    }
    if (sql.includes('FROM membership_subscriptions')) {
      if (this.failSubscriptionRead) throw new Error('temporary D1-01 unavailable');
      if (this.subscription && this.subscription.subscription_id === values[0] && this.subscription.subscriber_id === values[1]) {
        return structuredClone(this.subscription) as T;
      }
      return null;
    }
    throw new Error('Unexpected first query: ' + sql);
  }
  async run<T>(sql: string, values: unknown[]): Promise<D1Result<T>> {
    if (sql.includes('UPDATE membership_subscriptions SET')) {
      if (!this.subscription) return result(0) as D1Result<T>;
      const [
        nextPlanId, nextPlanVersion, status, periodStart, periodEnd, updatedAt,
        subscriptionId, subscriberId, expectedPlanId, expectedPlanVersion, expectedStatus, version,
        expectedStart, expectedEnd, cancelBoundary, planChangeId, expectedChangeId,
        sourcePlanId, sourcePlanVersion, targetPlanId, targetPlanVersion, effectiveAt,
      ] = values;
      const row = this.subscription;
      if (row.subscription_id !== subscriptionId || row.subscriber_id !== subscriberId ||
          row.plan_id !== expectedPlanId || row.plan_version !== expectedPlanVersion ||
          row.status !== expectedStatus || row.version !== version ||
          row.current_period_start !== expectedStart || row.current_period_end !== expectedEnd ||
          (row.cancel_at !== null && row.cancel_at <= String(cancelBoundary))) return result(0) as D1Result<T>;
      if (planChangeId !== null && (
        row.scheduled_change_id !== expectedChangeId ||
        row.scheduled_source_plan_id !== sourcePlanId ||
        row.scheduled_source_plan_version !== sourcePlanVersion ||
        row.scheduled_target_plan_id !== targetPlanId ||
        row.scheduled_target_plan_version !== targetPlanVersion ||
        row.scheduled_effective_at !== effectiveAt
      )) return result(0) as D1Result<T>;
      this.subscription = {
        ...row,
        plan_id: String(nextPlanId),
        plan_version: Number(nextPlanVersion),
        status: status as Subscription['status'],
        current_period_start: String(periodStart),
        current_period_end: String(periodEnd),
        updated_at: String(updatedAt),
        version: row.version + 1,
        ...(planChangeId !== null ? {
          scheduled_change_id: null,
          scheduled_source_plan_id: null,
          scheduled_source_plan_version: null,
          scheduled_target_plan_id: null,
          scheduled_target_plan_version: null,
          scheduled_effective_at: null,
        } : {}),
      };
      return result(1) as D1Result<T>;
    }
    if (sql.includes('UPDATE subscription_renewal_cycles SET subscription_sync_state')) {
      if (!this.cycle) return result(0) as D1Result<T>;
      const [syncState, syncUpdatedAt, errorCode, updatedAt, cycleId, version, state] = values;
      const row = this.cycle;
      if (row.cycle_id !== cycleId || row.version !== version || row.state !== state ||
          row.subscription_sync_state !== 'PENDING') return result(0) as D1Result<T>;
      this.cycle = { ...row, subscription_sync_state: syncState as Cycle['subscription_sync_state'],
        subscription_sync_updated_at: String(syncUpdatedAt),
        subscription_sync_error_code: errorCode === null ? null : String(errorCode),
        updated_at: String(updatedAt), version: row.version + 1 };
      return result(1) as D1Result<T>;
    }
    throw new Error('Unexpected run query: ' + sql);
  }
  async all<T>(sql: string, values: unknown[] = []): Promise<D1Result<T>> {
    if (sql.includes('FROM subscription_renewal_cycles')) {
      this.pendingScanLimit = Number(values[0]);
      if (this.failPendingScan) throw new Error('temporary D1-04 pending-cycle scan failure');
      if (this.cycle && this.cycle.subscription_sync_state === 'PENDING' &&
          ['SUCCEEDED', 'FAILED'].includes(this.cycle.state)) {
        return { success: true, results: [{ cycle_id: this.cycle.cycle_id } as T] } as D1Result<T>;
      }
    }
    return { success: true, results: [] } as D1Result<T>;
  }
}

function env(cycle: Cycle | null = makeCycle(), subscription: Subscription | null = makeSubscription(), failRead = false) {
  const d1_01 = new MemoryD1(null, subscription, failRead) as unknown as D1Database;
  const d1_04 = new MemoryD1(cycle, null) as unknown as D1Database;
  return { value: { D1_01: d1_01, D1_04: d1_04 }, d1_01: d1_01 as unknown as MemoryD1, d1_04: d1_04 as unknown as MemoryD1 };
}

describe('D1-04 renewal outcome to D1-01 Subscription synchronization', () => {
  it('fails closed on a malformed D1-04 cycle timestamp before changing D1-01', async () => {
    const e = env(makeCycle({ updated_at: '2026-02-31T12:00:00.000Z' }));
    await expect(syncTerminalRenewalCycleToSubscription(e.value, CYCLE_ID, { now: () => new Date(NOW) }))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    expect(e.d1_01.subscription).toMatchObject({
      status: 'ACTIVE', current_period_start: START, current_period_end: CYCLE_START, version: 3,
    });
    expect(e.d1_04.cycle?.subscription_sync_state).toBe('PENDING');
  });

  it('requires canonical D1-01 updated_at and records reconciliation without changing the Subscription', async () => {
    const e = env(makeCycle(), makeSubscription({ updated_at: '2026-02-31T12:00:00.000Z' }));
    const result = await syncTerminalRenewalCycleToSubscription(e.value, CYCLE_ID, { now: () => new Date(NOW) });
    expect(result).toMatchObject({ outcome: 'RECONCILIATION_REQUIRED', reasonCode: 'SUBSCRIPTION_UPDATED_AT_INVALID' });
    expect(e.d1_01.subscription).toMatchObject({
      status: 'ACTIVE', current_period_start: START, current_period_end: CYCLE_START, version: 3,
    });
    expect(e.d1_04.cycle?.subscription_sync_state).toBe('RECONCILIATION_REQUIRED');
  });

  it('extends a subscription period on a signed succeeded cycle and is idempotent on replay', async () => {
    const e = env();
    const first = await syncTerminalRenewalCycleToSubscription(e.value, CYCLE_ID, { now: () => new Date(NOW) });
    expect(first.outcome).toBe('APPLIED');
    expect(e.d1_01.subscription).toMatchObject({
      status: 'ACTIVE', current_period_start: CYCLE_START, current_period_end: CYCLE_END, version: 4,
    });
    expect(e.d1_04.cycle).toMatchObject({ subscription_sync_state: 'APPLIED', subscription_sync_error_code: null });

    const replay = await syncTerminalRenewalCycleToSubscription(e.value, CYCLE_ID, { now: () => new Date(NOW) });
    expect(replay.outcome).toBe('ALREADY_APPLIED');
    expect(e.d1_01.subscription?.version).toBe(4);
  });

  it('applies a scheduled downgrade only after the next renewal payment succeeds', async () => {
    const changeId = 'spc_' + 'd'.repeat(26);
    const targetPlanId = 'plan_target';
    const targetOffer = {
      subscriptionId: SUBSCRIPTION_ID,
      subscriberId: 'user_1',
      planId: targetPlanId,
      planVersion: 1,
      planChangeId: changeId,
      sourcePlanId: 'plan_1',
      sourcePlanVersion: 2,
    };
    const scheduledSubscription = makeSubscription({
      scheduled_change_id: changeId,
      scheduled_source_plan_id: 'plan_1',
      scheduled_source_plan_version: 2,
      scheduled_target_plan_id: targetPlanId,
      scheduled_target_plan_version: 1,
      scheduled_effective_at: CYCLE_START,
    });
    const scheduledCycle = makeCycle({
      plan_id: targetPlanId,
      plan_version: 1,
      offer_snapshot_json: JSON.stringify(targetOffer),
    });
    const e = env(scheduledCycle, scheduledSubscription);
    const sync = await syncTerminalRenewalCycleToSubscription(e.value, CYCLE_ID, { now: () => new Date(NOW) });
    expect(sync.outcome).toBe('APPLIED');
    expect(e.d1_01.subscription).toMatchObject({
      plan_id: targetPlanId,
      plan_version: 1,
      current_period_start: CYCLE_START,
      current_period_end: CYCLE_END,
      status: 'ACTIVE',
    });
    expect(e.d1_04.cycle?.subscription_sync_state).toBe('APPLIED');
  });

  it('moves ACTIVE to PAST_DUE on terminal payment failure without advancing paid-through dates', async () => {
    const e = env(makeCycle({ state: 'FAILED', provider_response_status: 'failed' }));
    const sync = await syncRenewalCycleOutcomeForPayment(e.value, PAYMENT_ID, 'merchant_test', { now: () => new Date(NOW) });
    expect(sync.outcome).toBe('APPLIED');
    expect(e.d1_01.subscription).toMatchObject({
      status: 'PAST_DUE', current_period_start: START, current_period_end: CYCLE_START, version: 4,
    });
    expect(e.d1_04.cycle).toMatchObject({ subscription_sync_state: 'APPLIED' });
  });

  it('keeps the source plan and scheduled downgrade when the renewal payment fails', async () => {
    const changeId = 'spc_' + 'e'.repeat(26);
    const targetPlanId = 'plan_target';
    const targetOffer = {
      subscriptionId: SUBSCRIPTION_ID,
      subscriberId: 'user_1',
      planId: targetPlanId,
      planVersion: 1,
      planChangeId: changeId,
      sourcePlanId: 'plan_1',
      sourcePlanVersion: 2,
    };
    const scheduledSubscription = makeSubscription({
      scheduled_change_id: changeId,
      scheduled_source_plan_id: 'plan_1',
      scheduled_source_plan_version: 2,
      scheduled_target_plan_id: targetPlanId,
      scheduled_target_plan_version: 1,
      scheduled_effective_at: CYCLE_START,
    });
    const failedCycle = makeCycle({
      state: 'FAILED',
      provider_response_status: 'failed',
      plan_id: targetPlanId,
      plan_version: 1,
      offer_snapshot_json: JSON.stringify(targetOffer),
    });
    const e = env(failedCycle, scheduledSubscription);
    const sync = await syncRenewalCycleOutcomeForPayment(e.value, PAYMENT_ID, 'merchant_test', { now: () => new Date(NOW) });
    expect(sync.outcome).toBe('APPLIED');
    expect(e.d1_01.subscription).toMatchObject({
      plan_id: 'plan_1',
      plan_version: 2,
      status: 'PAST_DUE',
      current_period_start: START,
      current_period_end: CYCLE_START,
      scheduled_change_id: changeId,
      scheduled_target_plan_id: targetPlanId,
    });
  });

  it('does not reactivate canceled or paused subscriptions after a late successful payment', async () => {
    for (const status of ['CANCELED', 'PAUSED'] as const) {
      const e = env(makeCycle(), makeSubscription({ status, cancel_at: status === 'CANCELED' ? NOW : null }));
      const sync = await syncTerminalRenewalCycleToSubscription(e.value, CYCLE_ID, { now: () => new Date(NOW) });
      expect(sync.outcome).toBe('RECONCILIATION_REQUIRED');
      expect(e.d1_01.subscription?.status).toBe(status);
      expect(e.d1_04.cycle?.subscription_sync_state).toBe('RECONCILIATION_REQUIRED');
    }
  });

  it('records plan/period conflicts for reconciliation instead of granting access', async () => {
    const e = env(makeCycle(), makeSubscription({ plan_version: 3 }));
    const sync = await syncTerminalRenewalCycleToSubscription(e.value, CYCLE_ID, { now: () => new Date(NOW) });
    expect(sync).toMatchObject({ outcome: 'RECONCILIATION_REQUIRED', reasonCode: 'SUBSCRIPTION_IDENTITY_OR_PLAN_MISMATCH' });
    expect(e.d1_01.subscription?.version).toBe(3);
  });

  it('keeps D1-04 sync pending when D1-01 is unavailable so the operation is retryable', async () => {
    const e = env(makeCycle(), makeSubscription(), true);
    await expect(syncTerminalRenewalCycleToSubscription(e.value, CYCLE_ID, { now: () => new Date(NOW) }))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    expect(e.d1_04.cycle?.subscription_sync_state).toBe('PENDING');
  });

  it('keeps ordinary payments valid before the renewal-cycle migration exists', async () => {
    const d1_01 = new MemoryD1(null, null) as unknown as D1Database;
    const d1_04 = new MemoryD1(null, null, false, true) as unknown as D1Database;
    const result = await syncRenewalCycleOutcomeForPayment(
      { D1_01: d1_01, D1_04: d1_04 },
      PAYMENT_ID,
      'merchant_test',
      { now: () => new Date(NOW) },
    );
    expect(result).toEqual({ cycleId: '', outcome: 'NO_RENEWAL_CYCLE' });
  });

  it('bounds the pending outcome reconciliation scan', async () => {
    const e = env();
    const result = await import('./subscription-renewal-outcome.js').then(({ syncPendingRenewalOutcomes }) =>
      syncPendingRenewalOutcomes(e.value, { limit: 10 }, { now: () => new Date(NOW) }));
    expect(result).toEqual({ scanned: 1, applied: 1, reconciliationRequired: 0, pendingRetry: 0 });
    expect(e.d1_04.pendingScanLimit).toBe(10);
  });

  it('caps an oversized pending outcome batch to the runtime maximum', async () => {
    const e = env();
    const { syncPendingRenewalOutcomes } = await import('./subscription-renewal-outcome.js');
    const result = await syncPendingRenewalOutcomes(e.value, { limit: 100_000 }, { now: () => new Date(NOW) });

    expect(e.d1_04.pendingScanLimit).toBe(50);
    expect(result).toEqual({ scanned: 1, applied: 1, reconciliationRequired: 0, pendingRetry: 0 });
  });

  it('fails closed when D1-04 cannot read the pending outcome batch', async () => {
    const e = env();
    e.d1_04.failPendingScan = true;
    const { syncPendingRenewalOutcomes } = await import('./subscription-renewal-outcome.js');

    await expect(syncPendingRenewalOutcomes(e.value, { limit: 20 }, { now: () => new Date(NOW) }))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    expect(e.d1_04.pendingScanLimit).toBe(20);
  });
});
