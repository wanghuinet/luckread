import { beforeEach, expect, mock, test } from 'bun:test';

let activeViewerId = 'viewer-a';
const calls = [];
const serverReposts = new Map();
const serverBookmarks = new Map();
let failNextRepostAfterCommit = false;
let failNextBookmarkAfterCommit = false;
let returnNextRepost503AfterCommit = false;

mock.module('../store/auth-store.ts', () => ({
  useAuthStore: {
    getState: () => ({
      status: activeViewerId ? 'authenticated' : 'anonymous',
      user: activeViewerId ? { id: activeViewerId } : null,
    }),
  },
}));

mock.module('../lib/api-client.ts', () => ({
  createIdempotencyKey: () => 'repost-bookmark-reconcile-test-key',
  apiRequest: async (path, options = {}) => {
    calls.push({ path, options });
    const method = String(options.method || 'GET').toUpperCase();

    if (path.startsWith('/contents/') && path.endsWith('/social') && method === 'GET') {
      const contentId = decodeURIComponent(path.slice('/contents/'.length, -'/social'.length));
      const reposted = serverReposts.get(activeViewerId + ':' + contentId) ?? false;
      return {
        response: { ok: true, status: 200 },
        data: { data: { counts: { reposts: reposted ? 9 : 8 }, viewer: { reposted } } },
        error: null,
      };
    }

    if (path.startsWith('/content/') && path.endsWith('/reposts') && method !== 'GET') {
      const contentId = decodeURIComponent(path.slice('/content/'.length, -'/reposts'.length));
      serverReposts.set(activeViewerId + ':' + contentId, method === 'POST');
      if (failNextRepostAfterCommit) {
        failNextRepostAfterCommit = false;
        throw new TypeError('repost response was lost after server commit');
      }
      if (returnNextRepost503AfterCommit) {
        returnNextRepost503AfterCommit = false;
        return {
          response: { ok: false, status: 503 },
          data: { error: { message: 'repost service temporarily unavailable' } },
          error: { message: 'repost service temporarily unavailable' },
        };
      }
      return { response: { ok: true, status: 204 }, data: null, error: null };
    }

    if (path.startsWith('/interactions/bookmarks?') && method === 'GET') {
      const query = new URLSearchParams(path.split('?')[1] || '');
      const contentId = query.get('targetId');
      const bookmarked = serverBookmarks.get(activeViewerId + ':' + contentId) ?? false;
      return {
        response: { ok: true, status: 200 },
        data: { data: { favorited: bookmarked } },
        error: null,
      };
    }

    if (path === '/interactions/bookmarks' && method !== 'GET') {
      const body = JSON.parse(options.body || '{}');
      const key = activeViewerId + ':' + body.targetId;
      serverBookmarks.set(key, method === 'POST');
      if (failNextBookmarkAfterCommit) {
        failNextBookmarkAfterCommit = false;
        throw new TypeError('bookmark response was lost after server commit');
      }
      return { response: { ok: true, status: 204 }, data: null, error: null };
    }

    throw new Error('Unexpected API request: ' + method + ' ' + path);
  },
}));

const {
  getContentRepostSnapshot,
  refreshContentRepostStatus,
  toggleContentRepost,
} = await import('../lib/content-repost-state.ts');

const {
  getContentBookmarkSnapshot,
  refreshContentBookmarkStatus,
  toggleContentBookmark,
} = await import('../lib/content-bookmark-state.ts');

beforeEach(() => {
  activeViewerId = 'viewer-a';
  calls.length = 0;
  serverReposts.clear();
  serverBookmarks.clear();
  failNextRepostAfterCommit = false;
  failNextBookmarkAfterCommit = false;
  returnNextRepost503AfterCommit = false;
});

test('repost mutation re-reads W05 state when the write commits but its response is lost', async () => {
  const contentId = 'repost-response-lost-after-commit';
  serverReposts.set('viewer-a:' + contentId, false);
  await refreshContentRepostStatus(contentId, 'viewer-a');
  failNextRepostAfterCommit = true;

  await expect(toggleContentRepost(contentId, 'viewer-a')).resolves.toMatchObject({
    ok: false,
    message: 'repost response was lost after server commit',
  });

  expect(calls.filter((call) => call.path.includes('/reposts') || call.path.endsWith('/social'))
    .map((call) => call.options.method || 'GET')).toEqual(['GET', 'POST', 'GET']);
  expect(getContentRepostSnapshot(contentId, 'viewer-a')).toMatchObject({
    reposted: true,
    repostCount: 9,
    loaded: true,
    loading: false,
    pending: false,
    error: null,
  });
  expect(calls.every((call) => call.options.expectedAccountId === 'viewer-a')).toBe(true);
});

test('repost mutation re-reads W05 state after an ambiguous 5xx response', async () => {
  const contentId = 'repost-503-after-commit';
  serverReposts.set('viewer-a:' + contentId, false);
  await refreshContentRepostStatus(contentId, 'viewer-a');
  returnNextRepost503AfterCommit = true;

  await expect(toggleContentRepost(contentId, 'viewer-a')).resolves.toMatchObject({
    ok: false,
    status: 503,
  });

  expect(calls.filter((call) => call.path.endsWith('/social') || call.path.includes('/reposts'))
    .map((call) => call.options.method || 'GET')).toEqual(['GET', 'POST', 'GET']);
  expect(getContentRepostSnapshot(contentId, 'viewer-a')).toMatchObject({
    reposted: true,
    loaded: true,
    loading: false,
    pending: false,
    error: null,
  });
});

test('bookmark mutation re-reads W05 state when the write commits but its response is lost', async () => {
  const contentId = 'bookmark-response-lost-after-commit';
  serverBookmarks.set('viewer-a:' + contentId, false);
  await refreshContentBookmarkStatus(contentId, 'viewer-a');
  failNextBookmarkAfterCommit = true;

  await expect(toggleContentBookmark(contentId, 'viewer-a')).resolves.toMatchObject({
    ok: false,
    message: 'bookmark response was lost after server commit',
  });

  expect(calls.filter((call) => call.path.startsWith('/interactions/bookmarks'))
    .map((call) => call.options.method || 'GET')).toEqual(['GET', 'POST', 'GET']);
  expect(getContentBookmarkSnapshot(contentId, 'viewer-a')).toMatchObject({
    bookmarked: true,
    loaded: true,
    loading: false,
    pending: false,
    error: null,
  });
  expect(calls.every((call) => call.options.expectedAccountId === 'viewer-a')).toBe(true);
});
