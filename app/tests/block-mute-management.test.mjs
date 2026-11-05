import { readFileSync } from 'node:fs';
import { beforeEach, expect, mock, test } from 'bun:test';
import { resolve } from 'node:path';

const calls = [];
mock.module('../lib/api-client.ts', () => ({
  apiRequest: async (path, options) => {
    calls.push({ path, options });
    return {
      response: { ok: true, status: 200 },
      data: { data: { items: [], nextCursor: null, hasMore: false } },
      error: null,
    };
  },
}));

const { fetchManagedRelationshipsPage } = await import('../lib/block-mute-management-api.ts');
const screenSource = readFileSync(resolve(process.cwd(), 'app/(drawer)/blocked-muted.tsx'), 'utf8');
const drawerSource = readFileSync(resolve(process.cwd(), 'app/(drawer)/_layout.tsx'), 'utf8');

beforeEach(() => calls.splice(0, calls.length));

test('loads the canonical block list with pagination', async () => {
  const controller = new AbortController();
  await fetchManagedRelationshipsPage('blocks', { cursor: 'block-next', signal: controller.signal });

  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/interactions/blocks?limit=20&cursor=block-next');
  expect(calls[0].options.method).toBe('GET');
  expect(calls[0].options.signal).toBe(controller.signal);
});

test('loads the canonical mute list and honors a valid page size', async () => {
  await fetchManagedRelationshipsPage('mutes', { limit: 50 });

  expect(calls[0].path).toBe('/interactions/mutes?limit=50');
  expect(calls[0].options.method).toBe('GET');
});

test('rejects invalid list types, limits, and cursors without network calls', () => {
  expect(() => fetchManagedRelationshipsPage('follows')).toThrow('valid relationship list type');
  expect(() => fetchManagedRelationshipsPage('blocks', { limit: 51 })).toThrow('between 1 and 50');
  expect(() => fetchManagedRelationshipsPage('mutes', { cursor: 'x'.repeat(2049) })).toThrow('cursor is too long');
  expect(calls).toHaveLength(0);
});

test('management screen wires existing list and remove APIs with confirmation', () => {
  expect(screenSource).toContain("fetchManagedRelationshipsPage(kind,");
  expect(screenSource).toContain("isBlock ? await unblockUser(targetId) : await unmuteUser(targetId)");
  expect(screenSource).toContain("if (!result.response.ok)");
  expect(screenSource).toContain("setRows((current) => current.filter((item) => item.relation.targetUserId !== targetId))");
  expect(screenSource).toContain("Alert.alert(");
  expect(screenSource).toContain("'blocks' as const");
  expect(screenSource).toContain("'mutes' as const");
  expect(drawerSource).toContain('label="屏蔽和静音"');
  expect(drawerSource).toContain('name="blocked-muted"');
  expect(drawerSource).toContain("router.push('/blocked-muted' as never)");
});

test('isolates relationship lists and pending mutations when the signed-in account changes', () => {
  expect(screenSource).toContain("const accountId = useAuthStore((state) => state.user?.id ?? null)");
  expect(screenSource).toContain("const visibleRows = accountDataReady ? rows : []");
  expect(screenSource).toContain("loadedAccountIdRef.current = null");
  expect(screenSource).toContain("accountIdRef.current !== accountId");
  expect(screenSource).toContain("[accountId, loadPage]");
  expect(screenSource).toContain("accountIdRef.current === operationAccountId");
  expect(screenSource).toContain("if (accountIdRef.current !== operationAccountId) return");
  expect(screenSource).toContain("setLoadingMore(false)");
  expect(screenSource).toContain("setRefreshing(false)");
});

test('isolates stale reads and confirmation callbacks after same-account reauthentication', () => {
  expect(screenSource).toContain("const authUser = useAuthStore((state) => state.user)");
  expect(screenSource).toContain('authUserRef.current !== authUser');
  expect(screenSource).toContain('authUserRef.current === authUser');
  expect(screenSource).toContain('const operationUser = authUser');
  expect(screenSource).toContain('authUserRef.current !== operationUser');
  expect(screenSource).toContain('[accountId, authStatus, authUser, kind, router]');
});

test('returns to the intended settings route when a block or mute read expires', () => {
  expect(screenSource).toContain("router.replace(('/login?returnTo=' + encodeURIComponent('/blocked-muted')) as never)");
  expect(screenSource).toContain('accessibilityRole="alert"');
});

test('prevents duplicate pagination requests and keeps the list server-authoritative', () => {
  expect(screenSource).toContain('if (append && requestRef.current) return');
  expect(screenSource).toContain("fetchManagedRelationshipsPage(kind,");
  expect(screenSource).toContain("if (!result.response.ok)");
  expect(screenSource).toContain("setCursor(page.nextCursor || null)");
  expect(screenSource).toContain("setHasMore(page.hasMore)");
});
