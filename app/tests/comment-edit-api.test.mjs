import { readFileSync } from 'node:fs';
import { beforeEach, expect, mock, test } from 'bun:test';

const calls = [];
let respond = async () => ({
  response: { ok: true, status: 200 },
  data: { data: { id: 'comment-1', body: 'updated' } },
  error: null,
});

mock.module('../lib/api-client.ts', () => ({
  apiRequest: async (path, options) => {
    calls.push({ path, options });
    return respond(path, options);
  },
  getApiErrorMessage: (data, fallback) => data?.error?.message || fallback,
}));

const { CommentEditApiError, updateComment } = await import('../lib/comment-edit-api.ts');

beforeEach(() => {
  calls.length = 0;
  respond = async () => ({
    response: { ok: true, status: 200 },
    data: { data: { id: 'comment-1', body: 'updated' } },
    error: null,
  });
});

test('updates only through W01 PATCH with If-Match and a stable idempotency key', async () => {
  await expect(updateComment(
    'comment/id',
    '  updated body  ',
    '2026-10-21T10:00:00.000Z',
    'same-edit-key',
  )).resolves.toBeUndefined();

  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/comments/comment%2Fid');
  expect(calls[0].options.method).toBe('PATCH');
  expect(calls[0].options.idempotencyKey).toBe('same-edit-key');
  expect(calls[0].options.headers['If-Match']).toBe('"2026-10-21T10:00:00.000Z"');
  expect(JSON.parse(calls[0].options.body)).toEqual({ body: 'updated body' });
});

test('surfaces stale-version conflict without pretending the edit succeeded', async () => {
  respond = async () => ({
    response: { ok: false, status: 412 },
    data: { error: { code: 'PRECONDITION_FAILED', message: 'If-Match precondition failed.' } },
    error: {
      status: 412,
      code: 'PRECONDITION_FAILED',
      message: 'If-Match precondition failed.',
      recoveryAction: 'refresh-conflict',
      retryable: false,
    },
  });

  await expect(updateComment('comment-1', 'new body', 'old-version', 'conflict-key'))
    .rejects.toMatchObject({
      name: 'CommentEditApiError',
      status: 412,
      code: 'PRECONDITION_FAILED',
      message: 'If-Match precondition failed.',
    });
});

test('preserves authentication failures', async () => {
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

  await expect(updateComment('comment-1', 'new body', 'version', 'edit-key'))
    .rejects.toMatchObject({ name: 'CommentEditApiError', status: 401, code: 'UNAUTHENTICATED' });
});

test('rejects invalid input before making an API call', async () => {
  await expect(updateComment(' ', 'body', 'version', 'key')).rejects.toThrow('Comment ID is required.');
  await expect(updateComment('comment-1', '   ', 'version', 'key')).rejects.toThrow('1–10,000 characters.');
  await expect(updateComment('comment-1', 'body', ' ', 'key')).rejects.toThrow('current comment version is unavailable');
  await expect(updateComment('comment-1', 'body', 'version', ' ')).rejects.toThrow('idempotency key is required');
  await expect(updateComment('comment-1', 'x'.repeat(10001), 'version', 'key')).rejects.toThrow('1–10,000 characters.');
  expect(calls).toHaveLength(0);
});

test('wires edit controls with an author check and a server refresh after save', () => {
  const comments = readFileSync(new URL('../components/Comments.tsx', import.meta.url), 'utf8');
  const action = readFileSync(new URL('../components/CommentEditAction.tsx', import.meta.url), 'utf8');

  expect(comments).toContain('<CommentEditAction comment={comment} onSaved={() => loadComments()} />');
  expect(action).toContain('comment.authorUserId !== currentUserId');
  expect(action).toContain('await updateComment(comment.id, normalizedBody, version, key)');
  expect(action).toContain('await onSaved()');
  expect(action).toContain("cause.status === 412");
});
