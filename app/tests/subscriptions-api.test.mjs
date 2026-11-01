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
  fetchSavedPaymentMethods,
  revokeSavedPaymentMethod,
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
  expect(calls).toHaveLength(0);
});

test('lists only the signed-in user saved payment methods through W01', async () => {
  const controller = new AbortController();
  await fetchSavedPaymentMethods({ signal: controller.signal });

  expect(calls).toHaveLength(1);
  expect(calls[0]?.path).toBe('/payment-methods');
  expect(calls[0]?.options.method).toBe('GET');
  expect(calls[0]?.options.signal).toBe(controller.signal);
});

test('removes a saved payment method with the caller idempotency key', async () => {
  const savedPaymentMethodId = 'spm_' + 'a'.repeat(26);
  await revokeSavedPaymentMethod(savedPaymentMethodId, 'remove_saved_method_1');

  expect(calls).toHaveLength(1);
  expect(calls[0]?.path).toBe('/payment-methods/' + savedPaymentMethodId);
  expect(calls[0]?.options.method).toBe('DELETE');
  expect(calls[0]?.options.idempotencyKey).toBe('remove_saved_method_1');
});

test('rejects invalid saved payment method IDs and removal keys before transport', () => {
  expect(() => revokeSavedPaymentMethod('spm_short', 'remove_1')).toThrow('ID is invalid');
  expect(() => revokeSavedPaymentMethod('spm_' + 'a'.repeat(26), 'invalid key')).toThrow('idempotency key is invalid');
  expect(calls).toHaveLength(0);
});

test('keeps subscription mutations and mobile checkout disabled until store billing is verified', async () => {
  const api = await import('../lib/subscriptions-api.ts');
  const subscriptionsScreen = readFileSync(new URL('../app/(drawer)/subscriptions.tsx', import.meta.url), 'utf8');
  const plansScreen = readFileSync(new URL('../app/(drawer)/membership-plans.tsx', import.meta.url), 'utf8');
  const drawer = readFileSync(new URL('../app/(drawer)/_layout.tsx', import.meta.url), 'utf8');

  expect(Object.keys(api).sort()).toEqual(['fetchActiveMembershipPlansPage', 'fetchMySubscriptionsPage', 'fetchSavedPaymentMethods', 'revokeSavedPaymentMethod'].sort());
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
});
