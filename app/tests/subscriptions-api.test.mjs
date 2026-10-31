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
  createMembershipOrder,
  createMembershipPaymentIntent,
  fetchActiveMembershipPlansPage,
  fetchMySubscriptionsPage,
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

test('creates a server-priced membership order using only the selected plan reference', async () => {
  const planId = 'plan_' + 'a'.repeat(64);
  await createMembershipOrder(planId);

  expect(calls).toHaveLength(1);
  expect(calls[0]?.path).toBe('/commerce/orders');
  expect(calls[0]?.options.method).toBe('POST');
  expect(JSON.parse(calls[0]?.options.body)).toEqual({
    items: [{ itemRef: planId, quantity: 1 }],
  });
});

test('creates a customer-owned payment intent using only the server-created order ID', async () => {
  await createMembershipPaymentIntent('ord_checkout_001');

  expect(calls).toHaveLength(1);
  expect(calls[0]?.path).toBe('/payments/intents');
  expect(calls[0]?.options.method).toBe('POST');
  expect(JSON.parse(calls[0]?.options.body)).toEqual({ orderId: 'ord_checkout_001' });
});

test('rejects invalid order and plan identifiers before making a mutation', () => {
  expect(() => createMembershipOrder('plan_invalid')).toThrow('valid published membership plan ID');
  expect(() => createMembershipPaymentIntent('ord_invalid/other')).toThrow('valid membership order ID');
  expect(calls).toHaveLength(0);
});

test('rejects invalid pagination bounds before making a request', () => {
  expect(() => fetchMySubscriptionsPage({ page: 0 })).toThrow('between 1 and 10000');
  expect(() => fetchMySubscriptionsPage({ limit: 51 })).toThrow('between 1 and 50');
  expect(() => fetchActiveMembershipPlansPage({ limit: 0 })).toThrow('between 1 and 50');
  expect(() => fetchActiveMembershipPlansPage({ cursor: '' })).toThrow('between 1 and 2048');
  expect(() => fetchActiveMembershipPlansPage({ cursor: 'x'.repeat(2049) })).toThrow('between 1 and 2048');
  expect(calls).toHaveLength(0);
});

test('keeps subscription mutations and mobile checkout disabled until store billing is verified', async () => {
  const api = await import('../lib/subscriptions-api.ts');
  const subscriptionsScreen = readFileSync(new URL('../app/(drawer)/subscriptions.tsx', import.meta.url), 'utf8');
  const plansScreen = readFileSync(new URL('../app/(drawer)/membership-plans.tsx', import.meta.url), 'utf8');
  const drawer = readFileSync(new URL('../app/(drawer)/_layout.tsx', import.meta.url), 'utf8');

  expect(Object.keys(api).sort()).toEqual([
    'createMembershipOrder',
    'createMembershipPaymentIntent',
    'fetchActiveMembershipPlansPage',
    'fetchMySubscriptionsPage',
  ].sort());
  expect(subscriptionsScreen).not.toContain('transitionMySubscription');
  expect(subscriptionsScreen).not.toContain('onTransition');
  expect(subscriptionsScreen).not.toContain('取消订阅');
  expect(subscriptionsScreen).not.toContain('暂停订阅');
  expect(subscriptionsScreen).not.toContain('恢复订阅');
  expect(plansScreen).toContain('fetchActiveMembershipPlansPage');
  expect(plansScreen).toContain('W07 已发布的公开会员目录');
  expect(plansScreen).toContain('createMembershipOrder');
  expect(plansScreen).toContain('createMembershipPaymentIntent');
  expect(plansScreen).toContain('presentNativeMembershipPayment');
  expect(plansScreen).toContain('服务端验证 Hyperswitch 支付 Webhook');
  expect(plansScreen).toContain('item.priceMinor === 0');
  const nativePayment = readFileSync(new URL('../lib/hyperswitch-payment.native.ts', import.meta.url), 'utf8');
  const webPayment = readFileSync(new URL('../lib/hyperswitch-payment.ts', import.meta.url), 'utf8');
  expect(nativePayment).toContain('Hyperswitch.init');
  expect(nativePayment).toContain('initPaymentSession({ sdkAuthorization })');
  expect(nativePayment).toContain('displaySavedPaymentMethodsCheckbox: true');
  expect(nativePayment).toContain('paymentSession.presentPaymentSheet');
  expect(nativePayment).not.toContain('HYPERSWITCH_API_KEY');
  expect(nativePayment).not.toContain('client_secret');
  expect(webPayment).not.toContain('@juspay-tech/react-native-hyperswitch');

  expect(drawer).toContain("router.push('/membership-plans' as never)");
});
