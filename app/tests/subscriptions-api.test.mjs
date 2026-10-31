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
  cancelWebMembershipTrial,
  fetchActiveMembershipPlansPage,
  fetchMySubscriptionsPage,
  startWebMembershipTrial,
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

test('starts a server-authoritative web trial through W01 with only the selected plan ID', async () => {
  await startWebMembershipTrial('plan_' + 'a'.repeat(64));
  expect(calls).toHaveLength(1);
  expect(calls[0]?.path).toBe('/memberships/subscriptions/trial');
  expect(calls[0]?.options.method).toBe('POST');
  expect(JSON.parse(calls[0]?.options.body)).toEqual({ planId: 'plan_' + 'a'.repeat(64) });
});

test('cancels only a web trial with the exact subscription ETag', async () => {
  await cancelWebMembershipTrial('sub_' + 'b'.repeat(64), '"lr-v7"');
  expect(calls).toHaveLength(1);
  expect(calls[0]?.path).toBe('/memberships/subscriptions/' + 'sub_' + 'b'.repeat(64) + '/cancel-trial');
  expect(calls[0]?.options.method).toBe('POST');
  expect(calls[0]?.options.headers).toEqual({ 'If-Match': '"lr-v7"' });
  expect(calls[0]?.options.body).toBeUndefined();
});

test('rejects invalid trial identities and stale-version headers before making requests', () => {
  expect(() => startWebMembershipTrial('plan_bad')).toThrow('canonical membership plan ID');
  expect(() => cancelWebMembershipTrial('sub_bad', '"lr-v1"')).toThrow('canonical subscription ID');
  expect(() => cancelWebMembershipTrial('sub_' + 'b'.repeat(64), 'lr-v0')).toThrow('subscription version');
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

test('exposes trial-only app controls while paid checkout remains closed pending store billing verification', async () => {
  const api = await import('../lib/subscriptions-api.ts');
  const subscriptionsScreen = readFileSync(new URL('../app/(drawer)/subscriptions.tsx', import.meta.url), 'utf8');
  const plansScreen = readFileSync(new URL('../app/(drawer)/membership-plans.tsx', import.meta.url), 'utf8');
  const drawer = readFileSync(new URL('../app/(drawer)/_layout.tsx', import.meta.url), 'utf8');

  expect(Object.keys(api).sort()).toEqual([
    'cancelWebMembershipTrial',
    'fetchActiveMembershipPlansPage',
    'fetchMySubscriptionsPage',
    'startWebMembershipTrial',
  ].sort());
  expect(subscriptionsScreen).toContain('TRIALING');
  expect(subscriptionsScreen).toContain('cancelWebMembershipTrial');
  expect(subscriptionsScreen).toContain('trialEndsAt');
  expect(subscriptionsScreen).toContain("item.trial.source === 'WEB'");
  expect(subscriptionsScreen).toContain("'APP_STORE', 'PLAY_STORE'");
  expect(subscriptionsScreen).not.toContain('transitionMySubscription');
  expect(subscriptionsScreen).not.toContain('暂停订阅');
  expect(subscriptionsScreen).not.toContain('恢复订阅');
  expect(plansScreen).toContain('trialDays');
  expect(plansScreen).toContain('startWebMembershipTrial');
  expect(plansScreen).toContain('开始 {item.trialDays} 天网页试用');
  expect(plansScreen).toContain('有效的 Hyperswitch 自动续费授权');
  expect(plansScreen).not.toContain('createCommerceOrder');
  expect(plansScreen).not.toContain('confirmPayment');
  expect(drawer).toContain("router.push('/membership-plans' as never)");
});
