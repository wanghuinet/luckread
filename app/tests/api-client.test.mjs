import { afterEach, beforeEach, expect, mock, test } from 'bun:test';

let storedToken = 'secure-test-token';
let savedTokens = [];
let pendingFetch;
const originalFetch = globalThis.fetch;

mock.module('../lib/secure-session.ts', () => ({
  readSessionToken: async () => storedToken,
  saveSessionToken: async (token) => {
    storedToken = token;
    savedTokens.push(token);
  },
}));

const {
  apiRequest,
  createIdempotencyKey,
  LuckReadNetworkError,
} = await import('../lib/api-client.ts');

const {
  getContentLikeSnapshot,
  refreshContentLikeStatus,
  toggleContentLike,
} = await import('../lib/content-like-state.ts');

beforeEach(() => {
  storedToken = 'secure-test-token';
  savedTokens = [];
  pendingFetch = async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
  globalThis.fetch = (input, init) => pendingFetch(input, init);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('adds the secure bearer session and an idempotency key to JSON writes', async () => {
  let capturedInit;
  pendingFetch = async (_input, init) => {
    capturedInit = init;
    return new Response(JSON.stringify({ data: { id: 'created' } }), { status: 201 });
  };

  await apiRequest('/contents', {
    method: 'POST',
    body: JSON.stringify({ title: 'A real post' }),
  });

  const headers = new Headers(capturedInit.headers);
  expect(headers.get('Authorization')).toBe('Bearer secure-test-token');
  expect(headers.get('Content-Type')).toBe('application/json');
  expect(headers.get('Idempotency-Key')).toBeTruthy();
  expect(capturedInit.cache).toBe('no-store');
});

test('removes Content-Type for FormData so fetch can set the multipart boundary', async () => {
  let capturedInit;
  pendingFetch = async (_input, init) => {
    capturedInit = init;
    return new Response(JSON.stringify({ data: { url: '/media/test' } }), { status: 201 });
  };
  const form = new FormData();
  form.append('file', new Blob(['image-data'], { type: 'image/png' }), 'image.png');

  await apiRequest('/media', {
    method: 'POST',
    body: form,
    headers: { 'Content-Type': 'application/json' },
  });

  const headers = new Headers(capturedInit.headers);
  expect(headers.has('Content-Type')).toBe(false);
  expect(headers.get('Idempotency-Key')).toBeTruthy();
});

test('keeps an explicit idempotency key stable for retries of one logical write', async () => {
  const key = createIdempotencyKey();
  const seenKeys = [];
  pendingFetch = async (_input, init) => {
    seenKeys.push(new Headers(init.headers).get('Idempotency-Key'));
    return new Response(null, { status: 204 });
  };

  await apiRequest('/contents/content-1', {
    method: 'PATCH',
    body: JSON.stringify({ title: 'Updated' }),
    idempotencyKey: key,
  });
  await apiRequest('/contents/content-1', {
    method: 'PATCH',
    body: JSON.stringify({ title: 'Updated' }),
    idempotencyKey: key,
  });

  expect(seenKeys).toEqual([key, key]);
});

test('allows contract-defined auth requests to opt out of mutation keys', async () => {
  let capturedInit;
  pendingFetch = async (_input, init) => {
    capturedInit = init;
    return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
  };

  await apiRequest('/auth/login', {
    method: 'POST',
    auth: false,
    idempotencyKey: false,
    body: JSON.stringify({ identity: 'user@example.com', credential: 'not-logged' }),
  });

  const headers = new Headers(capturedInit.headers);
  expect(headers.has('Authorization')).toBe(false);
  expect(headers.has('Idempotency-Key')).toBe(false);
});

test('classifies recoverable API status codes and honours Retry-After', async () => {
  const cases = [
    [401, 'sign-in', false],
    [403, 'check-permissions', false],
    [409, 'refresh-conflict', false],
    [422, 'correct-input', false],
    [429, 'wait-and-retry', true],
    [503, 'retry-later', true],
  ];

  for (const [status, recoveryAction, retryable] of cases) {
    pendingFetch = async () => new Response(
      JSON.stringify({ error: { code: 'TEST_FAILURE', message: 'Server message' }, requestId: 'req-test' }),
      { status, headers: status === 429 ? { 'Retry-After': '2' } : {} },
    );

    const result = await apiRequest('/test', { method: 'GET' });
    expect(result.error.status).toBe(status);
    expect(result.error.recoveryAction).toBe(recoveryAction);
    expect(result.error.retryable).toBe(retryable);
    expect(result.error.message).toBe('Server message');
    expect(result.error.requestId).toBe('req-test');
    if (status === 429) expect(result.error.retryAfterMs).toBe(2000);
  }
});

test('persists renewed session credentials from the response header only', async () => {
  pendingFetch = async () => new Response(JSON.stringify({ data: { ok: true } }), {
    status: 200,
    headers: { 'X-LuckRead-Session-Token': 'renewed-secure-token' },
  });

  await apiRequest('/auth/session', { method: 'GET' });

  expect(savedTokens).toEqual(['renewed-secure-token']);
  expect(storedToken).toBe('renewed-secure-token');
});

test('normalizes transport failures into a retryable network error', async () => {
  pendingFetch = async () => {
    throw new TypeError('raw transport implementation detail');
  };

  await expect(apiRequest('/contents')).rejects.toBeInstanceOf(LuckReadNetworkError);
});


test('loads authoritative content like state and aggregate count from W01/W05', async () => {
  const contentId = 'stage3-like-status-content';
  let capturedUrl;
  let capturedHeaders;
  pendingFetch = async (input, init) => {
    capturedUrl = new URL(String(input));
    capturedHeaders = new Headers(init.headers);
    return new Response(JSON.stringify({ data: { liked: true, likeCount: 8 } }), { status: 200 });
  };

  await refreshContentLikeStatus(contentId);

  expect(capturedUrl.pathname).toBe('/api/v1/interactions/likes');
  expect(capturedUrl.searchParams.get('targetType')).toBe('content');
  expect(capturedUrl.searchParams.get('targetId')).toBe(contentId);
  expect(capturedHeaders.get('Authorization')).toBe('Bearer secure-test-token');
  expect(getContentLikeSnapshot(contentId)).toMatchObject({ liked: true, likeCount: 8, loading: false });
});

test('likes through the real API client with an idempotency key and reconciles count', async () => {
  const contentId = 'stage3-like-toggle-content';
  let getCount = 0;
  let mutationInit;
  pendingFetch = async (input, init) => {
    const url = new URL(String(input));
    const method = String(init.method || 'GET').toUpperCase();
    if (method === 'GET') {
      getCount += 1;
      const data = getCount === 1 ? { liked: false, likeCount: 2 } : { liked: true, likeCount: 3 };
      return new Response(JSON.stringify({ data }), { status: 200 });
    }
    mutationInit = init;
    return new Response(JSON.stringify({ data: { relationshipId: 'like-stage3', targetId: contentId } }), { status: 200 });
  };

  await refreshContentLikeStatus(contentId);
  const outcome = await toggleContentLike(contentId);

  const headers = new Headers(mutationInit.headers);
  expect(outcome.ok).toBe(true);
  expect(String(mutationInit.method).toUpperCase()).toBe('POST');
  expect(headers.get('Idempotency-Key')).toBeTruthy();
  expect(headers.get('Authorization')).toBe('Bearer secure-test-token');
  expect(JSON.parse(String(mutationInit.body))).toEqual({ targetType: 'content', targetId: contentId });
  expect(getCount).toBe(2);
  expect(getContentLikeSnapshot(contentId)).toMatchObject({
    liked: true,
    likeCount: 3,
    loading: false,
    pending: false,
    error: null,
  });
});

test('rolls back the optimistic like state after an authorization failure', async () => {
  const contentId = 'stage3-like-rollback-content';
  let mutationCount = 0;
  pendingFetch = async (_input, init) => {
    const method = String(init.method || 'GET').toUpperCase();
    if (method === 'GET') {
      return new Response(JSON.stringify({ data: { liked: false, likeCount: 4 } }), { status: 200 });
    }
    mutationCount += 1;
    return new Response(JSON.stringify({
      error: { code: 'FORBIDDEN', message: 'You do not have permission to like this content.' },
    }), { status: 403 });
  };

  await refreshContentLikeStatus(contentId);
  const outcome = await toggleContentLike(contentId);

  expect(outcome).toMatchObject({ ok: false, status: 403 });
  expect(outcome.message).toContain('permission');
  expect(mutationCount).toBe(1);
  expect(getContentLikeSnapshot(contentId)).toMatchObject({
    liked: false,
    likeCount: 4,
    pending: false,
    loading: false,
  });
});

test('deduplicates rapid like taps while a mutation is in flight', async () => {
  const contentId = 'stage3-like-deduplicate-content';
  let postCount = 0;
  let releasePost;
  let markPostStarted;
  const postStarted = new Promise((resolve) => { markPostStarted = resolve; });

  pendingFetch = async (_input, init) => {
    const method = String(init.method || 'GET').toUpperCase();
    if (method === 'GET') {
      return new Response(JSON.stringify({ data: { liked: postCount > 0, likeCount: postCount > 0 ? 2 : 1 } }), { status: 200 });
    }
    postCount += 1;
    markPostStarted();
    return await new Promise((resolve) => {
      releasePost = () => resolve(new Response(JSON.stringify({ data: { relationshipId: 'like-stage3-once' } }), { status: 200 }));
    });
  };

  await refreshContentLikeStatus(contentId);
  const firstToggle = toggleContentLike(contentId);
  await postStarted;
  const secondToggle = await toggleContentLike(contentId);

  expect(secondToggle.ok).toBe(false);
  expect(postCount).toBe(1);
  releasePost();
  expect((await firstToggle).ok).toBe(true);
  expect(getContentLikeSnapshot(contentId)).toMatchObject({ liked: true, likeCount: 2, pending: false });
});
