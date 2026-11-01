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
  createSubscriptionPlanUpgradeCheckout,
  fetchActiveMembershipPlansPage,
  fetchMySubscription,
  fetchMySubscriptionsPage,
  fetchSavedPaymentMethods,
  fetchSubscriptionPlanChangePreview,
  revokeSavedPaymentMethod,
  scheduleSubscriptionBillingIntervalChange,
  scheduleSubscriptionPlanDowngrade,
} = await import('../lib/subscriptions-api.ts');

beforeEach(() => {
  calls.length = 0;
});

test('pins the Android Kotlin compiler to the Hyperswitch SDK metadata version', () => {
  const appConfig = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const buildProperties = appConfig.expo.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties',
  );

  expect(packageJson.dependencies['expo-build-properties']).toBe('~0.13.3');
  expect(buildProperties?.[1]?.android).toMatchObject({
    buildToolsVersion: '36.0.0',
    compileSdkVersion: 36,
    targetSdkVersion: 36,
    kotlinVersion: '2.1.20',
  });
});

test('loads the signed-in subscriber list through the canonical W01 route', async () => {
  const controller = new AbortController();
  await fetchMySubscriptionsPage({ page: 2, limit: 15, signal: controller.signal });

  expect(calls).toHaveLength(1);
  expect(calls[0]?.path).toBe('/memberships/subscriptions?limit=15&page=2');
  expect(calls[0]?.options.method).toBe('GET');
  expect(calls[0]?.options.signal).toBe(controller.signal);
});

test('loads a single subscriber-owned subscription through the canonical W01 route', async () => {
  await fetchMySubscription('sub_' + 'a'.repeat(64));

  expect(calls).toHaveLength(1);
  expect(calls[0]?.path).toBe('/memberships/subscriptions/sub_' + 'a'.repeat(64));
  expect(calls[0]?.options.method).toBe('GET');
});

test('loads the W07 plan-change preview without mutating subscription state', async () => {
  const subscriptionId = 'sub_' + 'a'.repeat(64);
  const planId = 'plan_' + 'b'.repeat(64);
  const controller = new AbortController();
  await fetchSubscriptionPlanChangePreview(subscriptionId, planId, { signal: controller.signal });

  expect(calls).toHaveLength(1);
  expect(calls[0]?.path).toBe('/memberships/subscriptions/' + subscriptionId +
    '/change-plan-preview?targetPlanId=' + planId);
  expect(calls[0]?.options.method).toBe('GET');
  expect(calls[0]?.options.signal).toBe(controller.signal);
});

test('starts an upgrade checkout using W07 quote ETag and an idempotency key', async () => {
  const subscriptionId = 'sub_' + 'a'.repeat(64);
  const planId = 'plan_' + 'b'.repeat(64);
  const etag = '"lr-v7"';
  await createSubscriptionPlanUpgradeCheckout(subscriptionId, planId, etag, 'upgrade_attempt_1');

  expect(calls).toHaveLength(1);
  expect(calls[0]?.path).toBe('/memberships/subscriptions/' + subscriptionId + '/change-plan/checkout');
  expect(calls[0]?.options.method).toBe('POST');
  expect(calls[0]?.options.headers).toEqual({ 'If-Match': etag });
  expect(calls[0]?.options.idempotencyKey).toBe('upgrade_attempt_1');
  expect(JSON.parse(calls[0]?.options.body)).toEqual({ planId });
});

test('schedules a downgrade at the end of the current subscription period', async () => {
  const subscriptionId = 'sub_' + 'a'.repeat(64);
  const planId = 'plan_' + 'b'.repeat(64);
  const etag = '"lr-v2"';
  await scheduleSubscriptionPlanDowngrade(subscriptionId, planId, etag, 'downgrade_attempt_1');

  expect(calls).toHaveLength(1);
  expect(calls[0]?.path).toBe('/memberships/subscriptions/' + subscriptionId + '/change-plan/schedule');
  expect(calls[0]?.options.method).toBe('POST');
  expect(calls[0]?.options.headers).toEqual({ 'If-Match': etag });
  expect(calls[0]?.options.idempotencyKey).toBe('downgrade_attempt_1');
  expect(JSON.parse(calls[0]?.options.body)).toEqual({ planId });
});

test('schedules a billing interval change through the existing W07 operation', async () => {
  const subscriptionId = 'sub_' + 'a'.repeat(64);
  const planId = 'plan_' + 'b'.repeat(64);
  const etag = '"lr-v4"';
  await scheduleSubscriptionBillingIntervalChange(subscriptionId, planId, etag, 'interval_attempt_1');

  expect(calls).toHaveLength(1);
  expect(calls[0]?.path).toBe('/memberships/subscriptions/' + subscriptionId + '/change-plan/interval-schedule');
  expect(calls[0]?.options.method).toBe('POST');
  expect(calls[0]?.options.headers).toEqual({ 'If-Match': etag });
  expect(calls[0]?.options.idempotencyKey).toBe('interval_attempt_1');
  expect(JSON.parse(calls[0]?.options.body)).toEqual({ planId });
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
  expect(() => fetchMySubscription('invalid_subscription')).toThrow('valid subscription ID');
  expect(() => fetchSubscriptionPlanChangePreview('invalid_sub_id', 'plan_invalid')).toThrow('valid subscription ID');
  expect(() => createSubscriptionPlanUpgradeCheckout('sub_' + 'a'.repeat(64), 'plan_invalid', '"lr-v1"', 'key_1'))
    .toThrow('valid published membership plan ID');
  expect(() => scheduleSubscriptionPlanDowngrade('sub_' + 'a'.repeat(64), 'plan_' + 'b'.repeat(64), 'bad-etag', 'key_1'))
    .toThrow('current subscription ETag');
  expect(() => scheduleSubscriptionBillingIntervalChange('sub_' + 'a'.repeat(64), 'plan_' + 'b'.repeat(64), '"lr-v1"', 'invalid key'))
    .toThrow('idempotency key');
  expect(calls).toHaveLength(0);
});

test('loads saved payment methods using the payment-method collection endpoint', async () => {
  await fetchSavedPaymentMethods();
  expect(calls).toHaveLength(1);
  expect(calls[0]?.path).toBe('/payments/methods');
  expect(calls[0]?.options.method).toBe('GET');
});

test('revokes a saved payment method through the dedicated payment-method resource', async () => {
  await revokeSavedPaymentMethod('pm_' + 'a'.repeat(26), 'revoke_attempt_1');
  expect(calls).toHaveLength(1);
  expect(calls[0]?.path).toBe('/payments/methods/' + 'pm_' + 'a'.repeat(26) + '/revoke');
  expect(calls[0]?.options.method).toBe('POST');
  expect(calls[0]?.options.idempotencyKey).toBe('revoke_attempt_1');
});

test('rejects invalid payment-method IDs and revocation keys before transport', () => {
  expect(() => revokeSavedPaymentMethod('pm_invalid', 'key_1')).toThrow('valid saved payment method ID');
  expect(() => revokeSavedPaymentMethod('pm_' + 'a'.repeat(26), 'invalid key')).toThrow('idempotency key');
  expect(calls).toHaveLength(0);
});

test('connects supported plan changes and keeps unverified subscription lifecycle actions gated', async () => {
  const api = await import('../lib/subscriptions-api.ts');
  const subscriptionsScreen = readFileSync(new URL('../app/(drawer)/subscriptions.tsx', import.meta.url), 'utf8');
  const planChangeScreen = readFileSync(new URL('../app/(drawer)/subscription-change.tsx', import.meta.url), 'utf8');
  const plansScreen = readFileSync(new URL('../app/(drawer)/membership-plans.tsx', import.meta.url), 'utf8');
  const drawer = readFileSync(new URL('../app/(drawer)/_layout.tsx', import.meta.url), 'utf8');

  expect(Object.keys(api).sort()).toEqual([
    'createMembershipOrder',
    'createMembershipPaymentIntent',
    'createSubscriptionPlanUpgradeCheckout',
    'fetchActiveMembershipPlansPage',
    'fetchMySubscription',
    'fetchMySubscriptionsPage',
    'fetchSavedPaymentMethods',
    'fetchSubscriptionPlanChangePreview',
    'revokeSavedPaymentMethod',
    'scheduleSubscriptionBillingIntervalChange',
    'scheduleSubscriptionPlanDowngrade',
  ].sort());
  expect(subscriptionsScreen).not.toContain('transitionMySubscription');
  expect(subscriptionsScreen).not.toContain('onTransition');
  expect(subscriptionsScreen).not.toContain('取消订阅');
  expect(subscriptionsScreen).not.toContain('暂停订阅');
  expect(subscriptionsScreen).not.toContain('恢复订阅');
  expect(subscriptionsScreen).toContain('管理套餐');
  expect(subscriptionsScreen).toContain('/subscription-change?subscriptionId=');
  expect(planChangeScreen).toContain('fetchSubscriptionPlanChangePreview');
  expect(planChangeScreen).toContain('createSubscriptionPlanUpgradeCheckout');
  expect(planChangeScreen).toContain('scheduleSubscriptionPlanDowngrade');
  expect(planChangeScreen).toContain('scheduleSubscriptionBillingIntervalChange');
  expect(planChangeScreen).toContain('presentNativeMembershipPayment');
  expect(planChangeScreen).toContain('签名 Webhook');
  expect(planChangeScreen).not.toContain("transition(item, 'cancel')");
  expect(planChangeScreen).not.toContain("transition(item, 'pause')");
  expect(planChangeScreen).not.toContain("transition(item, 'resume')");
  expect(drawer).toContain('subscription-change');
  expect(plansScreen).toContain('fetchActiveMembershipPlansPage');
  expect(plansScreen).toContain('W07 已发布的公开会员目录');
});
