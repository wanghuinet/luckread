import { beforeEach, expect, mock, test } from 'bun:test';

const calls = [];
mock.module('../lib/api-client.ts', () => ({
  apiRequest: async (path, options) => {
    calls.push({ path, options });
    return { response: { ok: true, status: 200 }, data: { data: {} }, error: null };
  },
}));
const api = await import('../lib/creator-studio-api.ts');
beforeEach(() => { calls.length = 0; });

test('reads own creator application and own membership plans through W01', async () => {
  await api.fetchMyCreatorApplication({ expectedAccountId: 'viewer_a' });
  await api.fetchMyCreatorPlans({ limit: 25, cursor: 'opaque/cursor', expectedAccountId: 'viewer_a' });
  expect(calls[0].path).toBe('/creator-applications');
  expect(calls[0].options.method).toBe('GET');
  expect(calls[0].options.expectedAccountId).toBe('viewer_a');
  expect(calls[1].path).toBe('/membership/plans?limit=25&cursor=opaque%2Fcursor');
  expect(calls[1].options.method).toBe('GET');
  expect(calls[1].options.expectedAccountId).toBe('viewer_a');
});

test('submits an idempotent creator application without caller-supplied identity', async () => {
  await api.submitCreatorApplication('WRITER', 'I write essays.', 'creator_apply_001', 'viewer_a');
  expect(calls[0].path).toBe('/creator-applications');
  expect(calls[0].options.idempotencyKey).toBe('creator_apply_001');
  expect(calls[0].options.expectedAccountId).toBe('viewer_a');
  expect(JSON.parse(calls[0].options.body)).toEqual({ creatorType: 'WRITER', statement: 'I write essays.' });
});

test('creates, updates, publishes, pauses and resumes plans using server versions', async () => {
  const id = 'plan_' + 'a'.repeat(64);
  const terms = { name: 'Supporter', tier: 'supporter', billingInterval: 'MONTHLY', priceMinor: 900, currency: 'USD', benefits: ['Member posts'] };
  await api.createMyCreatorPlan(terms, 'create_001', 'viewer_a');
  await api.updateMyCreatorPlan(id, '"lr-plan-v1"', terms, 'update_001', 'viewer_a');
  await api.publishMyCreatorPlan(id, '"lr-plan-v1"', 'viewer_a');
  await api.changeMyCreatorPlanLifecycle(id, '"lr-plan-v2"', 'pause', 'viewer_a');
  await api.changeMyCreatorPlanLifecycle(id, '"lr-plan-v3"', 'resume', 'viewer_a');
  expect(calls.map(x => x.path)).toEqual([
    '/membership/plans',
    '/membership/plans/' + id,
    '/membership/plans/' + id + '/publish',
    '/membership/plans/' + id + '/lifecycle',
    '/membership/plans/' + id + '/lifecycle',
  ]);
  expect(JSON.parse(calls[0].options.body)).toMatchObject({ ...terms, trialPeriodDays: 0 });
  expect(calls.every(call => call.options.expectedAccountId === 'viewer_a')).toBe(true);
  expect(calls[1].options.headers).toEqual({ 'If-Match': '"lr-plan-v1"' });
  expect(calls[2].options.headers).toEqual({ 'If-Match': '"lr-plan-v1"' });
  expect(JSON.parse(calls[3].options.body)).toEqual({ action: 'pause' });
  expect(JSON.parse(calls[4].options.body)).toEqual({ action: 'resume' });
});

test('rejects malformed terms, ids, ETags and idempotency keys before transport', () => {
  const id = 'plan_' + 'a'.repeat(64);
  expect(() => api.submitCreatorApplication('UNKNOWN', '', 'key_1')).toThrow('Creator type is invalid');
  expect(() => api.submitCreatorApplication('WRITER', ' padded ', 'key_1')).toThrow('statement is invalid');
  expect(() => api.createMyCreatorPlan({ name: '', tier: 'Bad Tier', billingInterval: 'MONTHLY', priceMinor: -1, currency: 'USD', benefits: [] }, 'key_1')).toThrow('terms are invalid');
  expect(() => api.publishMyCreatorPlan(id, 'bad-etag')).toThrow('ETag is required');
  expect(() => api.updateMyCreatorPlan('bad-id', '"lr-plan-v1"', { name: 'X', tier: 'x', billingInterval: 'MONTHLY', priceMinor: 0, currency: 'USD', benefits: [] }, 'key_1')).toThrow('ID is invalid');
  expect(calls).toHaveLength(0);
});

test('drawer opens the native creator studio instead of showing an unavailable placeholder', async () => {
  const { readFileSync } = await import('node:fs');
  const drawer = readFileSync(new URL('../app/(drawer)/_layout.tsx', import.meta.url), 'utf8');
  const screen = readFileSync(new URL('../app/(drawer)/creator-studio.tsx', import.meta.url), 'utf8');
  expect(drawer).toContain("router.push('/creator-studio' as never)");
  expect(drawer).not.toContain("showUnavailable('创作者工作室')");
  expect(screen).toContain('fetchMyCreatorApplication');
  expect(screen).toContain('createMyCreatorPlan');
  expect(screen).toContain('publishMyCreatorPlan');
  expect(screen).toContain('changeMyCreatorPlanLifecycle');
});
