import { readFileSync } from 'node:fs';
import { beforeEach, expect, mock, test } from 'bun:test';

const calls = [];
let respond = async () => ({
  response: { ok: true, status: 204 },
  data: null,
  error: null,
});

mock.module('../lib/api-client.ts', () => ({
  apiRequest: async (path, options) => {
    calls.push({ path, options });
    return respond(path, options);
  },
  createIdempotencyKey: () => 'generated-idempotency-key',
  getApiErrorMessage: (data, fallback) => data?.error?.message || fallback,
}));

const { CommentDeleteApiError, deleteComment } = await import('../lib/comment-delete-api.ts');

beforeEach(() => {
  calls.length = 0;
  respond = async () => ({
    response: { ok: true, status: 204 },
    data: null,
    error: null,
  });
});

test('deletes through the existing W01 comment route and preserves the retry key', async () => {
  await expect(deleteComment('comment/id', 'same-key-for-retry')).resolves.toBeUndefined();
  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/comments/comment%2Fid');
  expect(calls[0].options.method).toBe('DELETE');
  expect(calls[0].options.idempotencyKey).toBe('same-key-for-retry');
});

test('surfaces server refusal when a comment cannot be deleted', async () => {
  respond = async () => ({
    response: { ok: false, status: 409 },
    data: { error: { code: 'COMMENT_HAS_REPLIES', message: 'Comments with replies cannot be deleted.' } },
    error: {
      status: 409,
      code: 'COMMENT_HAS_REPLIES',
      message: 'Comments with replies cannot be deleted.',
      recoveryAction: 'refresh-conflict',
      retryable: false,
    },
  });
  await expect(deleteComment('parent-comment', 'delete-key')).rejects.toMatchObject({
    name: 'CommentDeleteApiError',
    status: 409,
    code: 'COMMENT_HAS_REPLIES',
    message: 'Comments with replies cannot be deleted.',
  });
});

test('preserves authentication errors and does not report success on failed writes', async () => {
  respond = async () => ({
    response: { ok: false, status: 401 },
    data: { error: { code: 'UNAUTHENTICATED', message: 'Sign in again to continue.' } },
    error: {
      status: 401,
      code: 'UNAUTHENTICATED',
      message: 'Sign in again to continue.',
      recoveryAction: 'sign-in',
      retryable: false,
    },
  });
  await expect(deleteComment('comment-1', 'delete-key')).rejects.toMatchObject({
    status: 401,
    code: 'UNAUTHENTICATED',
  });
});

test('rejects missing identifiers or invalid idempotency keys without sending requests', async () => {
  await expect(deleteComment('  ', 'delete-key')).rejects.toThrow('Comment ID is required.');
  await expect(deleteComment('comment-1', ' ')).rejects.toThrow('A valid idempotency key is required.');
  expect(calls).toHaveLength(0);
});

test('shows delete only for the authenticated author and confirms before mutation', () => {
  const source = readFileSync(new URL('../components/Comments.tsx', import.meta.url), 'utf8');
  expect(source).toContain('comment.authorUserId === currentUserId');
  expect(source).toContain("Alert.alert(");
  expect(source).toContain("style: 'destructive'");
  expect(source).toContain("deleteCommentRequest(comment.id, key)");
  expect(source).toContain("setComments((current) => current.filter((candidate) => candidate.id !== comment.id))");
});
