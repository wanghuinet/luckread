import { beforeEach, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const calls = [];
mock.module('../lib/api-client.ts', () => ({
  apiRequest: async (path, options) => {
    calls.push({ path, options });
    return { response: { ok: true, status: 200 }, data: { data: { docs: [] } }, error: null };
  },
}));

const { fetchMySubscriptionsPage } = await import('../lib/subscriptions-api.ts');

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

test('keeps subscription screen read-only until external billing synchronization is implemented', async () => {
  const api = await import('../lib/subscriptions-api.ts');
  const screen = readFileSync(new URL('../app/(drawer)/subscriptions.tsx', import.meta.url), 'utf8');

  expect(Object.keys(api)).toEqual(['fetchMySubscriptionsPage']);
  expect(screen).not.toContain('transitionMySubscription');
  expect(screen).not.toContain('onTransition');
  expect(screen).not.toContain('取消订阅');
  expect(screen).not.toContain('暂停订阅');
  expect(screen).not.toContain('恢复订阅');
});
