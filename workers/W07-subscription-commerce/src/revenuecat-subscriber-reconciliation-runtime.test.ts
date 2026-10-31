import { describe, expect, it, vi } from 'vitest';
import {
  handleRevenueCatSubscriberReconciliationRequest,
  type RevenueCatSubscriberReconciliationRuntimeDependencies,
  type RevenueCatSubscriberReconciliationRuntimeEnv,
} from './revenuecat-subscriber-reconciliation-runtime.js';
import type { RevenueCatSubscriberSnapshot } from './revenuecat-subscriber-api.js';

const USER_ID = '123e4567-e89b-42d3-a456-426614174000';
const APP_ID = 'luckread-ios-production';

const snapshot: RevenueCatSubscriberSnapshot = {
  queriedAppUserId: USER_ID,
  originalAppUserId: USER_ID,
  aliases: [USER_ID],
  firstSeen: '2026-10-01T00:00:00.000Z',
  originalPurchaseDate: '2026-10-02T00:00:00.000Z',
  managementUrl: null,
  entitlements: {},
  subscriptions: {},
  requestDate: '2026-10-30T11:59:00.000Z',
  requestDateMs: Date.parse('2026-10-30T11:59:00.000Z'),
  customerCreatedOnLookup: false,
};

const request = (overrides: {
  path?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
} = {}) => {
  const method = overrides.method ?? 'POST';
  return new Request(
    'https://luckread-w07.internal' + (overrides.path ?? '/internal/subscriptions/reconcile-revenuecat'),
    {
      method,
      headers: {
        'X-LuckRead-Caller': 'W01',
        'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Correlation-Id': 'corr_revenuecat_test',
        'X-LuckRead-Principal-User-Id': USER_ID,
        'X-LuckRead-Principal-Layer': 'L2',
        'content-type': 'application/json; charset=utf-8',
        ...overrides.headers,
      },
      body: method === 'GET' || method === 'HEAD'
        ? undefined
        : overrides.body === undefined
          ? JSON.stringify({ appId: APP_ID })
          : overrides.body,
    },
  );
};

const env = (): RevenueCatSubscriberReconciliationRuntimeEnv => ({
  D1_01: {} as D1Database,
  REVENUECAT_SECRET_API_KEY: 'sk_server_only_secret',
  REVENUECAT_ALLOWED_APP_IDS: APP_ID + ',luckread-android-production',
});

const successDependencies = (
  overrides: Partial<RevenueCatSubscriberReconciliationRuntimeDependencies> = {},
): RevenueCatSubscriberReconciliationRuntimeDependencies => ({
  fetchSubscriber: vi.fn(async () => snapshot) as unknown as typeof import('./revenuecat-subscriber-api.js').fetchRevenueCatSubscriber,
  syncStoreTrials: vi.fn(async () => ({ created: 0, canceled: 0, converted: 0, expired: 0, unchanged: 0 })) as unknown as typeof import('./membership-trial-runtime.js').syncRevenueCatStoreTrialCandidates,
  buildCandidates: vi.fn(async () => ({
    appUserId: USER_ID,
    originalAppUserId: USER_ID,
    identityMatch: 'ORIGINAL_APP_USER_ID',
    snapshotRequestDateMs: Date.parse('2026-10-30T11:59:00.000Z'),
    customerCreatedOnLookup: false,
    candidates: [{
      planId: 'plan_creator_gold',
      planVersion: 3,
      creatorId: 'creator_123',
      billingInterval: 'MONTHLY',
      revenueCatAppId: APP_ID,
      store: 'APP_STORE',
      productId: 'creator.gold:monthly-v1',
      entitlementIds: ['creator_gold'],
      currentState: 'ACTIVE',
      purchaseDate: '2026-10-02T00:00:00.000Z',
      effectiveExpiresAt: '2026-11-05T00:00:00.000Z',
      gracePeriodExpiresAt: '2026-11-05T00:00:00.000Z',
      storeTransactionId: 'private-transaction-id',
      isSandbox: false,
      refundedAt: null,
      unsubscribeDetectedAt: null,
      billingIssuesDetectedAt: null,
      autoResumeDate: null,
      periodType: 'NORMAL',
      originalTransactionId: null,
    }],
  })) as unknown as typeof import('./revenuecat-subscriber-reconciliation.js').buildRevenueCatSubscriberReconciliationCandidates,
  ...overrides,
});

describe('W07 RevenueCat subscriber reconciliation runtime', () => {
  it('returns null for unrelated paths without contacting RevenueCat', async () => {
    const dependencies = successDependencies();
    const response = await handleRevenueCatSubscriberReconciliationRequest(
      request({ path: '/memberships/subscriptions' }),
      env(),
      dependencies,
    );
    expect(response).toBeNull();
    expect(dependencies.fetchSubscriber).not.toHaveBeenCalled();
  });

  it('allows only POST on the internal reconciliation route', async () => {
    const response = await handleRevenueCatSubscriberReconciliationRequest(
      request({ method: 'GET' }),
      env(),
      successDependencies(),
    );
    expect(response?.status).toBe(405);
    expect(response?.headers.get('allow')).toBe('POST');
  });

  it('requires W01 transport and a verified W02 L2+ principal before upstream access', async () => {
    const dependencies = successDependencies();
    const response = await handleRevenueCatSubscriberReconciliationRequest(
      request({ headers: { 'X-LuckRead-Principal-User-Id': 'client-user-id' } }),
      env(),
      dependencies,
    );
    expect(response?.status).toBe(403);
    expect(dependencies.fetchSubscriber).not.toHaveBeenCalled();
  });

  it('rejects browser credentials on the internal service route', async () => {
    const dependencies = successDependencies();
    const response = await handleRevenueCatSubscriberReconciliationRequest(
      request({ headers: { Cookie: 'session=secret' } }),
      env(),
      dependencies,
    );
    expect(response?.status).toBe(403);
    expect(dependencies.fetchSubscriber).not.toHaveBeenCalled();
  });

  it('accepts only configured RevenueCat app IDs and strict request bodies', async () => {
    const dependencies = successDependencies();
    const wrongApp = await handleRevenueCatSubscriberReconciliationRequest(
      request({ body: JSON.stringify({ appId: 'unknown-app' }) }),
      env(),
      dependencies,
    );
    expect(wrongApp?.status).toBe(400);

    const extraField = await handleRevenueCatSubscriberReconciliationRequest(
      request({ body: JSON.stringify({ appId: APP_ID, appUserId: USER_ID }) }),
      env(),
      dependencies,
    );
    expect(extraField?.status).toBe(400);
    expect(dependencies.fetchSubscriber).not.toHaveBeenCalled();
  });

  it('fails closed before upstream access when the RevenueCat secret is missing', async () => {
    const dependencies = successDependencies();
    const configuration = env();
    delete (configuration as { REVENUECAT_SECRET_API_KEY?: string }).REVENUECAT_SECRET_API_KEY;
    const response = await handleRevenueCatSubscriberReconciliationRequest(
      request(),
      configuration,
      dependencies,
    );
    expect(response?.status).toBe(503);
    expect(dependencies.fetchSubscriber).not.toHaveBeenCalled();
  });

  it('uses the W02 principal for RevenueCat and strips raw transaction and identity data', async () => {
    const dependencies = successDependencies();
    const response = await handleRevenueCatSubscriberReconciliationRequest(
      request(),
      env(),
      dependencies,
    );
    expect(response?.status).toBe(200);
    expect(dependencies.fetchSubscriber).toHaveBeenCalledWith({
      appUserId: USER_ID,
      secretApiKey: 'sk_server_only_secret',
    });
    const payload = await response!.json() as {
      data: { candidates: Array<Record<string, unknown>> };
    };
    expect(payload.data.candidates[0]).toMatchObject({
      planId: 'plan_creator_gold',
      planVersion: 3,
      creatorId: 'creator_123',
      currentState: 'ACTIVE',
    });
    expect(JSON.stringify(payload)).not.toContain('private-transaction-id');
    expect(JSON.stringify(payload)).not.toContain('originalAppUserId');
    expect(JSON.stringify(payload)).not.toContain('storeTransactionId');
    expect(response!.headers.get('cache-control')).toBe('no-store');
  });

  it('does not turn a newly created RevenueCat customer into purchase evidence', async () => {
    const dependencies = successDependencies({
      fetchSubscriber: vi.fn(async () => ({
        ...snapshot,
        entitlements: {},
        subscriptions: {},
        customerCreatedOnLookup: true,
      })) as unknown as typeof import('./revenuecat-subscriber-api.js').fetchRevenueCatSubscriber,
      buildCandidates: vi.fn(async () => ({
        appUserId: USER_ID,
        originalAppUserId: USER_ID,
        identityMatch: 'ORIGINAL_APP_USER_ID',
        snapshotRequestDateMs: Date.parse('2026-10-30T11:59:00.000Z'),
        customerCreatedOnLookup: true,
        candidates: [],
      })) as unknown as typeof import('./revenuecat-subscriber-reconciliation.js').buildRevenueCatSubscriberReconciliationCandidates,
    });
    const response = await handleRevenueCatSubscriberReconciliationRequest(
      request(),
      env(),
      dependencies,
    );
    expect(response?.status).toBe(200);
    const payload = await response!.json() as {
      data: { customerCreatedOnLookup: boolean; candidates: unknown[] };
    };
    expect(payload.data.customerCreatedOnLookup).toBe(true);
    expect(payload.data.candidates).toEqual([]);
  });
});
