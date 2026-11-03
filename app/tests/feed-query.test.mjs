import { beforeEach, expect, mock, test } from 'bun:test';

const calls = [];
let nextResult;

mock.module('../lib/api-client.ts', () => ({
  apiRequest: async (path, options) => {
    calls.push({ path, options });
    return nextResult;
  },
  getApiErrorMessage: (_data, fallback) => fallback,
}));

const { fetchNativeFeedPage, nativeFeedQueryKey } = await import('../lib/feed-query.ts');

beforeEach(() => {
  calls.length = 0;
  nextResult = {
    response: { ok: true, status: 200 },
    data: {
      data: {
        items: [{ id: 'post-1' }, { id: '' }, null, { id: 'post-2' }],
        nextCursor: 'cursor-2',
        hasMore: true,
      },
    },
    error: null,
  };
});

test('For You feed uses the public canonical W01 contents endpoint and filters malformed IDs', async () => {
  const result = await fetchNativeFeedPage({
    kind: 'for-you',
    cursor: null,
    invalidateSession: async () => { throw new Error('public feed must not invalidate auth'); },
  });

  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/contents?limit=20&type=post');
  expect(calls[0].options.method).toBe('GET');
  expect(calls[0].options.auth).toBe(false);
  expect(result.items.map((item) => item.id)).toEqual(['post-1', 'post-2']);
  expect(result.nextCursor).toBe('cursor-2');
  expect(result.hasMore).toBe(true);
});

test('Following feed uses the authenticated canonical route and preserves its cursor and abort signal', async () => {
  const controller = new AbortController();
  await fetchNativeFeedPage({
    kind: 'following',
    cursor: 'next page/2',
    signal: controller.signal,
    invalidateSession: async () => undefined,
  });

  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/feed/following?limit=20&cursor=next+page%2F2');
  expect(calls[0].options.method).toBe('GET');
  expect(calls[0].options.auth).toBe(true);
  expect(calls[0].options.signal).toBe(controller.signal);
});

test('expired Following session is invalidated and returns an empty, non-paginated page', async () => {
  nextResult = {
    response: { ok: false, status: 401 },
    data: { error: { code: 'UNAUTHORIZED', message: 'Session expired' } },
    error: null,
  };
  let invalidated = 0;
  const result = await fetchNativeFeedPage({
    kind: 'following',
    cursor: null,
    invalidateSession: async () => { invalidated += 1; },
  });

  expect(invalidated).toBe(1);
  expect(result).toEqual({ items: [], nextCursor: null, hasMore: false });
});

test('invalid server page fails without returning a fake empty timeline', async () => {
  nextResult = {
    response: { ok: true, status: 200 },
    data: { data: { items: null } },
    error: null,
  };
  await expect(fetchNativeFeedPage({
    kind: 'for-you',
    cursor: null,
    invalidateSession: async () => undefined,
  })).rejects.toThrow('Could not load this timeline');
});

test('cache keys isolate Following data by viewer while keeping public For You data shared', () => {
  expect(nativeFeedQueryKey('for-you')).toEqual(['native-feed', 'for-you']);
  expect(nativeFeedQueryKey('following', 'user-a')).toEqual(['native-feed', 'following', 'user-a']);
  expect(nativeFeedQueryKey('following', 'user-b')).not.toEqual(nativeFeedQueryKey('following', 'user-a'));
});
