import { describe, expect, it } from 'vitest';
import type { W07WebhookPostgresClient, W07WebhookPostgresPool } from './payment-webhook-database-postgres.js';
import { prepareFailedRenewalCycleRetry, type RenewalRuntimeEnv } from './renewal-runtime.js';

const NOW = '2026-10-28T12:00:00.000Z';
const CYCLE_START = '2026-10-28T10:00:00.000Z';
const CYCLE_END = '2026-11-28T10:00:00.000Z';
const CYCLE_ID = 'rcy_' + 'a'.repeat(26);
const PAYMENT_ID = 'pay_' + 'b'.repeat(26);
const MANDATE_ID = 'mnd_' + 'm'.repeat(26);
const SUB_ID = 'sub_' + 's'.repeat(64);

type Cycle = Record<string, unknown> & {
  cycle_id: string;
  state: string;
  subscription_sync_state: string;
  version: number;
  updated_at: string;
  attempt_number: number;
  payment_id: string | null;
};
type Subscription = Record<string, unknown> & {
  subscription_id: string;
  subscriber_id: string;
  plan_id: string;
  plan_version: number;
  status: string;
  current_period_end: string;
  cancel_at: string | null;
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
  creator_id: 'creator_1', status: 'PAST_DUE', current_period_start: '2026-09-28T10:00:00.000Z',
  current_period_end: CYCLE_START, trial_started_at: null, trial_ends_at: null, cancel_at: null,
  updated_at: '2026-10-28T11:00:00.000Z', version: 4,
  ...overrides,
});

class MemoryFinancePostgres implements W07WebhookPostgresPool {
  constructor(public cycle: Cycle | null, public activeMandate = true) {}

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ): Promise<{ rows: Row[]; rowCount: number }> {
    if (sql.includes('FROM subscription_renewal_cycles') && sql.includes('WHERE cycle_id = $1')) {
      const row = this.cycle?.cycle_id === values[0] ? structuredClone(this.cycle) : null;
      const rows = row ? [row] : [];
      return { rows: rows as Row[], rowCount: rows.length };
    }
    if (sql.includes('FROM payment_mandates')) {
      const rows = this.activeMandate ? [{ active: 1 }] : [];
      return { rows: rows as Row[], rowCount: rows.length };
    }
    if (sql.startsWith("UPDATE subscription_renewal_cycles SET state = 'PREPARED'")) {
      const [updatedAt, cycleId, version, maxAttempts, retryCutoff] = values;
      const c = this.cycle;
      const canRetry = !!c &&
        c.cycle_id === cycleId &&
        c.version === version &&
        c.state === 'FAILED' &&
        c.subscription_sync_state === 'APPLIED' &&
        c.attempt_number < Number(maxAttempts) &&
        Date.parse(c.updated_at) <= Date.parse(String(retryCutoff));
      if (!canRetry) return { rows: [], rowCount: 0 };
      this.cycle = {
        ...c!,
        state: 'PREPARED',
        payment_id: null,
        provider_response_status: null,
        outcome_code: 'RETRY_PREPARED',
        subscription_sync_state: 'PENDING',
        subscription_sync_updated_at: null,
        subscription_sync_error_code: null,
        lease_token: null,
        lease_expires_at: null,
        version: c!.version + 1,
        updated_at: String(updatedAt),
      };
      const rows = [{ cycle_id: this.cycle.cycle_id }];
      return { rows: rows as Row[], rowCount: rows.length };
    }
    throw new Error('Unexpected Neon finance query: ' + sql);
  }

  async connect(): Promise<W07WebhookPostgresClient> {
    return { query: this.query.bind(this), release() {} };
  }
}

function membershipPoolFor(subscription: Subscription | null): W07WebhookPostgresPool {
  const query = async <Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ) => {
    if (sql.includes('FROM membership_subscription_scheduled_plan_changes')) {
      return { rows: [] as Row[], rowCount: 0 };
    }
    if (sql.includes('FROM membership_subscriptions')) {
      const row = subscription &&
        subscription.subscription_id === values[0] &&
        subscription.subscriber_id === values[1]
        ? structuredClone(subscription)
        : null;
      const rows = row ? [row] : [];
      return { rows: rows as Row[], rowCount: rows.length };
    }
    throw new Error('Unexpected Neon membership query: ' + sql);
  };
  const client: W07WebhookPostgresClient = { query, release() {} };
  return { query, async connect() { return client; } };
}

function setup(options: {
  cycle?: Partial<Cycle>;
  subscription?: Partial<Subscription>;
  activeMandate?: boolean;
} = {}) {
  const financePool = new MemoryFinancePostgres(baseCycle(options.cycle), options.activeMandate);
  const membershipPool = membershipPoolFor(baseSubscription(options.subscription));
  const env: RenewalRuntimeEnv = {
    W07_DATABASE_DRIVER: 'neon',
    W07_MEMBERSHIP_DATABASE_DRIVER: 'neon',
    HYPERDRIVE_D1_04: { connectionString: 'postgresql://test.invalid/luckread' },
  };
  const dependencies = {
    now: () => new Date(NOW),
    getMembershipPostgresPool: () => membershipPool,
    getRenewalCycleStore: () => financePool,
  };
  return { env, financePool, membershipPool, dependencies };
}

describe('failed recurring payment recovery', () => {
  it('prepares one retry only after backoff and applied PAST_DUE synchronization', async () => {
    const f = setup();
    const first = await prepareFailedRenewalCycleRetry(f.env, CYCLE_ID, f.dependencies);
    expect(first).toMatchObject({ state: 'PREPARED', action: 'PREPARED', cycleId: CYCLE_ID });
    expect(f.financePool.cycle).toMatchObject({
      state: 'PREPARED', payment_id: null, provider_response_status: null, outcome_code: 'RETRY_PREPARED',
      subscription_sync_state: 'PENDING', subscription_sync_updated_at: null, version: 9,
    });
    const replay = await prepareFailedRenewalCycleRetry(f.env, CYCLE_ID, f.dependencies);
    expect(replay).toMatchObject({ state: 'PREPARED', action: 'TERMINAL' });
  });

  it('waits for backoff instead of immediately repeating a failed off-session charge', async () => {
    const f = setup({ cycle: { updated_at: '2026-10-28T11:59:00.000Z' } });
    const result = await prepareFailedRenewalCycleRetry(f.env, CYCLE_ID, f.dependencies);
    expect(result).toMatchObject({ state: 'FAILED', action: 'AWAITING_RETRY' });
    expect(f.financePool.cycle?.state).toBe('FAILED');
  });

  it('never retries without applied subscription outcome or the exact active mandate', async () => {
    const pendingSync = setup({
      cycle: { subscription_sync_state: 'PENDING', subscription_sync_updated_at: null },
    });
    expect(await prepareFailedRenewalCycleRetry(pendingSync.env, CYCLE_ID, pendingSync.dependencies))
      .toMatchObject({ action: 'AWAITING_OUTCOME_SYNC' });
    expect(pendingSync.financePool.cycle?.state).toBe('FAILED');

    const revokedMandate = setup({ activeMandate: false });
    expect(await prepareFailedRenewalCycleRetry(revokedMandate.env, CYCLE_ID, revokedMandate.dependencies))
      .toMatchObject({ action: 'TERMINAL', state: 'FAILED' });
    expect(revokedMandate.financePool.cycle?.state).toBe('FAILED');
  });

  it('does not retry after cancellation, period movement or plan-version drift', async () => {
    for (const subscription of [
      { status: 'CANCELED' },
      { current_period_end: CYCLE_END },
      { plan_version: 4 },
      { cancel_at: CYCLE_START },
    ]) {
      const f = setup({ subscription });
      const retry = await prepareFailedRenewalCycleRetry(f.env, CYCLE_ID, f.dependencies);
      expect(retry.action).toBe('TERMINAL');
      expect(f.financePool.cycle?.state).toBe('FAILED');
    }
  });
});
