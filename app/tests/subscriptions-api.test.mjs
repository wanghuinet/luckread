import { beforeEach, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const calls = [];
mock.module('../lib/api-client.ts', () => ({
  apiRequest: async (path, options) => {
    calls.push({ path, options });
    return { response: { ok: true, status: 200 }, data: { data: { docs: [] } }, error: null };
  },
}));

const {
  fetchActiveMembershipPlansPage,
  fetchMySubscriptionsPage,
  fetchMyCommerceOrdersPage,
} = await import('../lib/subscriptions-api.ts');

beforeEach(() => {
  calls.length = 0;
});

test('loads the signed-in subscriber list through the canonical W01 route', async () => {
  const controller = new AbortController();
  await fetchMySubscriptionsPage({ page: 2, limit: 15, signal: controller.signal });

  expect(calls).toHaveLength(1);
  expect(calls[0]?.path).toBe('/memberships/subscriptions?limit=15&page=2');
  expect(calls[0]?.options.method).toBe('GET');
  expect(calls[0]?.options.signal).toBe(controller.signal);
});

test('loads current-user purchase history through the private W01 order route', async () => {
  const controller = new AbortController();
  await fetchMyCommerceOrdersPage({ limit: 10, cursor: 'opaque/cursor', signal: controller.signal });

  expect(calls).toHaveLength(1);
  expect(calls[0]?.path).toBe('/commerce/orders?limit=10&cursor=opaque%2Fcursor');
  expect(calls[0]?.options.method).toBe('GET');
  expect(calls[0]?.options.signal).toBe(controller.signal);
});

test('loads active public membership plans through the existing W01 catalog route', async () => {
  const controller = new AbortController();
  await fetchActiveMembershipPlansPage({ limit: 10, cursor: 'opaque/cursor', signal: controller.signal });

  expect(calls).toHaveLength(1);
  expect(calls[0]?.path).toBe('/plans?limit=10&cursor=opaque%2Fcursor');
  expect(calls[0]?.options.method).toBe('GET');
  expect(calls[0]?.options.signal).toBe(controller.signal);
});

test('rejects invalid pagination bounds before making a request', () => {
  expect(() => fetchMySubscriptionsPage({ page: 0 })).toThrow('between 1 and 10000');
  expect(() => fetchMySubscriptionsPage({ limit: 51 })).toThrow('between 1 and 50');
  expect(() => fetchActiveMembershipPlansPage({ limit: 0 })).toThrow('between 1 and 50');
  expect(() => fetchActiveMembershipPlansPage({ cursor: '' })).toThrow('between 1 and 2048');
  expect(() => fetchActiveMembershipPlansPage({ cursor: 'x'.repeat(2049) })).toThrow('between 1 and 2048');
  expect(() => fetchMyCommerceOrdersPage({ limit: 51 })).toThrow('between 1 and 50');
  expect(() => fetchMyCommerceOrdersPage({ cursor: '' })).toThrow('between 1 and 2048');
  expect(() => fetchMyCommerceOrdersPage({ cursor: 'x'.repeat(2049) })).toThrow('between 1 and 2048');
  expect(calls).toHaveLength(0);
});

test('keeps subscription mutations and mobile checkout disabled until store billing is verified', async () => {
  const api = await import('../lib/subscriptions-api.ts');
  const subscriptionsScreen = readFileSync(new URL('../app/(drawer)/subscriptions.tsx', import.meta.url), 'utf8');
  const plansScreen = readFileSync(new URL('../app/(drawer)/membership-plans.tsx', import.meta.url), 'utf8');
  const drawer = readFileSync(new URL('../app/(drawer)/_layout.tsx', import.meta.url), 'utf8');
  const billingHistoryScreen = readFileSync(new URL('../app/(drawer)/billing-history.tsx', import.meta.url), 'utf8');

  expect(Object.keys(api).sort()).toEqual(['fetchActiveMembershipPlansPage', 'fetchMyCommerceOrdersPage', 'fetchMySubscriptionsPage', 'fetchSavedPaymentMethods', 'revokeSavedPaymentMethod'].sort());
  expect(subscriptionsScreen).not.toContain('transitionMySubscription');
  expect(subscriptionsScreen).not.toContain('onTransition');
  expect(subscriptionsScreen).not.toContain('取消订阅');
  expect(subscriptionsScreen).not.toContain('暂停订阅');
  expect(subscriptionsScreen).not.toContain('恢复订阅');
  expect(plansScreen).toContain('fetchActiveMembershipPlansPage');
  expect(plansScreen).toContain('W07 已发布的公开会员目录');
  expect(plansScreen).toContain('暂不开放购买操作');
  expect(plansScreen).not.toContain('createCommerceOrder');
  expect(plansScreen).not.toContain('confirmPayment');
  expect(drawer).toContain("router.push('/membership-plans' as never)");
  expect(subscriptionsScreen).toContain("router.push('/billing-history' as never)");
  expect(billingHistoryScreen).toContain('fetchMyCommerceOrdersPage');
  expect(billingHistoryScreen).toContain('nextCursor');
  expect(billingHistoryScreen).toContain('orderId');
  expect(billingHistoryScreen).not.toContain('paymentToken');
  expect(billingHistoryScreen).not.toContain('merchantId');
});
