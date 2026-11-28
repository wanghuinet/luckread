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

const { fetchNativeFeedPage, getNativeFeedNextPageParam, incrementNativeFeedReplyCount, nativeFeedQueryKey } = await import('../lib/feed-query.ts');

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
    viewerId: 'viewer-a',
  });

  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/feed/following?limit=20&cursor=next+page%2F2');
  expect(calls[0].options.method).toBe('GET');
  expect(calls[0].options.auth).toBe(true);
  expect(calls[0].options.signal).toBe(controller.signal);
  expect(calls[0].options.expectedAccountId).toBe('viewer-a');
});

test('expired Following session remains a request failure while the shared API boundary handles auth invalidation', async () => {
  nextResult = {
    response: { ok: false, status: 401 },
    data: { error: { code: 'UNAUTHORIZED', message: 'Session expired' } },
    error: null,
  };
  await expect(fetchNativeFeedPage({ kind: 'following', cursor: null })).rejects.toThrow('Could not load this timeline');
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
  })).rejects.toThrow('Could not load this timeline');
});

test('native feed pagination continues with a fresh cursor', () => {
  expect(getNativeFeedNextPageParam(
    { hasMore: true, nextCursor: 'cursor-2' },
    [null],
  )).toBe('cursor-2');
});

test('native feed pagination stops when the server repeats the current cursor', () => {
  expect(getNativeFeedNextPageParam(
    { hasMore: true, nextCursor: 'cursor-2' },
    [null, 'cursor-2'],
  )).toBeUndefined();
});

test('native feed pagination stops when the server cycles to an earlier cursor', () => {
  expect(getNativeFeedNextPageParam(
    { hasMore: true, nextCursor: 'cursor-1' },
    [null, 'cursor-1', 'cursor-2', 'cursor-3'],
  )).toBeUndefined();
});

test('native feed pagination ends for missing cursors or terminal pages', () => {
  expect(getNativeFeedNextPageParam(
    { hasMore: true, nextCursor: null },
    [null],
  )).toBeUndefined();
  expect(getNativeFeedNextPageParam(
    { hasMore: false, nextCursor: 'cursor-2' },
    [null],
  )).toBeUndefined();
  expect(getNativeFeedNextPageParam(
    { hasMore: true, nextCursor: '   ' },
    [null],
  )).toBeUndefined();
});

test('cache keys isolate Following data by viewer while keeping public For You data shared', () => {
  expect(nativeFeedQueryKey('for-you')).toEqual(['native-feed', 'for-you', 'anonymous']);
  expect(nativeFeedQueryKey('for-you', 'user-a')).toEqual(['native-feed', 'for-you', 'user-a']);
  expect(nativeFeedQueryKey('for-you', 'user-b')).not.toEqual(nativeFeedQueryKey('for-you', 'user-a'));
  expect(nativeFeedQueryKey('following', 'user-a')).toEqual(['native-feed', 'following', 'user-a']);
  expect(nativeFeedQueryKey('following', 'user-b')).not.toEqual(nativeFeedQueryKey('following', 'user-a'));
});

test('reply submission increments all cached comment-count projections without dropping social viewer state', () => {
  const record = {
    id: 'post-reply',
    replyCount: 2,
    counts: { comments: 2, likes: 5, views: 21 },
    social: {
      viewer: { liked: true },
      counts: { comments: 2, likes: 5 },
    },
  };
  const updated = incrementNativeFeedReplyCount(record, 2);

  expect(updated.replyCount).toBe(3);
  expect(updated.reply_count).toBe(3);
  expect(updated.counts).toEqual({ comments: 3, replies: 3, likes: 5, views: 21 });
  expect(updated.social?.counts).toEqual({ comments: 3, replies: 3, likes: 5 });
  expect(updated.social?.viewer).toEqual({ liked: true });
});
