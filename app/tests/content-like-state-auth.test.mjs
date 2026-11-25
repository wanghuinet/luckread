import { beforeEach, expect, mock, test } from 'bun:test';

let activeViewerId = null;
const calls = [];

mock.module('../store/auth-store.ts', () => ({
  useAuthStore: {
    getState: () => ({ user: activeViewerId ? { id: activeViewerId } : null }),
  },
}));

mock.module('../lib/api-client.ts', () => ({
  apiRequest: async (...args) => {
    calls.push(args);
    return {
      response: { ok: true, status: 200 },
      data: { data: { liked: false, likeCount: 3 } },
      error: null,
    };
  },
  createIdempotencyKey: () => 'test-like-key',
}));

const {
  refreshContentLikeStatus,
  toggleContentLike,
} = await import('../lib/content-like-state.ts');

beforeEach(() => {
  activeViewerId = null;
  calls.length = 0;
});

test('does not request viewer-specific like status for an anonymous visitor', async () => {
  await refreshContentLikeStatus('post-1', null);
  expect(calls).toHaveLength(0);
});

test('rejects an anonymous like mutation before making an API request', async () => {
  await expect(toggleContentLike('post-1', null)).resolves.toMatchObject({
    ok: false,
    status: 401,
    message: 'Sign in to like this post.',
  });
  expect(calls).toHaveLength(0);
});

test('still loads like status for the authenticated viewer', async () => {
  activeViewerId = 'viewer-a';
  await refreshContentLikeStatus('post-1', 'viewer-a');
  expect(calls).toHaveLength(1);
  expect(calls[0][0]).toContain('/interactions/likes?targetType=content');
});
