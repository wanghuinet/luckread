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
  clearPendingMutationKeys,
  createIdempotencyKey,
  fetchContentBodyReference,
  LuckReadNetworkError,
} = await import('../lib/api-client.ts');

const {
  getContentLikeSnapshot,
  refreshContentLikeStatus,
  toggleContentLike,
} = await import('../lib/content-like-state.ts');

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

const {
  getUserFollowSnapshot,
  refreshUserFollowStatus,
  resolveUserProfileId,
  toggleUserFollow,
} = await import('../lib/user-follow-state.ts');

const { createContentShareLink } = await import('../lib/content-share.ts');

beforeEach(() => {
  storedToken = 'secure-test-token';
  savedTokens = [];
  pendingFetch = async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
  globalThis.fetch = (input, init) => pendingFetch(input, init);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('adds the secure bearer session and an idempotency key to JSON writes at the canonical public API URL', async () => {
  let capturedInput;
  let capturedInit;
  pendingFetch = async (input, init) => {
    capturedInput = input;
    capturedInit = init;
    return new Response(JSON.stringify({ data: { id: 'created' } }), { status: 201 });
  };

  await apiRequest('/contents', {
    method: 'POST',
    body: JSON.stringify({ title: 'A real post' }),
  });

  expect(capturedInput).toBe('https://api.luckread.com/v1/contents');
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

  expect(capturedUrl.pathname).toBe('/v1/interactions/likes');
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

test('unlikes through DELETE and reconciles the server count after a 204 response', async () => {
  const contentId = 'stage3-unlike-toggle-content';
  let getCount = 0;
  let deleteInit;
  pendingFetch = async (input, init) => {
    const url = new URL(String(input));
    const method = String(init.method || 'GET').toUpperCase();
    if (method === 'GET') {
      getCount += 1;
      const data = getCount === 1 ? { liked: true, likeCount: 5 } : { liked: false, likeCount: 4 };
      return new Response(JSON.stringify({ data }), { status: 200 });
    }
    deleteInit = init;
    return new Response(null, { status: 204 });
  };

  await refreshContentLikeStatus(contentId);
  const outcome = await toggleContentLike(contentId);

  const headers = new Headers(deleteInit.headers);
  expect(outcome.ok).toBe(true);
  expect(String(deleteInit.method).toUpperCase()).toBe('DELETE');
  expect(headers.get('Idempotency-Key')).toBeTruthy();
  expect(headers.get('Authorization')).toBe('Bearer secure-test-token');
  expect(JSON.parse(String(deleteInit.body))).toEqual({ targetType: 'content', targetId: contentId });
  expect(getCount).toBe(2);
  expect(getContentLikeSnapshot(contentId)).toMatchObject({
    liked: false,
    likeCount: 4,
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


test('loads authoritative repost state and aggregate count from the W01 content social summary', async () => {
  const contentId = 'stage3-repost-status-content';
  let capturedUrl;
  let capturedHeaders;
  pendingFetch = async (input, init) => {
    capturedUrl = new URL(String(input));
    capturedHeaders = new Headers(init.headers);
    return new Response(JSON.stringify({
      data: { counts: { reposts: 12 }, viewer: { reposted: true } },
    }), { status: 200 });
  };

  await refreshContentRepostStatus(contentId);

  expect(capturedUrl.pathname).toBe('/v1/contents/' + contentId + '/social');
  expect(capturedHeaders.get('Authorization')).toBe('Bearer secure-test-token');
  expect(getContentRepostSnapshot(contentId)).toMatchObject({
    reposted: true,
    repostCount: 12,
    loading: false,
  });
});

test('reposts the original content through POST and reconciles the real aggregate', async () => {
  const contentId = 'stage3-repost-toggle-content';
  let getCount = 0;
  let mutationRequest;
  pendingFetch = async (input, init) => {
    const url = new URL(String(input));
    const method = String(init.method || 'GET').toUpperCase();
    if (method === 'GET') {
      getCount += 1;
      const data = getCount === 1
        ? { counts: { reposts: 4 }, viewer: { reposted: false } }
        : { counts: { reposts: 5 }, viewer: { reposted: true } };
      return new Response(JSON.stringify({ data }), { status: 200 });
    }
    mutationRequest = { url, init };
    return new Response(JSON.stringify({ data: { contentId, actorUserId: 'viewer-1' } }), { status: 200 });
  };

  await refreshContentRepostStatus(contentId);
  const outcome = await toggleContentRepost(contentId);

  const headers = new Headers(mutationRequest.init.headers);
  expect(outcome.ok).toBe(true);
  expect(mutationRequest.url.pathname).toBe('/v1/content/' + contentId + '/reposts');
  expect(String(mutationRequest.init.method).toUpperCase()).toBe('POST');
  expect(headers.get('Authorization')).toBe('Bearer secure-test-token');
  expect(headers.get('Idempotency-Key')).toBeTruthy();
  expect(getContentRepostSnapshot(contentId)).toMatchObject({
    reposted: true,
    repostCount: 5,
    pending: false,
    loading: false,
    error: null,
  });
});

test('undoes a repost through DELETE and accepts the contract 204 response', async () => {
  const contentId = 'stage3-unrepost-toggle-content';
  let getCount = 0;
  let mutationRequest;
  pendingFetch = async (input, init) => {
    const url = new URL(String(input));
    const method = String(init.method || 'GET').toUpperCase();
    if (method === 'GET') {
      getCount += 1;
      const data = getCount === 1
        ? { counts: { reposts: 7 }, viewer: { reposted: true } }
        : { counts: { reposts: 6 }, viewer: { reposted: false } };
      return new Response(JSON.stringify({ data }), { status: 200 });
    }
    mutationRequest = { url, init };
    return new Response(null, { status: 204 });
  };

  await refreshContentRepostStatus(contentId);
  const outcome = await toggleContentRepost(contentId);

  const headers = new Headers(mutationRequest.init.headers);
  expect(outcome.ok).toBe(true);
  expect(mutationRequest.url.pathname).toBe('/v1/content/' + contentId + '/reposts');
  expect(String(mutationRequest.init.method).toUpperCase()).toBe('DELETE');
  expect(headers.get('Idempotency-Key')).toBeTruthy();
  expect(getContentRepostSnapshot(contentId)).toMatchObject({
    reposted: false,
    repostCount: 6,
    pending: false,
    loading: false,
    error: null,
  });
});

test('rolls back repost state and count when the server rejects a mutation', async () => {
  const contentId = 'stage3-repost-rollback-content';
  pendingFetch = async (_input, init) => {
    const method = String(init.method || 'GET').toUpperCase();
    if (method === 'GET') {
      return new Response(JSON.stringify({
        data: { counts: { reposts: 9 }, viewer: { reposted: false } },
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      error: { code: 'FORBIDDEN', message: 'You do not have permission to repost this content.' },
    }), { status: 403 });
  };

  await refreshContentRepostStatus(contentId);
  const outcome = await toggleContentRepost(contentId);

  expect(outcome).toMatchObject({ ok: false, status: 403 });
  expect(outcome.message).toContain('permission');
  expect(getContentRepostSnapshot(contentId)).toMatchObject({
    reposted: false,
    repostCount: 9,
    pending: false,
    loading: false,
  });
});

test('deduplicates rapid repost taps while a POST is in flight', async () => {
  const contentId = 'stage3-repost-deduplicate-content';
  let mutationCount = 0;
  let releasePost;
  let markPostStarted;
  const postStarted = new Promise((resolve) => { markPostStarted = resolve; });

  pendingFetch = async (_input, init) => {
    const method = String(init.method || 'GET').toUpperCase();
    if (method === 'GET') {
      return new Response(JSON.stringify({
        data: { counts: { reposts: mutationCount > 0 ? 1 : 0 }, viewer: { reposted: mutationCount > 0 } },
      }), { status: 200 });
    }
    mutationCount += 1;
    markPostStarted();
    return await new Promise((resolve) => {
      releasePost = () => resolve(new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }));
    });
  };

  await refreshContentRepostStatus(contentId);
  const firstToggle = toggleContentRepost(contentId);
  await postStarted;
  const secondToggle = await toggleContentRepost(contentId);

  expect(secondToggle.ok).toBe(false);
  expect(mutationCount).toBe(1);
  releasePost();
  expect((await firstToggle).ok).toBe(true);
  expect(getContentRepostSnapshot(contentId)).toMatchObject({
    reposted: true,
    repostCount: 1,
    pending: false,
  });
});


test('loads authoritative follow state from the existing W01/W05 relationship route', async () => {
  const targetUserId = 'stage3-follow-status-user';
  let capturedUrl;
  let capturedHeaders;
  pendingFetch = async (input, init) => {
    capturedUrl = new URL(String(input));
    capturedHeaders = new Headers(init.headers);
    return new Response(JSON.stringify({ data: { following: true } }), { status: 200 });
  };

  await refreshUserFollowStatus(targetUserId);

  expect(capturedUrl.pathname).toBe('/v1/social/follows/' + targetUserId);
  expect(capturedHeaders.get('Authorization')).toBe('Bearer secure-test-token');
  expect(getUserFollowSnapshot(targetUserId)).toMatchObject({
    following: true,
    loaded: true,
    loading: false,
    pending: false,
    error: null,
  });
});

test('follows through POST with an idempotency key and reconciles server state', async () => {
  const targetUserId = 'stage3-follow-toggle-user';
  let getCount = 0;
  let mutationRequest;
  pendingFetch = async (input, init) => {
    const url = new URL(String(input));
    const method = String(init.method || 'GET').toUpperCase();
    if (method === 'GET') {
      getCount += 1;
      return new Response(JSON.stringify({
        data: { following: getCount > 1 },
      }), { status: 200 });
    }
    mutationRequest = { url, init };
    return new Response(JSON.stringify({
      data: { relationshipId: 'follow-stage3', targetUserId },
    }), { status: 200 });
  };

  await refreshUserFollowStatus(targetUserId);
  const outcome = await toggleUserFollow(targetUserId);

  const headers = new Headers(mutationRequest.init.headers);
  expect(outcome.ok).toBe(true);
  expect(mutationRequest.url.pathname).toBe('/v1/social/follows/' + targetUserId);
  expect(String(mutationRequest.init.method).toUpperCase()).toBe('POST');
  expect(headers.get('Authorization')).toBe('Bearer secure-test-token');
  expect(headers.get('Idempotency-Key')).toBeTruthy();
  expect(getCount).toBe(2);
  expect(getUserFollowSnapshot(targetUserId)).toMatchObject({
    following: true,
    loaded: true,
    pending: false,
    loading: false,
    error: null,
  });
});

test('unfollows through DELETE and reconciles the status after a 204 response', async () => {
  const targetUserId = 'stage3-unfollow-toggle-user';
  let getCount = 0;
  let deleteInit;
  pendingFetch = async (_input, init) => {
    const method = String(init.method || 'GET').toUpperCase();
    if (method === 'GET') {
      getCount += 1;
      return new Response(JSON.stringify({
        data: { following: getCount === 1 },
      }), { status: 200 });
    }
    deleteInit = init;
    return new Response(null, { status: 204 });
  };

  await refreshUserFollowStatus(targetUserId);
  const outcome = await toggleUserFollow(targetUserId);

  const headers = new Headers(deleteInit.headers);
  expect(outcome.ok).toBe(true);
  expect(String(deleteInit.method).toUpperCase()).toBe('DELETE');
  expect(headers.get('Authorization')).toBe('Bearer secure-test-token');
  expect(headers.get('Idempotency-Key')).toBeTruthy();
  expect(getCount).toBe(2);
  expect(getUserFollowSnapshot(targetUserId)).toMatchObject({
    following: false,
    loaded: true,
    pending: false,
    loading: false,
    error: null,
  });
});

test('rolls back an optimistic follow change after an authorization failure', async () => {
  const targetUserId = 'stage3-follow-rollback-user';
  pendingFetch = async (_input, init) => {
    const method = String(init.method || 'GET').toUpperCase();
    if (method === 'GET') {
      return new Response(JSON.stringify({ data: { following: false } }), { status: 200 });
    }
    return new Response(JSON.stringify({
      error: { code: 'FORBIDDEN', message: 'You do not have permission to follow this user.' },
    }), { status: 403 });
  };

  await refreshUserFollowStatus(targetUserId);
  const outcome = await toggleUserFollow(targetUserId);

  expect(outcome).toMatchObject({ ok: false, status: 403 });
  expect(outcome.message).toContain('permission');
  expect(getUserFollowSnapshot(targetUserId)).toMatchObject({
    following: false,
    loaded: true,
    pending: false,
    loading: false,
  });
});

test('deduplicates rapid follow taps while a POST is in flight', async () => {
  const targetUserId = 'stage3-follow-deduplicate-user';
  let mutationCount = 0;
  let releasePost;
  let markPostStarted;
  const postStarted = new Promise((resolve) => { markPostStarted = resolve; });

  pendingFetch = async (_input, init) => {
    const method = String(init.method || 'GET').toUpperCase();
    if (method === 'GET') {
      return new Response(JSON.stringify({
        data: { following: mutationCount > 0 },
      }), { status: 200 });
    }
    mutationCount += 1;
    markPostStarted();
    return await new Promise((resolve) => {
      releasePost = () => resolve(new Response(JSON.stringify({
        data: { relationshipId: 'follow-stage3-once', targetUserId },
      }), { status: 200 }));
    });
  };

  await refreshUserFollowStatus(targetUserId);
  const firstToggle = toggleUserFollow(targetUserId);
  await postStarted;
  const secondToggle = await toggleUserFollow(targetUserId);

  expect(secondToggle.ok).toBe(false);
  expect(mutationCount).toBe(1);
  releasePost();
  expect((await firstToggle).ok).toBe(true);
  expect(getUserFollowSnapshot(targetUserId)).toMatchObject({
    following: true,
    loaded: true,
    pending: false,
  });
});


test('resolves a public username to the canonical W01 user ID without forwarding a session token', async () => {
  let capturedUrl;
  let capturedHeaders;
  pendingFetch = async (input, init) => {
    capturedUrl = new URL(String(input));
    capturedHeaders = new Headers(init.headers);
    return new Response(JSON.stringify({ id: 'canonical-user-uuid', username: 'official_handle' }), { status: 200 });
  };

  const result = await resolveUserProfileId('@official_handle');

  expect(result).toEqual({ id: 'canonical-user-uuid' });
  expect(capturedUrl.pathname).toBe('/v1/users/by-username/official_handle');
  expect(capturedHeaders.has('Authorization')).toBe(false);
});

test('does not invent a canonical follow target when username lookup returns 404', async () => {
  let capturedMethod;
  pendingFetch = async (_input, init) => {
    capturedMethod = String(init.method || 'GET').toUpperCase();
    return new Response(JSON.stringify({
      error: { code: 'NOT_FOUND', message: 'User not found' },
    }), { status: 404 });
  };

  const result = await resolveUserProfileId('missing-profile');

  expect(result.id).toBeNull();
  expect(result.status).toBe(404);
  expect(result.message).toBe('User not found');
  expect(capturedMethod).toBe('GET');
});


test('loads authoritative bookmark state from the existing W01/W05 endpoint', async () => {
  const contentId = 'stage3-bookmark-status-content';
  let capturedUrl;
  let capturedHeaders;
  pendingFetch = async (input, init) => {
    capturedUrl = new URL(String(input));
    capturedHeaders = new Headers(init.headers);
    return new Response(JSON.stringify({ data: { favorited: true } }), { status: 200 });
  };

  await refreshContentBookmarkStatus(contentId);

  expect(capturedUrl.pathname).toBe('/v1/interactions/bookmarks');
  expect(capturedUrl.searchParams.get('targetType')).toBe('content');
  expect(capturedUrl.searchParams.get('targetId')).toBe(contentId);
  expect(capturedHeaders.get('Authorization')).toBe('Bearer secure-test-token');
  expect(getContentBookmarkSnapshot(contentId)).toMatchObject({
    bookmarked: true,
    loaded: true,
    loading: false,
    pending: false,
    error: null,
  });
});

test('creates a bookmark through POST and reconciles the current viewer state', async () => {
  const contentId = 'stage3-bookmark-toggle-content';
  let getCount = 0;
  let mutationRequest;
  pendingFetch = async (input, init) => {
    const url = new URL(String(input));
    const method = String(init.method || 'GET').toUpperCase();
    if (method === 'GET') {
      getCount += 1;
      return new Response(JSON.stringify({
        data: { favorited: getCount > 1 },
      }), { status: 200 });
    }
    mutationRequest = { url, init };
    return new Response(JSON.stringify({
      data: { relationshipId: 'bookmark-stage3', targetId: contentId },
    }), { status: 200 });
  };

  await refreshContentBookmarkStatus(contentId);
  const outcome = await toggleContentBookmark(contentId);

  const headers = new Headers(mutationRequest.init.headers);
  expect(outcome.ok).toBe(true);
  expect(mutationRequest.url.pathname).toBe('/v1/interactions/bookmarks');
  expect(String(mutationRequest.init.method).toUpperCase()).toBe('POST');
  expect(JSON.parse(String(mutationRequest.init.body))).toEqual({ targetType: 'content', targetId: contentId });
  expect(headers.get('Authorization')).toBe('Bearer secure-test-token');
  expect(headers.get('Idempotency-Key')).toBeTruthy();
  expect(getCount).toBe(2);
  expect(getContentBookmarkSnapshot(contentId)).toMatchObject({
    bookmarked: true,
    loaded: true,
    pending: false,
    loading: false,
    error: null,
  });
});

test('removes a bookmark through DELETE and accepts the contract 204 response', async () => {
  const contentId = 'stage3-unbookmark-toggle-content';
  let getCount = 0;
  let deleteInit;
  pendingFetch = async (_input, init) => {
    const method = String(init.method || 'GET').toUpperCase();
    if (method === 'GET') {
      getCount += 1;
      return new Response(JSON.stringify({
        data: { favorited: getCount === 1 },
      }), { status: 200 });
    }
    deleteInit = init;
    return new Response(null, { status: 204 });
  };

  await refreshContentBookmarkStatus(contentId);
  const outcome = await toggleContentBookmark(contentId);

  const headers = new Headers(deleteInit.headers);
  expect(outcome.ok).toBe(true);
  expect(String(deleteInit.method).toUpperCase()).toBe('DELETE');
  expect(JSON.parse(String(deleteInit.body))).toEqual({ targetType: 'content', targetId: contentId });
  expect(headers.get('Authorization')).toBe('Bearer secure-test-token');
  expect(headers.get('Idempotency-Key')).toBeTruthy();
  expect(getCount).toBe(2);
  expect(getContentBookmarkSnapshot(contentId)).toMatchObject({
    bookmarked: false,
    loaded: true,
    pending: false,
    loading: false,
    error: null,
  });
});

test('rolls back bookmark state when W01/W05 rejects the mutation', async () => {
  const contentId = 'stage3-bookmark-rollback-content';
  pendingFetch = async (_input, init) => {
    const method = String(init.method || 'GET').toUpperCase();
    if (method === 'GET') {
      return new Response(JSON.stringify({ data: { favorited: false } }), { status: 200 });
    }
    return new Response(JSON.stringify({
      error: { code: 'FORBIDDEN', message: 'You do not have permission to bookmark this content.' },
    }), { status: 403 });
  };

  await refreshContentBookmarkStatus(contentId);
  const outcome = await toggleContentBookmark(contentId);

  expect(outcome).toMatchObject({ ok: false, status: 403 });
  expect(outcome.message).toContain('permission');
  expect(getContentBookmarkSnapshot(contentId)).toMatchObject({
    bookmarked: false,
    loaded: true,
    pending: false,
    loading: false,
  });
});

test('deduplicates rapid bookmark taps while a POST is in flight', async () => {
  const contentId = 'stage3-bookmark-deduplicate-content';
  let mutationCount = 0;
  let releasePost;
  let markPostStarted;
  const postStarted = new Promise((resolve) => { markPostStarted = resolve; });

  pendingFetch = async (_input, init) => {
    const method = String(init.method || 'GET').toUpperCase();
    if (method === 'GET') {
      return new Response(JSON.stringify({
        data: { favorited: mutationCount > 0 },
      }), { status: 200 });
    }
    mutationCount += 1;
    markPostStarted();
    return await new Promise((resolve) => {
      releasePost = () => resolve(new Response(JSON.stringify({
        data: { relationshipId: 'bookmark-stage3-once', targetId: contentId },
      }), { status: 200 }));
    });
  };

  await refreshContentBookmarkStatus(contentId);
  const firstToggle = toggleContentBookmark(contentId);
  await postStarted;
  const secondToggle = await toggleContentBookmark(contentId);

  expect(secondToggle.ok).toBe(false);
  expect(mutationCount).toBe(1);
  releasePost();
  expect((await firstToggle).ok).toBe(true);
  expect(getContentBookmarkSnapshot(contentId)).toMatchObject({
    bookmarked: true,
    loaded: true,
    pending: false,
  });
});


test('creates a public share URL through the existing W01/W05 shares endpoint', async () => {
  const contentId = 'stage3-share-content';
  let capturedRequest;
  pendingFetch = async (input, init) => {
    capturedRequest = { url: new URL(String(input)), init };
    return new Response(JSON.stringify({
      data: { shareId: 'share id/one', contentId },
    }), { status: 201 });
  };

  const result = await createContentShareLink(contentId);

  expect(result).toEqual({
    ok: true,
    url: 'https://luckread.com/s/share%20id%2Fone',
  });
  expect(capturedRequest.url.pathname).toBe('/v1/content/stage3-share-content/shares');
  expect(String(capturedRequest.init.method).toUpperCase()).toBe('POST');
  expect(JSON.parse(String(capturedRequest.init.body))).toEqual({ contentId });
  const headers = new Headers(capturedRequest.init.headers);
  expect(headers.get('Authorization')).toBe('Bearer secure-test-token');
  expect(headers.get('Idempotency-Key')).toBeTruthy();
});

test('does not create a share link when W01/W05 rejects the share', async () => {
  pendingFetch = async () => new Response(JSON.stringify({
    error: { code: 'FORBIDDEN', message: 'Sharing is not allowed for this content.' },
  }), { status: 403 });

  const result = await createContentShareLink('stage3-share-forbidden-content');

  expect(result).toMatchObject({
    ok: false,
    status: 403,
    message: 'Sharing is not allowed for this content.',
  });
});

test('rejects missing content IDs and malformed successful share responses', async () => {
  let requestCount = 0;
  pendingFetch = async () => {
    requestCount += 1;
    return new Response(JSON.stringify({ data: { contentId: 'no-share-id' } }), { status: 201 });
  };

  const missingContentId = await createContentShareLink('  ');
  expect(missingContentId.ok).toBe(false);
  expect(requestCount).toBe(0);

  const missingShareId = await createContentShareLink('stage3-share-missing-id');
  expect(missingShareId.ok).toBe(false);
  expect(requestCount).toBe(1);
});


test('fetches trusted W03 body references through the shared client with same-origin credentials only', async () => {
  let capturedRequest;
  pendingFetch = async (input, init) => {
    capturedRequest = { url: new URL(String(input)), init };
    return new Response('The full content body', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  };

  const response = await fetchContentBodyReference('/content-bodies/body-1.txt', { sessionToken: 'secure-test-token' });

  expect(response.status).toBe(200);
  expect(await response.text()).toBe('The full content body');
  expect(capturedRequest.url.origin).toBe('https://api.luckread.com');
  expect(capturedRequest.url.pathname).toBe('/content-bodies/body-1.txt');
  const headers = new Headers(capturedRequest.init.headers);
  expect(headers.get('Authorization')).toBe('Bearer secure-test-token');
  expect(headers.get('Accept')).toContain('text/plain');
  expect(capturedRequest.init.cache).toBe('no-store');
});

test('forwards a session token to the first-party media delivery hosts so W01 can re-check W03 access', async () => {
  const requests = [];
  pendingFetch = async (input, init) => {
    requests.push({ url: new URL(String(input)), headers: new Headers(init.headers) });
    return new Response('authorized member body', { status: 200 });
  };

  await fetchContentBodyReference('https://img.luckread.com/private/member-body.txt', {
    sessionToken: 'secure-test-token',
  });
  await fetchContentBodyReference('https://video.luckread.com/private/member-body.json', {
    sessionToken: 'secure-test-token',
  });

  expect(requests).toHaveLength(2);
  expect(requests[0].headers.get('Authorization')).toBe('Bearer secure-test-token');
  expect(requests[1].headers.get('Authorization')).toBe('Bearer secure-test-token');
  expect(requests.every((request) => request.url.protocol === 'https:')).toBe(true);
});

test('does not forward session credentials to other LuckRead subdomains', async () => {
  let capturedHeaders;
  pendingFetch = async (_input, init) => {
    capturedHeaders = new Headers(init.headers);
    return new Response('public text', { status: 200 });
  };

  await fetchContentBodyReference('https://other.luckread.com/public/body.txt', {
    sessionToken: 'secure-test-token',
  });

  expect(capturedHeaders.has('Authorization')).toBe(false);
});

test('rejects untrusted body-reference origins before making a network request', async () => {
  let requestCount = 0;
  pendingFetch = async () => {
    requestCount += 1;
    return new Response('unexpected', { status: 200 });
  };

  await expect(fetchContentBodyReference('https://untrusted.example/body.txt')).rejects.toThrow('Unsupported LuckRead content body reference');
  await expect(fetchContentBodyReference('https://luckread.com@untrusted.example/body.txt')).rejects.toThrow('Unsupported LuckRead content body reference');
  expect(requestCount).toBe(0);
});


test('reuses the same generated key after a transport failure, even if the caller creates a fresh key', async () => {
  const seenKeys = [];
  const body = JSON.stringify({ body: 'single logical post' });
  pendingFetch = async (_input, init) => {
    seenKeys.push(new Headers(init.headers).get('Idempotency-Key'));
    throw new TypeError('socket closed after request dispatch');
  };

  await expect(apiRequest('/retry-key-network-20261022', {
    method: 'POST',
    body,
    idempotencyKey: createIdempotencyKey(),
  })).rejects.toBeInstanceOf(LuckReadNetworkError);

  pendingFetch = async (_input, init) => {
    seenKeys.push(new Headers(init.headers).get('Idempotency-Key'));
    return new Response(JSON.stringify({ data: { id: 'created-once' } }), { status: 201 });
  };
  const retry = await apiRequest('/retry-key-network-20261022', {
    method: 'POST',
    body,
    // Callers that regenerate a key on re-entry still use the pending retry key.
    idempotencyKey: createIdempotencyKey(),
  });

  expect(retry.response.status).toBe(201);
  expect(seenKeys).toHaveLength(2);
  expect(seenKeys[1]).toBe(seenKeys[0]);
});

test('reuses keys after ambiguous 503s, then releases the key once a retry succeeds', async () => {
  const seenKeys = [];
  const body = JSON.stringify({ title: 'retry this content mutation' });
  pendingFetch = async (_input, init) => {
    seenKeys.push(new Headers(init.headers).get('Idempotency-Key'));
    return new Response(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE' } }), { status: 503 });
  };

  const first = await apiRequest('/retry-key-http-503-20261022', {
    method: 'POST',
    body,
    idempotencyKey: createIdempotencyKey(),
  });
  expect(first.response.status).toBe(503);

  pendingFetch = async (_input, init) => {
    seenKeys.push(new Headers(init.headers).get('Idempotency-Key'));
    return new Response(JSON.stringify({ data: { id: 'content-1' } }), { status: 201 });
  };
  await apiRequest('/retry-key-http-503-20261022', {
    method: 'POST',
    body,
    idempotencyKey: createIdempotencyKey(),
  });
  await apiRequest('/retry-key-http-503-20261022', {
    method: 'POST',
    body,
    idempotencyKey: createIdempotencyKey(),
  });

  expect(seenKeys[1]).toBe(seenKeys[0]);
  expect(seenKeys[2]).not.toBe(seenKeys[1]);
});

test('does not reuse a failed mutation key for a different payload', async () => {
  const seenKeys = [];
  pendingFetch = async (_input, init) => {
    seenKeys.push(new Headers(init.headers).get('Idempotency-Key'));
    return new Response(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE' } }), { status: 503 });
  };

  await apiRequest('/retry-key-body-change-20261022', {
    method: 'POST',
    body: JSON.stringify({ title: 'first payload' }),
  });
  await apiRequest('/retry-key-body-change-20261022', {
    method: 'POST',
    body: JSON.stringify({ title: 'different payload' }),
  });

  expect(seenKeys).toHaveLength(2);
  expect(seenKeys[1]).not.toBe(seenKeys[0]);
});

test('does not keep a key after a definitive validation response', async () => {
  const seenKeys = [];
  pendingFetch = async (_input, init) => {
    seenKeys.push(new Headers(init.headers).get('Idempotency-Key'));
    return new Response(JSON.stringify({ error: { code: 'VALIDATION_FAILED' } }), { status: 422 });
  };

  await apiRequest('/retry-key-validation-20261022', {
    method: 'POST',
    body: JSON.stringify({ title: 'invalid but identical' }),
  });
  await apiRequest('/retry-key-validation-20261022', {
    method: 'POST',
    body: JSON.stringify({ title: 'invalid but identical' }),
  });

  expect(seenKeys[1]).not.toBe(seenKeys[0]);
});


test('reuses a media upload key for a repeated multipart request with the same upload fingerprint', async () => {
  const seenKeys = [];
  const seenFingerprints = [];
  const fingerprint = 'lr-up1-0123456789abcdef';
  let attempts = 0;
  pendingFetch = async (_input, init) => {
    seenKeys.push(new Headers(init.headers).get('Idempotency-Key'));
    seenFingerprints.push(new Headers(init.headers).get('X-LuckRead-Upload-Fingerprint'));
    attempts += 1;
    if (attempts === 1) throw new TypeError('upload response lost');
    return new Response(JSON.stringify({ doc: { id: 'media-replayed' } }), { status: 201 });
  };

  const makeForm = () => {
    const form = new FormData();
    form.append('_payload', JSON.stringify({ alt: 'photo.png' }));
    form.append('file', new Blob(['same-media']), 'photo.png');
    return form;
  };

  await expect(apiRequest('/media', {
    method: 'POST',
    body: makeForm(),
    idempotencyKey: createIdempotencyKey(),
    headers: { 'X-LuckRead-Upload-Fingerprint': fingerprint },
  })).rejects.toBeInstanceOf(LuckReadNetworkError);

  const result = await apiRequest('/media', {
    method: 'POST',
    body: makeForm(),
    idempotencyKey: createIdempotencyKey(),
    headers: { 'X-LuckRead-Upload-Fingerprint': fingerprint },
  });

  expect(result.response.status).toBe(201);
  expect(seenFingerprints).toEqual([fingerprint, fingerprint]);
  expect(seenKeys[1]).toBe(seenKeys[0]);
});


test('clears pending mutation keys when the authenticated identity changes', async () => {
  const seenKeys = [];
  const url = '/retry-key-session-boundary-20261022';
  const body = JSON.stringify({ title: 'same request after account switch' });
  pendingFetch = async (_input, init) => {
    seenKeys.push(new Headers(init.headers).get('Idempotency-Key'));
    throw new TypeError('connection interrupted');
  };

  await expect(apiRequest(url, {
    method: 'POST',
    body,
    idempotencyKey: createIdempotencyKey(),
  })).rejects.toBeInstanceOf(LuckReadNetworkError);

  clearPendingMutationKeys();

  pendingFetch = async (_input, init) => {
    seenKeys.push(new Headers(init.headers).get('Idempotency-Key'));
    return new Response(JSON.stringify({ data: { ok: true } }), { status: 201 });
  };
  await apiRequest(url, {
    method: 'POST',
    body,
    idempotencyKey: createIdempotencyKey(),
  });

  expect(seenKeys[1]).not.toBe(seenKeys[0]);
});
