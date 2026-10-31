import { describe, expect, it } from 'vitest';
import type { RevenueCatSubscriberSnapshot } from './revenuecat-subscriber-api.js';
import {
  buildRevenueCatSubscriberReconciliationCandidates,
  RevenueCatSubscriberReconciliationError,
} from './revenuecat-subscriber-reconciliation.js';

const W02_USER_ID = '123e4567-e89b-42d3-a456-426614174000';
const NOW = Date.parse('2026-10-30T12:00:00.000Z');
const REQUEST_DATE_MS = Date.parse('2026-10-30T11:59:00.000Z');
const APP_ID = 'luckread-ios-production';
const PRODUCT_ID = 'creator.gold:monthly-v1';

const baseSnapshot = (): RevenueCatSubscriberSnapshot => ({
  queriedAppUserId: W02_USER_ID,
  originalAppUserId: '$RCAnonymousID:anonymous-1',
  aliases: ['$RCAnonymousID:anonymous-1', W02_USER_ID],
  firstSeen: '2026-10-01T00:00:00.000Z',
  originalPurchaseDate: '2026-10-02T00:00:00.000Z',
  managementUrl: null,
  entitlements: {
    creator_gold: {
      expires_date: '2026-11-02T00:00:00.000Z',
      grace_period_expires_date: '2026-11-05T00:00:00.000Z',
      product_identifier: PRODUCT_ID,
      purchase_date: '2026-10-02T00:00:00.000Z',
    },
  },
  subscriptions: {
    [PRODUCT_ID]: {
      expires_date: '2026-11-02T00:00:00.000Z',
      grace_period_expires_date: '2026-11-05T00:00:00.000Z',
      purchase_date: '2026-10-02T00:00:00.000Z',
      is_sandbox: false,
      store: 'app_store',
      store_transaction_id: '2000000999999999',
      unsubscribe_detected_at: null,
      refunded_at: null,
    },
  },
  requestDate: '2026-10-30T11:59:00.000Z',
  requestDateMs: REQUEST_DATE_MS,
  customerCreatedOnLookup: false,
});

type FakeRow = {
  plan_id: string;
  plan_version: number;
  creator_id: string;
  billing_interval: string;
};

function fakeDb(row: FakeRow | null = {
  plan_id: 'plan_creator_gold',
  plan_version: 3,
  creator_id: 'creator_123',
  billing_interval: 'MONTHLY',
}, failure?: Error) {
  const statements: string[] = [];
  const bindings: unknown[][] = [];
  const db = {
    prepare(statement: string) {
      statements.push(statement);
      return {
        bind(...values: unknown[]) {
          bindings.push(values);
          return {
            async first<T>() {
              if (failure) throw failure;
              return row as T | null;
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, statements, bindings };
}

const options = {
  expectedAppUserId: W02_USER_ID,
  revenueCatAppId: APP_ID,
};

describe('RevenueCat current subscriber reconciliation candidates', () => {
  it('binds a verified W02 principal, exact app/store/product and the historical plan version', async () => {
    const { db, statements, bindings } = fakeDb();

    const result = await buildRevenueCatSubscriberReconciliationCandidates(
      db,
      { ...options, snapshot: baseSnapshot() },
      { nowMs: () => NOW },
    );

    expect(result).toMatchObject({
      appUserId: W02_USER_ID,
      originalAppUserId: '$RCAnonymousID:anonymous-1',
      identityMatch: 'ALIAS',
      snapshotRequestDateMs: REQUEST_DATE_MS,
      customerCreatedOnLookup: false,
    });
    expect(result.candidates).toEqual([{
      planId: 'plan_creator_gold',
      planVersion: 3,
      creatorId: 'creator_123',
      billingInterval: 'MONTHLY',
      revenueCatAppId: APP_ID,
      store: 'APP_STORE',
      productId: PRODUCT_ID,
      entitlementIds: ['creator_gold'],
      currentState: 'ACTIVE',
      purchaseDate: '2026-10-02T00:00:00.000Z',
      effectiveExpiresAt: '2026-11-05T00:00:00.000Z',
      gracePeriodExpiresAt: '2026-11-05T00:00:00.000Z',
      storeTransactionId: '2000000999999999',
      isSandbox: false,
      refundedAt: null,
      unsubscribeDetectedAt: null,
      billingIssuesDetectedAt: null,
      autoResumeDate: null,
    }]);
    expect(statements[0]).toContain("b.status IN ('ACTIVE', 'RETIRED')");
    expect(statements[0]).not.toContain('p.current_version = b.plan_version');
    expect(bindings[0]).toEqual([APP_ID, 'APP_STORE', PRODUCT_ID]);
  });

  it('uses the authenticated principal identity, never a webhook or client identifier', async () => {
    const { db, statements } = fakeDb();

    await expect(buildRevenueCatSubscriberReconciliationCandidates(
      db,
      {
        ...options,
        expectedAppUserId: '123e4567-e89b-42d3-a456-426614174001',
        snapshot: baseSnapshot(),
      },
      { nowMs: () => NOW },
    )).rejects.toMatchObject({ code: 'SNAPSHOT_QUERY_MISMATCH' });
    expect(statements).toHaveLength(0);
  });

  it('returns no purchase candidate for a RevenueCat 201 get-or-create empty customer', async () => {
    const { db, statements } = fakeDb();
    const snapshot: RevenueCatSubscriberSnapshot = {
      ...baseSnapshot(),
      originalAppUserId: W02_USER_ID,
      aliases: [W02_USER_ID],
      entitlements: {},
      subscriptions: {},
      customerCreatedOnLookup: true,
    };

    const result = await buildRevenueCatSubscriberReconciliationCandidates(
      db,
      { ...options, snapshot },
      { nowMs: () => NOW },
    );

    expect(result.customerCreatedOnLookup).toBe(true);
    expect(result.candidates).toEqual([]);
    expect(statements).toHaveLength(0);
  });

  it('rejects an inconsistent non-empty customer-created snapshot', async () => {
    const snapshot: RevenueCatSubscriberSnapshot = {
      ...baseSnapshot(),
      customerCreatedOnLookup: true,
    };
    const { db, statements } = fakeDb();

    await expect(buildRevenueCatSubscriberReconciliationCandidates(
      db,
      { ...options, snapshot },
      { nowMs: () => NOW },
    )).rejects.toBeInstanceOf(RevenueCatSubscriberReconciliationError);
    expect(statements).toHaveLength(0);
  });

  it('keeps an entitlement active during its grace period after the base expiry', async () => {
    const base = baseSnapshot();
    const snapshot: RevenueCatSubscriberSnapshot = {
      ...base,
      entitlements: {
        ...base.entitlements,
        creator_gold: {
          ...base.entitlements.creator_gold!,
          expires_date: '2026-10-29T00:00:00.000Z',
          grace_period_expires_date: '2026-10-31T00:00:00.000Z',
        },
      },
      subscriptions: {
        ...base.subscriptions,
        [PRODUCT_ID]: {
          ...base.subscriptions[PRODUCT_ID]!,
          expires_date: '2026-10-29T00:00:00.000Z',
          grace_period_expires_date: '2026-10-31T00:00:00.000Z',
        },
      },
    };
    const { db } = fakeDb();

    const result = await buildRevenueCatSubscriberReconciliationCandidates(
      db,
      { ...options, snapshot },
      { nowMs: () => NOW },
    );
    expect(result.candidates[0]?.currentState).toBe('ACTIVE');
    expect(result.candidates[0]?.effectiveExpiresAt).toBe('2026-10-31T00:00:00.000Z');
  });

  it('keeps an expired store subscription candidate when RevenueCat no longer returns an active entitlement', async () => {
    const base = baseSnapshot();
    const snapshot: RevenueCatSubscriberSnapshot = {
      ...base,
      entitlements: {},
      subscriptions: {
        ...base.subscriptions,
        [PRODUCT_ID]: {
          ...base.subscriptions[PRODUCT_ID]!,
          expires_date: '2026-10-29T00:00:00.000Z',
          grace_period_expires_date: null,
          period_type: 'TRIAL',
          original_transaction_id: '2000000999999999',
        },
      },
    };
    const { db } = fakeDb();
    const result = await buildRevenueCatSubscriberReconciliationCandidates(
      db,
      { ...options, snapshot },
      { nowMs: () => NOW },
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      currentState: 'EXPIRED',
      periodType: 'TRIAL',
      effectiveExpiresAt: '2026-10-29T00:00:00.000Z',
      entitlementIds: [],
      originalTransactionId: '2000000999999999',
    });
  });

  it('marks an expired entitlement inactive based on the current snapshot', async () => {
    const base = baseSnapshot();
    const snapshot: RevenueCatSubscriberSnapshot = {
      ...base,
      entitlements: {
        ...base.entitlements,
        creator_gold: {
          ...base.entitlements.creator_gold!,
          expires_date: '2026-10-29T00:00:00.000Z',
          grace_period_expires_date: null,
        },
      },
      subscriptions: {
        ...base.subscriptions,
        [PRODUCT_ID]: {
          ...base.subscriptions[PRODUCT_ID]!,
          expires_date: '2026-10-29T00:00:00.000Z',
          grace_period_expires_date: null,
        },
      },
    };
    const { db } = fakeDb();

    const result = await buildRevenueCatSubscriberReconciliationCandidates(
      db,
      { ...options, snapshot },
      { nowMs: () => NOW },
    );
    expect(result.candidates[0]?.currentState).toBe('EXPIRED');
    expect(result.candidates[0]?.effectiveExpiresAt).toBe('2026-10-29T00:00:00.000Z');
  });

  it('marks a provider-confirmed refund inactive without treating cancellation as immediate revocation', async () => {
    const base = baseSnapshot();
    const refunded: RevenueCatSubscriberSnapshot = {
      ...base,
      entitlements: {
        ...base.entitlements,
        creator_gold: {
          ...base.entitlements.creator_gold!,
          expires_date: '2026-10-29T00:00:00.000Z',
          grace_period_expires_date: null,
        },
      },
      subscriptions: {
        ...base.subscriptions,
        [PRODUCT_ID]: {
          ...base.subscriptions[PRODUCT_ID]!,
          expires_date: '2026-10-29T00:00:00.000Z',
          grace_period_expires_date: null,
          refunded_at: '2026-10-30T10:00:00.000Z',
          unsubscribe_detected_at: null,
        },
      },
    };
    const { db } = fakeDb();
    const result = await buildRevenueCatSubscriberReconciliationCandidates(
      db,
      { ...options, snapshot: refunded },
      { nowMs: () => NOW },
    );
    expect(result.candidates[0]?.currentState).toBe('REFUNDED');

    const cancelled: RevenueCatSubscriberSnapshot = {
      ...base,
      subscriptions: {
        ...base.subscriptions,
        [PRODUCT_ID]: {
          ...base.subscriptions[PRODUCT_ID]!,
          unsubscribe_detected_at: '2026-10-30T10:00:00.000Z',
        },
      },
    };
    const cancelledDb = fakeDb();
    const cancelledResult = await buildRevenueCatSubscriberReconciliationCandidates(
      cancelledDb.db,
      { ...options, snapshot: cancelled },
      { nowMs: () => NOW },
    );
    expect(cancelledResult.candidates[0]?.currentState).toBe('ACTIVE');
  });

  it('deduplicates multiple entitlements granted by one store product', async () => {
    const base = baseSnapshot();
    const snapshot: RevenueCatSubscriberSnapshot = {
      ...base,
      entitlements: {
        ...base.entitlements,
        creator_plus: {
          ...base.entitlements.creator_gold!,
          product_identifier: PRODUCT_ID,
        },
      },
    };
    const { db, statements } = fakeDb();

    const result = await buildRevenueCatSubscriberReconciliationCandidates(
      db,
      { ...options, snapshot },
      { nowMs: () => NOW },
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.entitlementIds).toEqual(['creator_gold', 'creator_plus']);
    expect(statements).toHaveLength(1);
  });

  it('fails closed for unmapped products instead of returning partial candidates', async () => {
    const base = baseSnapshot();
    const snapshot: RevenueCatSubscriberSnapshot = {
      ...base,
      entitlements: {
        ...base.entitlements,
        creator_gold: {
          ...base.entitlements.creator_gold!,
          product_identifier: 'unmapped.product:monthly',
        },
      },
      subscriptions: {
        'unmapped.product:monthly': {
          ...base.subscriptions[PRODUCT_ID]!,
        },
      },
    };
    const { db, statements } = fakeDb(null);

    await expect(buildRevenueCatSubscriberReconciliationCandidates(
      db,
      { ...options, snapshot },
      { nowMs: () => NOW },
    )).rejects.toMatchObject({ code: 'PRODUCT_MAPPING_UNAVAILABLE' });
    expect(statements).toHaveLength(1);
  });

  it('rejects unsupported stores and entitlements without a subscription snapshot', async () => {
    const base = baseSnapshot();
    const unsupported: RevenueCatSubscriberSnapshot = {
      ...base,
      subscriptions: {
        ...base.subscriptions,
        [PRODUCT_ID]: {
          ...base.subscriptions[PRODUCT_ID]!,
          store: 'PROMOTIONAL',
        },
      },
    };
    const unsupportedDb = fakeDb();
    await expect(buildRevenueCatSubscriberReconciliationCandidates(
      unsupportedDb.db,
      { ...options, snapshot: unsupported },
      { nowMs: () => NOW },
    )).rejects.toMatchObject({ code: 'UNSUPPORTED_STORE' });
    expect(unsupportedDb.statements).toHaveLength(0);

    const missingSubscription: RevenueCatSubscriberSnapshot = {
      ...base,
      subscriptions: {},
    };
    const missingDb = fakeDb();
    await expect(buildRevenueCatSubscriberReconciliationCandidates(
      missingDb.db,
      { ...options, snapshot: missingSubscription },
      { nowMs: () => NOW },
    )).rejects.toMatchObject({ code: 'SUBSCRIPTION_NOT_FOUND' });
    expect(missingDb.statements).toHaveLength(0);
  });

  it('requires a real snapshot request timestamp and validates malformed provider maps', async () => {
    const base = baseSnapshot();
    const missingVersion: RevenueCatSubscriberSnapshot = {
      ...base,
      requestDateMs: null,
    };
    const missingDb = fakeDb();

    await expect(buildRevenueCatSubscriberReconciliationCandidates(
      missingDb.db,
      { ...options, snapshot: missingVersion },
      { nowMs: () => NOW },
    )).rejects.toMatchObject({ code: 'SNAPSHOT_VERSION_MISSING' });
    expect(missingDb.statements).toHaveLength(0);

    const malformed: RevenueCatSubscriberSnapshot = {
      ...base,
      entitlements: {
        ...base.entitlements,
        creator_gold: {
          ...base.entitlements.creator_gold!,
          purchase_date: 'not-a-date',
        },
      },
    };
    const malformedDb = fakeDb();
    await expect(buildRevenueCatSubscriberReconciliationCandidates(
      malformedDb.db,
      { ...options, snapshot: malformed },
      { nowMs: () => NOW },
    )).rejects.toMatchObject({ code: 'INVALID_SNAPSHOT' });
    expect(malformedDb.statements).toHaveLength(0);
  });

  it('fails closed when the RevenueCat product-binding database is unavailable', async () => {
    const { db, statements } = fakeDb(null, new Error('private D1 error'));

    await expect(buildRevenueCatSubscriberReconciliationCandidates(
      db,
      { ...options, snapshot: baseSnapshot() },
      { nowMs: () => NOW },
    )).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    expect(statements).toHaveLength(1);
  });
});
