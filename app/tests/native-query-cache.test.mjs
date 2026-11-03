import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const client = read('../lib/query-client.ts');
const provider = read('../lib/query-provider.tsx');
const root = read('../app/_layout.tsx');
const feed = read('../app/(drawer)/(tabs)/(index)/index.tsx');
const packageJson = JSON.parse(read('../package.json'));

test('TanStack Query cache uses bounded stale and garbage-collection windows with reconnect and focus refetch', () => {
  expect(client).toContain('staleTime: 30_000');
  expect(client).toContain('gcTime: 5 * 60_000');
  expect(client).toContain('refetchOnWindowFocus: true');
  expect(client).toContain('refetchOnReconnect: true');
  expect(client).toContain('retry: false');
});

test('React Native lifecycle binds app focus and Expo network connectivity to TanStack Query', () => {
  expect(provider).toContain("from '@tanstack/react-query'");
  expect(provider).toContain("from 'expo-network'");
  expect(provider).toContain("AppState.addEventListener('change'");
  expect(provider).toContain('focusManager.setFocused');
  expect(provider).toContain('Network.addNetworkStateListener');
  expect(provider).toContain('onlineManager.setEventListener');
});

test('viewer changes remove cached Following pages to prevent account-to-account timeline leakage', () => {
  expect(provider).toContain("queryClient.removeQueries({ queryKey: ['native-feed', 'following'] })");
  expect(feed).toContain("nativeFeedQueryKey(kind, viewerId)");
  expect(feed).toContain("enabled: kind === 'for-you' || (authStatus === 'authenticated' && Boolean(viewerId))");
});

test('home timeline uses cursor-based infinite queries, cached refetch and page-level invalidation', () => {
  expect(feed).toContain('useInfiniteQuery({');
  expect(feed).toContain('fetchNativeFeedPage({');
  expect(feed).toContain('getNextPageParam:');
  expect(feed).toContain('queryClient.invalidateQueries({ queryKey })');
  expect(feed).toContain('queryClient.setQueryData<InfiniteData<NativeFeedPage, string | null>>');
  expect(feed).toContain('feedQuery.fetchNextPage');
  expect(feed).toContain('refreshing={feedQuery.isRefetching}');
  expect(feed).not.toContain('const [cursor, setCursor]');
  expect(feed).not.toContain('const [loadingMore, setLoadingMore]');
});

test('TanStack Query and Expo Network are normal app runtime dependencies', () => {
  expect(packageJson.dependencies['@tanstack/react-query']).toBe('5.105.3');
  expect(packageJson.dependencies['expo-network']).toBe('~58.0.4');
});
