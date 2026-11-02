import { beforeEach, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { settleVideoFeedEnrichment } from '../lib/video-feed-enrichment.ts';

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


test('isolates a rejected optional video enrichment without losing other results', async () => {
  const fallbackSocial = { counts: { likes: 3 } };
  const fallbackAuthor = { username: 'creator' };

  const result = await settleVideoFeedEnrichment(
    {
      body: async () => { throw new Error('body reference unavailable'); },
      social: async () => ({ counts: { likes: 9 } }),
      author: async () => { throw new Error('profile service unavailable'); },
      playback: async () => { throw new Error('playback authorization failed'); },
    },
    { social: fallbackSocial, author: fallbackAuthor },
  );

  expect(result.body).toBeUndefined();
  expect(result.social).toEqual({ counts: { likes: 9 } });
  expect(result.author).toBe(fallbackAuthor);
  expect(result.playback).toEqual({
    source: null,
    error: 'playback authorization failed',
  });
});

test('keeps list projections and reports unavailable media when social or author reads fail', async () => {
  const fallbackSocial = { counts: { likes: 4 } };
  const fallbackAuthor = { displayName: 'List projection author' };

  const result = await settleVideoFeedEnrichment(
    {
      body: async () => Promise.resolve('Video caption from body'),
      social: async () => { throw new Error('social summary unavailable'); },
      author: async () => { throw new Error('public profile unavailable'); },
      playback: async () => ({
        source: null,
        error: 'This video references private storage and has no public playback URL.',
      }),
    },
    { social: fallbackSocial, author: fallbackAuthor },
  );

  expect(result.body).toBe('Video caption from body');
  expect(result.social).toBe(fallbackSocial);
  expect(result.author).toBe(fallbackAuthor);
  expect(result.playback.source).toBeNull();
  expect(result.playback.error).toContain('private storage');
});

test('renders video list projections before asynchronous enrichment and settles each record independently', () => {
  const videoScreen = readFileSync(
    new URL('../app/(drawer)/(tabs)/(video)/video.tsx', import.meta.url),
    'utf8',
  );

  const projectionIndex = videoScreen.indexOf('const visibleItems = videoRecords.flatMap(');
  const enrichmentIndex = videoScreen.indexOf('const hydrationResults = await Promise.allSettled(');

  expect(projectionIndex).toBeGreaterThanOrEqual(0);
  expect(enrichmentIndex).toBeGreaterThan(projectionIndex);
  expect(videoScreen).toContain('mediaLoading: true');
  expect(videoScreen).toContain('mediaLoading: false');
  expect(videoScreen).toContain('settleVideoFeedEnrichment(');
  expect(videoScreen).toContain('useVideoPlayer(null');
  expect(videoScreen).toContain('player.replaceAsync(nextSource)');
  expect(videoScreen).toContain('loadedSource !== item.videoSource');
  expect(videoScreen).toContain('setItems((current) =>');
  expect(videoScreen).toContain('Video unavailable');
});
