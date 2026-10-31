import { describe, expect, it } from 'vitest';
import { prepareFailedRenewalCycleRetry, type RenewalRuntimeEnv } from './renewal-runtime.js';

const NOW = '2026-10-28T12:00:00.000Z';
const CYCLE_START = '2026-10-28T10:00:00.000Z';
const CYCLE_END = '2026-11-28T10:00:00.000Z';
const CYCLE_ID = 'rcy_' + 'a'.repeat(26);
const PAYMENT_ID = 'pay_' + 'b'.repeat(26);
const MANDATE_ID = 'mnd_' + 'm'.repeat(26);
const SUB_ID = 'sub_' + 's'.repeat(64);

type Cycle = Record<string, unknown> & {
  cycle_id: string; state: string; subscription_sync_state: string; version: number; updated_at: string;
  attempt_number: number; payment_id: string | null;
};
type Subscription = Record<string, unknown> & {
  subscription_id: string; subscriber_id: string; plan_id: string; plan_version: number;
  status: string; current_period_end: string; cancel_at: string | null;
  scheduled_change_id: string | null;
  scheduled_source_plan_id: string | null;
  scheduled_source_plan_version: number | null;
  scheduled_target_plan_id: string | null;
  scheduled_target_plan_version: number | null;
  scheduled_effective_at: string | null;
};

const baseCycle = (overrides: Partial<Cycle> = {}): Cycle => ({
  cycle_id: CYCLE_ID, provider: 'hyperswitch', merchant_id: 'merchant_test',
  subscription_id: SUB_ID, subscriber_id: 'user_1', plan_id: 'plan_1', plan_version: 3,
  cycle_start: CYCLE_START, cycle_end: CYCLE_END, billing_interval: 'MONTHLY', currency: 'USD',
  offer_snapshot_json: JSON.stringify({ subscriptionId: SUB_ID, subscriberId: 'user_1', planId: 'plan_1',
    planVersion: 3, name: 'Creator Plus', tier: 'plus', billingInterval: 'MONTHLY',
    priceMinor: 1200, currency: 'USD', benefits: ['member-posts'] }),
  amount_minor: 1200, pricing_snapshot_json: JSON.stringify({ currency: 'USD', items: [] }),
  payment_method_id: 'pm_hyperswitch_123', mandate_record_id: MANDATE_ID,
  order_id: 'ord_1', payment_id: PAYMENT_ID, state: 'FAILED', attempt_number: 1,
  provider_response_status: 'failed', outcome_code: null, subscription_sync_state: 'APPLIED',
  subscription_sync_updated_at: '2026-10-28T11:00:00.000Z', subscription_sync_error_code: null,
  lease_token: null, lease_expires_at: null, version: 8,
  created_at: '2026-10-28T11:00:00.000Z', updated_at: '2026-10-28T11:00:00.000Z',
  ...overrides,
});

const baseSubscription = (overrides: Partial<Subscription> = {}): Subscription => ({
  subscription_id: SUB_ID, subscriber_id: 'user_1', plan_id: 'plan_1', plan_version: 3,
  status: 'PAST_DUE', current_period_start: '2026-09-28T10:00:00.000Z',
  current_period_end: CYCLE_START, cancel_at: null,
  scheduled_change_id: null, scheduled_source_plan_id: null, scheduled_source_plan_version: null,
  scheduled_target_plan_id: null, scheduled_target_plan_version: null, scheduled_effective_at: null,
  updated_at: '2026-10-28T11:00:00.000Z', version: 4,
  ...overrides,
});

const result = (changes: number): D1Result => ({ success: true, meta: { changes } }) as D1Result;

class Statement {
  values: unknown[] = [];
  constructor(readonly db: MemoryD1, readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this as unknown as D1PreparedStatement; }
  async first<T>() { return this.db.first<T>(this.sql, this.values); }
  async run<T>() { return this.db.run<T>(this.sql, this.values) as Promise<D1Result<T>>; }
}

class MemoryD1 {
  constructor(
    public cycle: Cycle | null,
    public subscription: Subscription | null,
    public activeMandate = true,
  ) {}
  prepare(sql: string) { return new Statement(this, sql) as unknown as D1PreparedStatement; }
  async first<T>(sql: string, values: unknown[]): Promise<T | null> {
    if (sql.includes('FROM subscription_renewal_cycles') && sql.includes('WHERE cycle_id = ?')) {
      return this.cycle ? structuredClone(this.cycle) as T : null;
    }
    if (sql.includes('FROM membership_subscriptions')) {
      if (this.subscription &&
          this.subscription.subscription_id === values[0] && this.subscription.subscriber_id === values[1]) {
        return structuredClone(this.subscription) as T;
      }
      return null;
    }
    if (sql.includes('FROM payment_mandates')) return this.activeMandate ? { active: 1 } as T : null;
    throw new Error('Unexpected renewal retry query: ' + sql);
  }
  async run<T>(sql: string, values: unknown[]): Promise<D1Result<T>> {
    if (sql.includes("UPDATE subscription_renewal_cycles SET state = 'PREPARED'")) {
      if (!this.cycle) return result(0) as D1Result<T>;
      const [updatedAt, cycleId, version, maxAttempts, retryCutoff] = values;
      const c = this.cycle;
      if (c.cycle_id !== cycleId || c.version !== version || c.state !== 'FAILED' ||
          c.subscription_sync_state !== 'APPLIED' || c.attempt_number >= Number(maxAttempts) ||
          Date.parse(c.updated_at) > Date.parse(String(retryCutoff))) return result(0) as D1Result<T>;
      this.cycle = {
        ...c, state: 'PREPARED', payment_id: null, provider_response_status: null,
        outcome_code: 'RETRY_PREPARED', subscription_sync_state: 'PENDING',
        subscription_sync_updated_at: null, subscription_sync_error_code: null,
        lease_token: null, lease_expires_at: null, version: c.version + 1, updated_at: String(updatedAt),
      };
      return result(1) as D1Result<T>;
    }
    throw new Error('Unexpected renewal retry update: ' + sql);
  }
}

function setup(options: {
  cycle?: Partial<Cycle>;
  subscription?: Partial<Subscription>;
  activeMandate?: boolean;
} = {}) {
  const d1_04 = new MemoryD1(baseCycle(options.cycle), null, options.activeMandate);
  const d1_01 = new MemoryD1(null, baseSubscription(options.subscription));
  const env: RenewalRuntimeEnv = {
    D1_01: d1_01 as unknown as D1Database,
    D1_04: d1_04 as unknown as D1Database,
  };
  return { env, d1_04, d1_01 };
}

describe('failed recurring payment recovery', () => {
  it('prepares one retry only after backoff and applied PAST_DUE synchronization', async () => {
    const f = setup();
    const first = await prepareFailedRenewalCycleRetry(f.env, CYCLE_ID, { now: () => new Date(NOW) });
    expect(first).toMatchObject({ state: 'PREPARED', action: 'PREPARED', cycleId: CYCLE_ID });
    expect(f.d1_04.cycle).toMatchObject({
      state: 'PREPARED', payment_id: null, provider_response_status: null, outcome_code: 'RETRY_PREPARED',
      subscription_sync_state: 'PENDING', subscription_sync_updated_at: null, version: 9,
    });
    const replay = await prepareFailedRenewalCycleRetry(f.env, CYCLE_ID, { now: () => new Date(NOW) });
    expect(replay).toMatchObject({ state: 'PREPARED', action: 'TERMINAL' });
  });

  it('waits for backoff instead of immediately repeating a failed off-session charge', async () => {
    const f = setup({ cycle: { updated_at: '2026-10-28T11:59:00.000Z' } });
    const result = await prepareFailedRenewalCycleRetry(f.env, CYCLE_ID, { now: () => new Date(NOW) });
    expect(result).toMatchObject({ state: 'FAILED', action: 'AWAITING_RETRY' });
    expect(f.d1_04.cycle?.state).toBe('FAILED');
  });

  it('never retries without applied subscription outcome or the exact active mandate', async () => {
    const pendingSync = setup({ cycle: {
      subscription_sync_state: 'PENDING',
      subscription_sync_updated_at: null,
    } });
    expect(await prepareFailedRenewalCycleRetry(pendingSync.env, CYCLE_ID, { now: () => new Date(NOW) }))
      .toMatchObject({ action: 'AWAITING_OUTCOME_SYNC' });
    expect(pendingSync.d1_04.cycle?.state).toBe('FAILED');

    const revokedMandate = setup({ activeMandate: false });
    expect(await prepareFailedRenewalCycleRetry(revokedMandate.env, CYCLE_ID, { now: () => new Date(NOW) }))
      .toMatchObject({ action: 'TERMINAL', state: 'FAILED' });
    expect(revokedMandate.d1_04.cycle?.state).toBe('FAILED');
  });

  it('retries a failed scheduled downgrade using the original source plan and exact pending schedule', async () => {
    const changeId = 'spc_' + 'd'.repeat(26);
    const targetPlanId = 'plan_2';
    const cycle = {
      plan_id: targetPlanId,
      plan_version: 1,
      offer_snapshot_json: JSON.stringify({
        subscriptionId: SUB_ID,
        subscriberId: 'user_1',
        creatorId: 'creator_1',
        planId: targetPlanId,
        planVersion: 1,
        name: 'Creator Basic',
        tier: 'basic',
        billingInterval: 'MONTHLY',
        priceMinor: 500,
        currency: 'USD',
        benefits: ['member-posts'],
        planChangeId: changeId,
        sourcePlanId: 'plan_1',
        sourcePlanVersion: 3,
      }),
    };
    const subscription = {
      scheduled_change_id: changeId,
      scheduled_source_plan_id: 'plan_1',
      scheduled_source_plan_version: 3,
      scheduled_target_plan_id: targetPlanId,
      scheduled_target_plan_version: 1,
      scheduled_effective_at: CYCLE_START,
    };
    const scheduled = setup({ cycle, subscription });
    const retry = await prepareFailedRenewalCycleRetry(scheduled.env, CYCLE_ID, { now: () => new Date(NOW) })
    expect(retry).toMatchObject({ state: 'PREPARED', action: 'PREPARED', cycleId: CYCLE_ID })
    expect(scheduled.d1_04.cycle).toMatchObject({
      state: 'PREPARED',
      outcome_code: 'RETRY_PREPARED',
      plan_id: targetPlanId,
      plan_version: 1,
    })
    expect(scheduled.d1_01.subscription).toMatchObject({
      plan_id: 'plan_1',
      plan_version: 3,
      status: 'PAST_DUE',
      scheduled_change_id: changeId,
      scheduled_target_plan_id: targetPlanId,
    })
  })

  it('refuses a scheduled downgrade retry when the schedule identity or target version drifted', async () => {
    const changeId = 'spc_' + 'e'.repeat(26);
    const cycle = {
      plan_id: 'plan_2',
      plan_version: 1,
      offer_snapshot_json: JSON.stringify({
        subscriptionId: SUB_ID,
        subscriberId: 'user_1',
        planId: 'plan_2',
        planVersion: 1,
        name: 'Creator Basic',
        tier: 'basic',
        billingInterval: 'MONTHLY',
        priceMinor: 500,
        currency: 'USD',
        benefits: ['member-posts'],
        planChangeId: changeId,
        sourcePlanId: 'plan_1',
        sourcePlanVersion: 3,
      }),
    };
    for (const subscription of [
      { scheduled_change_id: 'spc_' + 'f'.repeat(26), scheduled_source_plan_id: 'plan_1',
        scheduled_source_plan_version: 3, scheduled_target_plan_id: 'plan_2',
        scheduled_target_plan_version: 1, scheduled_effective_at: CYCLE_START },
      { scheduled_change_id: changeId, scheduled_source_plan_id: 'plan_1',
        scheduled_source_plan_version: 3, scheduled_target_plan_id: 'plan_2',
        scheduled_target_plan_version: 2, scheduled_effective_at: CYCLE_START },
    ]) {
      const f = setup({ cycle, subscription })
      const retry = await prepareFailedRenewalCycleRetry(f.env, CYCLE_ID, { now: () => new Date(NOW) })
      expect(retry).toMatchObject({ state: 'FAILED', action: 'TERMINAL' })
      expect(f.d1_04.cycle?.state).toBe('FAILED')
    }
  })

  it('does not retry after cancellation, period movement or plan-version drift', async () => {
    for (const subscription of [
      { status: 'CANCELED' },
      { current_period_end: CYCLE_END },
      { plan_version: 4 },
      { cancel_at: CYCLE_START },
    ]) {
      const f = setup({ subscription });
      const retry = await prepareFailedRenewalCycleRetry(f.env, CYCLE_ID, { now: () => new Date(NOW) });
      expect(retry.action).toBe('TERMINAL');
      expect(f.d1_04.cycle?.state).toBe('FAILED');
    }
  });
});
