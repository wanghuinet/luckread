import { beforeEach, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';

let activeViewerId = 'viewer-a';
const calls: Array<{ path: string; options: any }> = [];
const serverLikes = new Map<string, boolean>();
const serverFollows = new Map<string, boolean>();

mock.module('../store/auth-store.ts', () => ({
  useAuthStore: Object.assign(
    (selector: (state: { user: { id: string } | null }) => unknown) =>
      selector({ user: activeViewerId ? { id: activeViewerId } : null }),
    {
      getState: () => ({ user: activeViewerId ? { id: activeViewerId } : null }),
    },
  ),
}));

mock.module('../lib/api-client.ts', () => ({
  createIdempotencyKey: () => 'viewer-scope-test-key',
  apiRequest: async (path: string, options: any = {}) => {
    calls.push({ path, options });

    if (path.startsWith('/interactions/likes?')) {
      const liked = serverLikes.get(activeViewerId) ?? false;
      return {
        response: { ok: true, status: 200 },
        data: { data: { liked, likeCount: liked ? 7 : 3 } },
        error: null,
      };
    }

    if (path === '/interactions/likes') {
      serverLikes.set(activeViewerId, options.method === 'POST');
      return { response: { ok: true, status: 200 }, data: { data: {} }, error: null };
    }

    if (path.startsWith('/social/follows/')) {
      const targetId = decodeURIComponent(path.slice('/social/follows/'.length));
      if (options.method === 'GET') {
        return {
          response: { ok: true, status: 200 },
          data: { data: { following: serverFollows.get(activeViewerId + ':' + targetId) ?? false } },
          error: null,
        };
      }
      serverFollows.set(activeViewerId + ':' + targetId, options.method === 'POST');
      return { response: { ok: true, status: 200 }, data: { data: {} }, error: null };
    }

    throw new Error('Unexpected API request: ' + path);
  },
}));

const {
  getContentLikeSnapshot,
  refreshContentLikeStatus,
  toggleContentLike,
} = await import('../lib/content-like-state.ts');
const {
  getUserFollowSnapshot,
  refreshUserFollowStatus,
  toggleUserFollow,
} = await import('../lib/user-follow-state.ts');

beforeEach(() => {
  activeViewerId = 'viewer-a';
  calls.length = 0;
  serverLikes.clear();
  serverFollows.clear();
});

test('content like state is isolated and refreshed independently for each signed-in viewer', async () => {
  const contentId = 'account-isolation-post';

  activeViewerId = 'viewer-a';
  serverLikes.set('viewer-a', true);
  await refreshContentLikeStatus(contentId, 'viewer-a');

  activeViewerId = 'viewer-b';
  serverLikes.set('viewer-b', false);
  await refreshContentLikeStatus(contentId, 'viewer-b');

  expect(getContentLikeSnapshot(contentId, {}, 'viewer-a')).toMatchObject({
    liked: true,
    likeCount: 7,
    loading: false,
  });
  expect(getContentLikeSnapshot(contentId, {}, 'viewer-b')).toMatchObject({
    liked: false,
    likeCount: 3,
    loading: false,
  });
});

test('content like mutation reconciles only the initiating viewer cache', async () => {
  const contentId = 'account-isolation-like-mutation';

  activeViewerId = 'viewer-a';
  serverLikes.set('viewer-a', true);
  await refreshContentLikeStatus(contentId, 'viewer-a');

  activeViewerId = 'viewer-b';
  serverLikes.set('viewer-b', false);
  await refreshContentLikeStatus(contentId, 'viewer-b');

  activeViewerId = 'viewer-a';
  await expect(toggleContentLike(contentId, 'viewer-a')).resolves.toMatchObject({ ok: true });

  expect(getContentLikeSnapshot(contentId, {}, 'viewer-a').liked).toBe(false);
  expect(getContentLikeSnapshot(contentId, {}, 'viewer-b').liked).toBe(false);
  expect(calls.filter((call) => call.path === '/interactions/likes')).toHaveLength(1);
});

test('a stale like action cannot execute after the active account changes', async () => {
  activeViewerId = 'viewer-b';

  await expect(toggleContentLike('stale-viewer-post', 'viewer-a')).resolves.toMatchObject({ ok: false });
  expect(calls).toHaveLength(0);
});

test('follow state is isolated and refreshed independently for each signed-in viewer', async () => {
  const targetId = 'follow-target';

  activeViewerId = 'viewer-a';
  serverFollows.set('viewer-a:' + targetId, true);
  await refreshUserFollowStatus(targetId, 'viewer-a');

  activeViewerId = 'viewer-b';
  serverFollows.set('viewer-b:' + targetId, false);
  await refreshUserFollowStatus(targetId, 'viewer-b');

  expect(getUserFollowSnapshot(targetId, 'viewer-a')).toMatchObject({
    following: true,
    loaded: true,
    loading: false,
  });
  expect(getUserFollowSnapshot(targetId, 'viewer-b')).toMatchObject({
    following: false,
    loaded: true,
    loading: false,
  });
});

test('follow mutation reconciles only the initiating viewer cache', async () => {
  const targetId = 'follow-target-mutation';

  activeViewerId = 'viewer-a';
  serverFollows.set('viewer-a:' + targetId, false);
  await refreshUserFollowStatus(targetId, 'viewer-a');

  activeViewerId = 'viewer-b';
  serverFollows.set('viewer-b:' + targetId, true);
  await refreshUserFollowStatus(targetId, 'viewer-b');

  activeViewerId = 'viewer-a';
  await expect(toggleUserFollow(targetId, 'viewer-a')).resolves.toMatchObject({ ok: true });

  expect(getUserFollowSnapshot(targetId, 'viewer-a').following).toBe(true);
  expect(getUserFollowSnapshot(targetId, 'viewer-b').following).toBe(true);
  expect(calls.filter((call) => call.path === '/social/follows/' + targetId)).toHaveLength(2);
});

test('like and follow hooks resubscribe and re-read when the authenticated viewer changes', () => {
  const likeSource = readFileSync(new URL('../lib/content-like-state.ts', import.meta.url), 'utf8');
  const followSource = readFileSync(new URL('../lib/user-follow-state.ts', import.meta.url), 'utf8');
  const followButtonSource = readFileSync(new URL('../components/FollowButton.tsx', import.meta.url), 'utf8');

  for (const source of [likeSource, followSource]) {
    expect(source).toContain('useAuthStore((state) => state.user?.id ?? null)');
    expect(source).toContain('[id, viewerId]');
    expect(source).toContain('subscribe(id, viewerId, listener)');
  }
  expect(followButtonSource).toContain('getUserFollowSnapshot(resolvedTargetId, viewerId)');
});
