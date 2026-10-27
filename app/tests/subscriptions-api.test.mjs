import { beforeEach, expect, mock, test } from 'bun:test';

const calls = [];
mock.module('../lib/api-client.ts', () => ({
  apiRequest: async (path, options) => {
    calls.push({ path, options });
    return { response: { ok: true, status: 200 }, data: { data: { docs: [] } }, error: null };
  },
}));

const { fetchMySubscriptionsPage, transitionMySubscription } = await import('../lib/subscriptions-api.ts');

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

test('rejects invalid page bounds before making a request', () => {
  expect(() => fetchMySubscriptionsPage({ page: 0 })).toThrow('between 1 and 10000');
  expect(() => fetchMySubscriptionsPage({ limit: 51 })).toThrow('between 1 and 50');
  expect(calls).toHaveLength(0);
});

test('sends subscription transitions with current ETag, JSON body, and stable idempotency key', async () => {
  const subscription = { subscriptionId: 'sub/id one', etag: '"lr-2026-10-27T10:00:00.000Z"' };
  await transitionMySubscription(subscription, 'cancel');

  expect(calls).toHaveLength(1);
  expect(calls[0]?.path).toBe('/memberships/subscriptions/sub%2Fid%20one/cancel');
  expect(calls[0]?.options.method).toBe('POST');
  expect(calls[0]?.options.body).toBe('{}');
  expect(calls[0]?.options.headers).toEqual({ 'If-Match': subscription.etag });
  expect(calls[0]?.options.idempotencyKey).toEqual(expect.any(String));
  expect(String(calls[0]?.options.idempotencyKey).length).toBeLessThanOrEqual(256);
});

test('supports pause and resume through the same authoritative transition contract', async () => {
  const subscription = { subscriptionId: 'sub_existing', etag: '"lr-version-1"' };
  await transitionMySubscription(subscription, 'pause');
  await transitionMySubscription(subscription, 'resume');

  expect(calls.map((call) => call.path)).toEqual([
    '/memberships/subscriptions/sub_existing/pause',
    '/memberships/subscriptions/sub_existing/resume',
  ]);
  expect(calls.every((call) => call.options.method === 'POST')).toBe(true);
});

test('rejects missing subscription identity or version before requesting a mutation', () => {
  expect(() => transitionMySubscription({ subscriptionId: ' ', etag: '"lr-1"' }, 'cancel')).toThrow(
    'subscription ID is required',
  );
  expect(() => transitionMySubscription({ subscriptionId: 'sub_1', etag: '*' }, 'cancel')).toThrow(
    'current subscription version is required',
  );
  expect(calls).toHaveLength(0);
});
