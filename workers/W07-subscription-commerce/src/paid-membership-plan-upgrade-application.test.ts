import { describe, expect, it } from 'vitest';
import {
  applyPaidMembershipPlanUpgrade,
  PaidMembershipUpgradeApplicationError,
  type PaidMembershipUpgradeApplicationInput,
} from './paid-membership-plan-upgrade-application.js';

type State = {
  subscription: Record<string, unknown>;
  application: Record<string, unknown> | null;
  batchCount: number;
};

function fakeDb(state: State): D1Database {
  return {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        sql,
        values,
        bind(...args: unknown[]) {
          values = args;
          statement.values = args;
          return statement;
        },
        async first<T>() {
          if (sql.includes('FROM membership_subscription_plan_change_applications')) {
            if (!state.application) return null as T | null;
            const key = sql.includes('WHERE application_id = ?')
              ? state.application.application_id === values[0]
              : state.application.order_id === values[0] || state.application.payment_id === values[1];
            return (key ? { ...state.application } : null) as T | null;
          }
          if (sql.includes('FROM membership_subscriptions')) {
            return (state.subscription.subscription_id === values[0] &&
              state.subscription.subscriber_id === values[1]
              ? { ...state.subscription }
              : null) as T | null;
          }
          return null as T | null;
        },
      };
      return statement as unknown as D1PreparedStatement;
    },
    async batch(statements: D1PreparedStatement[]) {
      state.batchCount += 1;
      const insert = statements[0] as unknown as { values: unknown[] };
      const update = statements[1] as unknown as { values: unknown[] };
      const v = insert.values;
      const u = update.values;
      if (!v || !u || statements.length !== 2 || state.application) {
        throw new Error('unexpected application batch');
      }
      const [
        applicationId, subscriptionId, subscriberId, sourcePlanId, sourcePlanVersion,
        targetPlanId, targetPlanVersion, expectedSubscriptionVersion,
        currentPeriodStart, currentPeriodEnd, orderId, paymentId,
        amountMinor, currency, requestHash, createdAt, applicationUpdatedAt,
      ] = v as [string,string,string,string,number,string,number,number,string,string,string,string,number,string,string,string,string];
      state.application = {
        application_id: applicationId,
        subscription_id: subscriptionId,
        subscriber_id: subscriberId,
        source_plan_id: sourcePlanId,
        source_plan_version: sourcePlanVersion,
        target_plan_id: targetPlanId,
        target_plan_version: targetPlanVersion,
        expected_subscription_version: expectedSubscriptionVersion,
        current_period_start: currentPeriodStart,
        current_period_end: currentPeriodEnd,
        order_id: orderId,
        payment_id: paymentId,
        amount_minor: amountMinor,
        currency,
        request_hash: requestHash,
        status: 'READY',
        version: 1,
        created_at: createdAt,
        updated_at: applicationUpdatedAt,
      };
      const [
        updateTargetPlanId, updateTargetPlanVersion, updateUpdatedAt,
        updateSubscriptionId, updateSubscriberId, updateSourcePlanId,
        updateSourcePlanVersion, updateExpectedVersion, updatePeriodStart, updatePeriodEnd,
      ] = u as [string,number,string,string,string,string,number,number,string,string];
      const current = state.subscription;
      const matches = current.subscription_id === updateSubscriptionId &&
        current.subscriber_id === updateSubscriberId &&
        current.plan_id === updateSourcePlanId &&
        current.plan_version === updateSourcePlanVersion &&
        current.version === updateExpectedVersion &&
        current.current_period_start === updatePeriodStart &&
        current.current_period_end === updatePeriodEnd &&
        current.status === 'ACTIVE' &&
        current.cancel_at === null;
      if (!matches) {
        state.application = null;
        return [{ meta: { changes: 0 } }, { meta: { changes: 0 } }];
      }
      current.plan_id = updateTargetPlanId;
      current.plan_version = updateTargetPlanVersion;
      current.updated_at = updateUpdatedAt;
      current.version = Number(current.version) + 1;
      state.application.status = 'APPLIED';
      state.application.version = 2;
      state.application.updated_at = updateUpdatedAt;
      return [{ meta: { changes: 1 } }, { meta: { changes: 1 } }];
    },
  } as unknown as D1Database;
}

const sourcePlanId = 'plan_' + 'a'.repeat(64);
const targetPlanId = 'plan_' + 'b'.repeat(64);
const paymentId = 'pay_' + 'c'.repeat(26);
const currentPeriodStart = '2026-10-01T00:00:00.000Z';
const currentPeriodEnd = '2026-11-01T00:00:00.000Z';
const confirmedAt = '2026-10-15T12:00:00.000Z';

function input(overrides: Partial<PaidMembershipUpgradeApplicationInput> = {}): PaidMembershipUpgradeApplicationInput {
  return {
    subscriptionId: 'sub_upgrade_1',
    subscriberId: 'user_1',
    sourcePlanId,
    sourcePlanVersion: 1,
    targetPlanId,
    targetPlanVersion: 2,
    expectedSubscriptionVersion: 4,
    currentPeriodStart,
    currentPeriodEnd,
    orderId: 'ord_upgrade_1',
    paymentId,
    amountMinor: 575,
    currency: 'USD',
    requestHash: 'd'.repeat(64),
    confirmedAt,
    ...overrides,
  };
}

function fixture(overrides: Partial<Record<string, unknown>> = {}) {
  const state: State = {
    subscription: {
      subscription_id: 'sub_upgrade_1',
      subscriber_id: 'user_1',
      plan_id: sourcePlanId,
      plan_version: 1,
      status: 'ACTIVE',
      current_period_start: currentPeriodStart,
      current_period_end: currentPeriodEnd,
      cancel_at: null,
      updated_at: '2026-10-10T12:00:00.000Z',
      version: 4,
      ...overrides,
    },
    application: null,
    batchCount: 0,
  };
  return { db: fakeDb(state), state };
}

describe('paid immediate membership upgrade application', () => {
  it('applies the target plan after a verified payment without resetting the current paid period', async () => {
    const f = fixture();
    const request = input();
    const outcome = await applyPaidMembershipPlanUpgrade(f.db, request, 'line_upgrade_1');

    expect(outcome).toBe('APPLIED');
    expect(f.state.batchCount).toBe(1);
    expect(f.state.subscription).toMatchObject({
      plan_id: targetPlanId,
      plan_version: 2,
      version: 5,
      current_period_start: currentPeriodStart,
      current_period_end: currentPeriodEnd,
      status: 'ACTIVE',
    });
    expect(f.state.application).toMatchObject({
      order_id: request.orderId,
      payment_id: request.paymentId,
      amount_minor: request.amountMinor,
      currency: request.currency,
      status: 'APPLIED',
      version: 2,
    });

    const replay = await applyPaidMembershipPlanUpgrade(f.db, request, 'line_upgrade_1');
    expect(replay).toBe('ALREADY_APPLIED');
    expect(f.state.batchCount).toBe(1);
    expect(f.state.subscription.version).toBe(5);
  });

  it('rejects a stale subscription version before creating an application proof', async () => {
    const f = fixture({ version: 5 });
    await expect(applyPaidMembershipPlanUpgrade(f.db, input(), 'line_upgrade_1'))
      .rejects.toBeInstanceOf(PaidMembershipUpgradeApplicationError);
    expect(f.state.application).toBeNull();
    expect(f.state.batchCount).toBe(0);
  });

  it('rejects reuse of an order or payment reference with a different paid-upgrade identity', async () => {
    const f = fixture();
    const request = input();
    await applyPaidMembershipPlanUpgrade(f.db, request, 'line_upgrade_1');
    await expect(applyPaidMembershipPlanUpgrade(f.db, input({ amountMinor: 999 }), 'line_upgrade_1'))
      .rejects.toBeInstanceOf(PaidMembershipUpgradeApplicationError);
    expect(f.state.batchCount).toBe(1);
  });
});
