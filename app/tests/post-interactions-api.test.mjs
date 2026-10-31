import { beforeEach, expect, mock, test } from 'bun:test';

const calls = [];
let respond = async (path) => ({
  response: { ok: true, status: 200 },
  data: { data: { items: [], nextCursor: null, hasMore: false } },
  error: null,
});
mock.module('../lib/api-client.ts', () => ({
  apiRequest: async (path, options) => {
    calls.push({ path, options });
    return respond(path, options);
  },
  getApiErrorMessage: (data, fallback) => data?.error?.message || fallback,
}));

const {
  fetchContentLikesPage,
  fetchPostInteractionSummary,
} = await import('../lib/post-interactions-api.ts');

beforeEach(() => {
  calls.length = 0;
  respond = async () => ({
    response: { ok: true, status: 200 },
    data: { data: { items: [], nextCursor: null, hasMore: false } },
    error: null,
  });
});

test('reads the existing W01 likes endpoint and forwards cursor pagination', async () => {
  respond = async () => ({
    response: { ok: true, status: 200 },
    data: {
      data: {
        items: [
          { userId: 'user-1', likedAt: '2026-10-20T10:00:00.000Z' },
          { userId: '', likedAt: 'invalid-item' },
        ],
        nextCursor: 'cursor-page-2',
        hasMore: true,
      },
    },
    error: null,
  });

  const page = await fetchContentLikesPage('content/with space', { cursor: 'next/2' });

  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/contents/content%2Fwith%20space/likes?limit=20&cursor=next%2F2');
  expect(calls[0].options.method).toBe('GET');
  expect(page).toEqual({
    items: [{ userId: 'user-1', likedAt: '2026-10-20T10:00:00.000Z' }],
    nextCursor: 'cursor-page-2',
    hasMore: true,
  });
});

test('rejects a missing content ID before making a request', async () => {
  await expect(fetchContentLikesPage('   ')).rejects.toThrow('A valid content ID is required.');
  expect(calls).toHaveLength(0);
});

test('surfaces the API failure rather than returning an empty likes list', async () => {
  respond = async () => ({
    response: { ok: false, status: 403 },
    data: { error: { message: 'Likes are not available for this post.' } },
    error: { message: 'Likes are not available for this post.' },
  });

  await expect(fetchContentLikesPage('content-1')).rejects.toThrow('Likes are not available for this post.');
});

test('combines only authoritative counts returned by content and social APIs', async () => {
  respond = async (path) => {
    if (path === '/contents/post-1') {
      return {
        response: { ok: true, status: 200 },
        data: {
          data: {
            id: 'post-1',
            counts: { likes: 2, views: '8' },
          },
        },
        error: null,
      };
    }
    if (path === '/contents/post-1/social') {
      return {
        response: { ok: true, status: 200 },
        data: {
          data: {
            counts: { likes: 3, reposts: 1, replies: 5 },
          },
        },
        error: null,
      };
    }
    throw new Error('Unexpected request: ' + path);
  };

  const summary = await fetchPostInteractionSummary('post-1');

  expect(calls.map((call) => call.path)).toEqual([
    '/contents/post-1',
    '/contents/post-1/social',
  ]);
  expect(summary).toEqual({
    likeCount: 3,
    repostCount: 1,
    replyCount: 5,
    viewCount: 8,
  });
});

test('does not invent zero interaction counts when the API omits them', async () => {
  respond = async () => ({
    response: { ok: true, status: 200 },
    data: { data: { id: 'post-2', title: 'No count fields' } },
    error: null,
  });

  await expect(fetchPostInteractionSummary('post-2')).resolves.toEqual({});
});

test('rejects a response for a different content ID', async () => {
  respond = async () => ({
    response: { ok: true, status: 200 },
    data: { data: { id: 'wrong-post' } },
    error: null,
  });

  await expect(fetchPostInteractionSummary('post-3')).rejects.toThrow(
    'The content service did not return the requested post.',
  );
});

test('normalizes malformed and fractional counts consistently before falling back to alternate fields', async () => {
  respond = async (path) => {
    if (path === '/contents/post-counts') {
      return {
        response: { ok: true, status: 200 },
        data: {
          data: {
            id: 'post-counts',
            counts: {
              likes: '-1',
              reposts: '4.9',
              replies: 'invalid',
              views: '-3',
            },
            likeCount: 7,
            comments: '5',
            view_count: '8.2',
          },
        },
        error: null,
      };
    }
    throw new Error('Unexpected request: ' + path);
  };

  await expect(fetchPostInteractionSummary('post-counts')).resolves.toEqual({
    likeCount: 7,
    repostCount: 4,
    replyCount: 5,
    viewCount: 8,
  });
});
