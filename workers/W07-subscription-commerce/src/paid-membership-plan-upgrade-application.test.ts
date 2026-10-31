import { describe, expect, it } from 'vitest';
import {
  applyPaidMembershipPlanUpgrade,
  reservePaidMembershipPlanUpgrade,
  PaidMembershipUpgradeApplicationError,
  type PaidMembershipUpgradeApplicationInput,
  type PaidMembershipUpgradeReservationInput,
} from './paid-membership-plan-upgrade-application.js';

type State = {
  subscription: Record<string, unknown>;
  application: Record<string, unknown> | null;
  batchCount: number;
  insertCount: number;
  failNextSubscriptionCas: boolean;
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
            const matches = sql.includes('WHERE application_id = ?')
              ? state.application.application_id === values[0]
              : state.application.order_id === values[0] ||
                (state.application.subscription_id === values[1] &&
                  ['PENDING_PAYMENT', 'READY'].includes(String(state.application.status)));
            return (matches ? { ...state.application } : null) as T | null;
          }
          if (sql.includes('FROM membership_subscriptions')) {
            return (state.subscription.subscription_id === values[0] &&
              state.subscription.subscriber_id === values[1]
              ? { ...state.subscription }
              : null) as T | null;
          }
          return null as T | null;
        },
        async run() {
          if (!sql.startsWith('INSERT INTO membership_subscription_plan_change_applications')) {
            throw new Error('unexpected SQL run');
          }
          const [
            applicationId, subscriptionId, subscriberId, sourcePlanId, sourcePlanVersion,
            targetPlanId, targetPlanVersion, expectedVersion, periodStart, periodEnd,
            orderId, requestHash, createdAt, updatedAt,
          ] = values as [string,string,string,string,number,string,number,number,string,string,string,string,string,string];
          const activeReservation = state.application &&
            state.application.subscription_id === subscriptionId &&
            ['PENDING_PAYMENT', 'READY'].includes(String(state.application.status));
          const current = state.subscription;
          const subscriptionMatches = current.subscription_id === subscriptionId &&
            current.subscriber_id === subscriberId &&
            current.plan_id === sourcePlanId &&
            current.plan_version === sourcePlanVersion &&
            current.version === expectedVersion &&
            current.current_period_start === periodStart &&
            current.current_period_end === periodEnd &&
            current.status === 'ACTIVE' && current.cancel_at === null &&
            Date.parse(String(createdAt)) >= Date.parse(String(periodStart)) &&
            Date.parse(String(createdAt)) < Date.parse(String(periodEnd));
          if (activeReservation || !subscriptionMatches) return { meta: { changes: 0 } };
          state.application = {
            application_id: applicationId,
            subscription_id: subscriptionId,
            subscriber_id: subscriberId,
            source_plan_id: sourcePlanId,
            source_plan_version: sourcePlanVersion,
            target_plan_id: targetPlanId,
            target_plan_version: targetPlanVersion,
            expected_subscription_version: expectedVersion,
            current_period_start: periodStart,
            current_period_end: periodEnd,
            order_id: orderId,
            payment_id: null,
            request_hash: requestHash,
            status: 'PENDING_PAYMENT',
            version: 1,
            created_at: createdAt,
            updated_at: updatedAt,
          };
          state.insertCount += 1;
          return { meta: { changes: 1 } };
        },
      };
      return statement as unknown as D1PreparedStatement;
    },
    async batch(statements: D1PreparedStatement[]) {
      state.batchCount += 1;
      if (!state.application) throw new Error('missing application');
      const isRecovery = statements.length === 1;
      const update = (isRecovery ? statements[0] : statements[1]) as unknown as { values: unknown[] };
      const u = update.values;
      if (!u) throw new Error('missing subscription CAS values');
      if (isRecovery) {
        if (state.application.status !== 'READY' || !state.application.payment_id) {
          throw new Error('only an attached paid reservation may retry');
        }
      } else {
        const attach = statements[0] as unknown as { values: unknown[] };
        const v = attach.values;
        if (statements.length !== 2 || !v ||
            state.application.status !== 'PENDING_PAYMENT' || state.application.payment_id !== null) {
          throw new Error('unexpected paid upgrade batch');
        }
        const [attachedPaymentId, readyAt, applicationId, orderId] = v as [string,string,string,string];
        if (state.application.application_id !== applicationId || state.application.order_id !== orderId) {
          return [{ meta: { changes: 0 } }, { meta: { changes: 0 } }];
        }
        state.application.payment_id = attachedPaymentId;
        state.application.status = 'READY';
        state.application.version = Number(state.application.version) + 1;
        state.application.updated_at = readyAt;
      }

      const [
        updateTargetPlanId, updateTargetPlanVersion, updateUpdatedAt,
        updateSubscriptionId, updateSubscriberId, updateSourcePlanId,
        updateSourcePlanVersion, updateExpectedVersion, updatePeriodStart, updatePeriodEnd,
      ] = u as [string,number,string,string,string,string,number,number,string,string];
      if (state.failNextSubscriptionCas) {
        state.failNextSubscriptionCas = false;
        return isRecovery ? [{ meta: { changes: 0 } }] : [{ meta: { changes: 1 } }, { meta: { changes: 0 } }];
      }
      const current = state.subscription;
      const matches = current.subscription_id === updateSubscriptionId &&
        current.subscriber_id === updateSubscriberId &&
        current.plan_id === updateSourcePlanId &&
        current.plan_version === updateSourcePlanVersion &&
        current.version === updateExpectedVersion &&
        current.current_period_start === updatePeriodStart &&
        current.current_period_end === updatePeriodEnd &&
        current.status === 'ACTIVE' && current.cancel_at === null;
      if (!matches) {
        return isRecovery ? [{ meta: { changes: 0 } }] : [{ meta: { changes: 1 } }, { meta: { changes: 0 } }];
      }
      current.plan_id = updateTargetPlanId;
      current.plan_version = updateTargetPlanVersion;
      current.updated_at = updateUpdatedAt;
      current.version = Number(current.version) + 1;
      state.application.status = 'APPLIED';
      state.application.version = Number(state.application.version) + 1;
      state.application.updated_at = updateUpdatedAt;
      return isRecovery ? [{ meta: { changes: 1 } }] : [{ meta: { changes: 1 } }, { meta: { changes: 1 } }];
    },
  } as unknown as D1Database;
}

const sourcePlanId = 'plan_' + 'a'.repeat(64);
const targetPlanId = 'plan_' + 'b'.repeat(64);
const paymentId = 'pay_' + 'c'.repeat(26);
const currentPeriodStart = '2026-10-01T00:00:00.000Z';
const currentPeriodEnd = '2026-11-01T00:00:00.000Z';
const confirmedAt = '2026-10-15T12:00:00.000Z';
const reservedAt = '2026-10-10T12:00:00.000Z';

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

function reservation(overrides: Partial<PaidMembershipUpgradeReservationInput> = {}): PaidMembershipUpgradeReservationInput {
  const value = input();
  return {
    subscriptionId: value.subscriptionId,
    subscriberId: value.subscriberId,
    sourcePlanId: value.sourcePlanId,
    sourcePlanVersion: value.sourcePlanVersion,
    targetPlanId: value.targetPlanId,
    targetPlanVersion: value.targetPlanVersion,
    expectedSubscriptionVersion: value.expectedSubscriptionVersion,
    currentPeriodStart: value.currentPeriodStart,
    currentPeriodEnd: value.currentPeriodEnd,
    orderId: value.orderId,
    requestHash: value.requestHash,
    createdAt: reservedAt,
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
    insertCount: 0,
    failNextSubscriptionCas: Boolean(overrides.failNextSubscriptionCas),
  };
  return { db: fakeDb(state), state };
}

describe('paid immediate membership upgrade application', () => {
  it('reserves one upgrade checkout and applies the target plan only after verified payment', async () => {
    const f = fixture();
    const request = input();
    expect(await reservePaidMembershipPlanUpgrade(f.db, reservation(), 'line_upgrade_1')).toBe('RESERVED');
    expect(f.state.application).toMatchObject({ status: 'PENDING_PAYMENT', payment_id: null });

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
      status: 'APPLIED',
      version: 3,
    });

    const replay = await applyPaidMembershipPlanUpgrade(f.db, request, 'line_upgrade_1');
    expect(replay).toBe('ALREADY_APPLIED');
    expect(f.state.batchCount).toBe(1);
    expect(f.state.subscription.version).toBe(5);
  });

  it('retries a READY payment reservation when the first subscription CAS did not apply', async () => {
    const f = fixture({ failNextSubscriptionCas: true });
    const request = input();
    await reservePaidMembershipPlanUpgrade(f.db, reservation(), 'line_upgrade_1');
    await expect(applyPaidMembershipPlanUpgrade(f.db, request, 'line_upgrade_1'))
      .rejects.toBeInstanceOf(PaidMembershipUpgradeApplicationError);
    expect(f.state.application).toMatchObject({ status: 'READY', payment_id: request.paymentId });
    expect(f.state.subscription.version).toBe(4);

    expect(await applyPaidMembershipPlanUpgrade(f.db, request, 'line_upgrade_1')).toBe('APPLIED');
    expect(f.state.application).toMatchObject({ status: 'APPLIED', payment_id: request.paymentId });
    expect(f.state.subscription).toMatchObject({
      plan_id: targetPlanId,
      version: 5,
      current_period_start: currentPeriodStart,
      current_period_end: currentPeriodEnd,
    });
    expect(f.state.batchCount).toBe(2);
  });

  it('allows only one active upgrade checkout reservation for a subscription', async () => {
    const f = fixture();
    expect(await reservePaidMembershipPlanUpgrade(f.db, reservation(), 'line_upgrade_1')).toBe('RESERVED');
    await expect(reservePaidMembershipPlanUpgrade(
      f.db,
      reservation({ orderId: 'ord_upgrade_2', requestHash: 'e'.repeat(64) }),
      'line_upgrade_2',
    )).rejects.toBeInstanceOf(PaidMembershipUpgradeApplicationError);
    expect(f.state.insertCount).toBe(1);
    expect(f.state.application?.order_id).toBe('ord_upgrade_1');
  });

  it('replays an identical reservation without inserting a second application', async () => {
    const f = fixture();
    expect(await reservePaidMembershipPlanUpgrade(f.db, reservation(), 'line_upgrade_1')).toBe('RESERVED');
    expect(await reservePaidMembershipPlanUpgrade(f.db, reservation(), 'line_upgrade_1')).toBe('ALREADY_RESERVED');
    expect(f.state.insertCount).toBe(1);
  });

  it('rejects a stale subscription version before creating a reservation', async () => {
    const f = fixture({ version: 5 });
    await expect(reservePaidMembershipPlanUpgrade(f.db, reservation(), 'line_upgrade_1'))
      .rejects.toBeInstanceOf(PaidMembershipUpgradeApplicationError);
    expect(f.state.application).toBeNull();
    expect(f.state.insertCount).toBe(0);
    expect(f.state.batchCount).toBe(0);
  });

  it('rejects reuse of an order reference with a different paid-upgrade quote identity', async () => {
    const f = fixture();
    await reservePaidMembershipPlanUpgrade(f.db, reservation(), 'line_upgrade_1');
    await expect(applyPaidMembershipPlanUpgrade(
      f.db,
      input({ requestHash: 'e'.repeat(64) }),
      'line_upgrade_1',
    )).rejects.toBeInstanceOf(PaidMembershipUpgradeApplicationError);
    expect(f.state.batchCount).toBe(0);
  });
});
