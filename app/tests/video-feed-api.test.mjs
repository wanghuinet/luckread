import { beforeEach, expect, mock, test } from 'bun:test';

const calls = [];

mock.module('../lib/api-client.ts', () => ({
  apiRequest: async (path, options) => {
    calls.push({ path, options });
    return {
      response: { ok: true, status: 200 },
      data: { data: { items: [], nextCursor: null, hasMore: false } },
      error: null,
    };
  },
}));

const { fetchVideoFeedPage } = await import('../lib/video-feed-api.ts');

beforeEach(() => {
  calls.length = 0;
});

test('loads the first page from the canonical video content endpoint', async () => {
  await fetchVideoFeedPage();

  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/contents?type=video&limit=12');
  expect(calls[0].options.method).toBe('GET');
});

test('passes the next cursor through the shared API client', async () => {
  const controller = new AbortController();
  await fetchVideoFeedPage({ cursor: 'next page/2', signal: controller.signal });

  expect(calls[0].path).toBe('/contents?type=video&limit=12&cursor=next+page%2F2');
  expect(calls[0].options.method).toBe('GET');
  expect(calls[0].options.signal).toBe(controller.signal);
});

test('clamps page size to the existing API limit and rejects invalid sizes safely', async () => {
  await fetchVideoFeedPage({ limit: 1000 });
  await fetchVideoFeedPage({ limit: Number.NaN });

  expect(calls[0].path).toBe('/contents?type=video&limit=50');
  expect(calls[1].path).toBe('/contents?type=video&limit=12');
});
