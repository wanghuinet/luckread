import { describe, expect, it } from 'vitest';
import {
  processSubscriptionRenewalCycle,
  renewalCycleIdFor,
  type RenewalRuntimeEnv,
} from './renewal-runtime.js';

const CYCLE_START = '2026-10-28T00:00:00.000Z';
const CYCLE_END = '2026-11-28T00:00:00.000Z';

describe('renewal cycle runtime', () => {
  it('uses a stable cycle id for a subscription and one exact billing period', async () => {
    const first = await renewalCycleIdFor('sub_creator_monthly', CYCLE_START, CYCLE_END);
    const replay = await renewalCycleIdFor('sub_creator_monthly', CYCLE_START, CYCLE_END);
    const next = await renewalCycleIdFor('sub_creator_monthly', CYCLE_END, '2026-12-28T00:00:00.000Z');

    expect(first).toMatch(/^rcy_[a-f0-9]{26}$/);
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
