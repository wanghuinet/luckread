import { readFileSync } from 'node:fs';
import { beforeEach, expect, mock, test } from 'bun:test';

const calls = [];
let handler = async () => ({
  response: { ok: true, status: 200 },
  data: { data: { liked: false, likeCount: 0 } },
  error: null,
});

mock.module('../lib/api-client.ts', () => ({
  apiRequest: async (path, options) => {
    calls.push({ path, options });
    return handler(path, options);
  },
  createIdempotencyKey: () => 'test-idempotency',
  getApiErrorMessage: (data, fallback) => data?.error?.message || fallback,
}));

const { CommentLikeApiError, toggleCommentLike } = await import('../lib/comment-likes-api.ts');

beforeEach(() => {
  calls.length = 0;
  handler = async () => ({
    response: { ok: true, status: 200 },
    data: { data: { liked: false, likeCount: 0 } },
    error: null,
  });
});

test('reads authoritative status and likes a comment through the existing endpoint', async () => {
  handler = async (path) => path.startsWith('/interactions/likes?')
    ? {
        response: { ok: true, status: 200 },
        data: { data: { liked: false, likeCount: 2 } },
        error: null,
      }
    : {
        response: { ok: true, status: 201 },
        data: { data: { liked: true, likeCount: 3 } },
        error: null,
      };

  await expect(toggleCommentLike('comment/id')).resolves.toEqual({ liked: true });

  expect(calls).toHaveLength(2);
  expect(calls[0].path).toBe('/interactions/likes?targetType=comment&targetId=comment%2Fid');
  expect(calls[0].options.method).toBe('GET');
  expect(calls[1].path).toBe('/comments/comment%2Fid/likes');
  expect(calls[1].options.method).toBe('POST');
  expect(calls[1].options.idempotencyKey).toBe('native-comment-like:comment/id:like:test-idempotency');
});

test('unlikes an already-liked comment and allows 204 success responses', async () => {
  handler = async (path) => path.startsWith('/interactions/likes?')
    ? {
        response: { ok: true, status: 200 },
        data: { data: { liked: true, likeCount: 4 } },
        error: null,
      }
    : {
        response: { ok: true, status: 204 },
        data: null,
        error: null,
      };

  await expect(toggleCommentLike('comment-1')).resolves.toEqual({ liked: false });

  expect(calls[1].options.method).toBe('DELETE');
  expect(calls[1].options.idempotencyKey).toBe('native-comment-like:comment-1:unlike:test-idempotency');
});

test('does not mutate when the authoritative status cannot be loaded', async () => {
  handler = async () => ({
    response: { ok: false, status: 401 },
    data: { error: { code: 'UNAUTHENTICATED', message: 'Sign in to like replies.' } },
    error: { status: 401, code: 'UNAUTHENTICATED', message: 'Sign in to like replies.' },
  });

  await expect(toggleCommentLike('comment-1')).rejects.toMatchObject({
    name: 'CommentLikeApiError',
    status: 401,
    code: 'UNAUTHENTICATED',
    message: 'Sign in to like replies.',
  });
  expect(calls).toHaveLength(1);
});

test('does not report a failed mutation as a successful like', async () => {
  handler = async (path) => path.startsWith('/interactions/likes?')
    ? {
        response: { ok: true, status: 200 },
        data: { data: { liked: false } },
        error: null,
      }
    : {
        response: { ok: false, status: 403 },
        data: { error: { message: 'This action is not allowed.' } },
        error: { status: 403, message: 'This action is not allowed.' },
      };

  await expect(toggleCommentLike('comment-1')).rejects.toThrow('This action is not allowed.');
  expect(calls).toHaveLength(2);
  expect(calls[1].options.method).toBe('POST');
});

test('validates a missing comment ID before touching the API', async () => {
  await expect(toggleCommentLike('   ')).rejects.toThrow('A valid comment ID is required.');
  expect(calls).toHaveLength(0);
});


test('wires the reply like button to the tested API adapter and authoritative list state', () => {
  const component = readFileSync(new URL('../components/Comments.tsx', import.meta.url), 'utf8');
  expect(component).toContain('toggleCommentLike as toggleCommentLikeRequest');
  expect(component).toContain('item.likedByViewer === true');
  expect(component).toContain('onPress={() => void toggleCommentLike(comment)}');
  expect(component).toContain("accessibilityLabel={likedComments[comment.id] ? 'Unlike reply' : 'Like reply'}");
});
