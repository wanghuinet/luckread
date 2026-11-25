import { beforeEach, expect, mock, test } from 'bun:test';

const calls = [];
let activeViewerId = 'viewer-a';
let nextResult = {
  response: { ok: true, status: 201 },
  data: { data: { id: 'created-comment' } },
  error: null,
};

mock.module('../store/auth-store.ts', () => ({
  useAuthStore: { getState: () => ({ user: activeViewerId ? { id: activeViewerId } : null }) },
}));

mock.module('../lib/api-client.ts', () => ({
  apiRequest: async (path, options) => {
    calls.push({ path, options });
    return nextResult;
  },
  createIdempotencyKey: () => 'generated-comment-key',
  getApiErrorMessage: (data, fallback) => data?.error?.message || fallback,
}));

const { createComment } = await import('../lib/comment-create-api.ts');

beforeEach(() => {
  activeViewerId = 'viewer-a';
  calls.length = 0;
  nextResult = {
    response: { ok: true, status: 201 },
    data: { data: { id: 'created-comment' } },
    error: null,
  };
});

test('creates a nested reply through the existing W01 comments route with the supplied idempotency key', async () => {
  const result = await createComment({
    contentId: 'content/id',
    body: '  Reply text  ',
    expectedViewerId: 'viewer-a',
    parentId: ' comment/parent ',
    idempotencyKey: 'same-key-for-retry',
  });

  expect(result.response.status).toBe(201);
  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/contents/content%2Fid/comments');
  expect(calls[0].options.method).toBe('POST');
  expect(calls[0].options.idempotencyKey).toBe('same-key-for-retry');
  expect(JSON.parse(calls[0].options.body)).toEqual({
    body: 'Reply text',
    parentId: 'comment/parent',
  });
});

test('creates a top-level comment with a generated key and a null parent ID', async () => {
  await createComment({
    contentId: 'content-1',
    body: 'First comment',
    expectedViewerId: 'viewer-a',
  });

  expect(calls).toHaveLength(1);
  expect(calls[0].options.idempotencyKey).toBe('generated-comment-key');
  expect(JSON.parse(calls[0].options.body)).toEqual({
    body: 'First comment',
    parentId: null,
  });
});

test('rejects invalid content, empty body, oversized body, and invalid keys without sending requests', async () => {
  await expect(createComment({ contentId: ' ', body: 'text' })).rejects.toThrow('Content ID is required.');
  await expect(createComment({ contentId: 'content-1', body: '   ', expectedViewerId: 'viewer-a' })).rejects.toThrow('Comment text must contain 1 to 10000 characters.');
  await expect(createComment({ contentId: 'content-1', body: 'x'.repeat(10001), expectedViewerId: 'viewer-a' })).rejects.toThrow('Comment text must contain 1 to 10000 characters.');
  await expect(createComment({ contentId: 'content-1', body: 'text', expectedViewerId: 'viewer-a', idempotencyKey: ' ' })).rejects.toThrow('A valid idempotency key is required.');
  expect(calls).toHaveLength(0);
});


test('rejects comment creation when the active viewer differs from the captured viewer', async () => {
  activeViewerId = 'viewer-b';
  await expect(createComment({
    contentId: 'content-1',
    body: 'stale account draft',
    expectedViewerId: 'viewer-a',
  })).rejects.toThrow('Your account changed before this reply could be published.');
  expect(calls).toHaveLength(0);
});
