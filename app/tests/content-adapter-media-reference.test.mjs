import { expect, mock, test } from 'bun:test';

mock.module('../lib/api-client.ts', () => ({
  getApiBaseUrl: () => 'https://api.luckread.com',
  apiRequest: async () => {
    throw new Error('Unexpected API request in media-reference test');
  },
  fetchContentBodyReference: async () => {
    throw new Error('Unexpected body fetch in media-reference test');
  },
}));

const { mapContentToFeedContent, resolveNativeMediaSource } = await import('../lib/content-adapter.ts');

test('resolves same-origin media paths through the configured W01 API origin', () => {
  expect(resolveNativeMediaSource('/api/media/file/photo.webp')).toEqual({
    uri: 'https://api.luckread.com/api/media/file/photo.webp',
  });
});

test('accepts only the approved image and video delivery hosts for off-origin media', () => {
  expect(resolveNativeMediaSource('https://img.luckread.com/users/1/photo.webp')?.uri)
    .toBe('https://img.luckread.com/users/1/photo.webp');
  expect(resolveNativeMediaSource('https://video.luckread.com/users/1/clip.mp4?token=short-lived')?.uri)
    .toBe('https://video.luckread.com/users/1/clip.mp4?token=short-lived');
});

test('does not resolve arbitrary external, lookalike, or protocol-relative media URLs', () => {
  expect(resolveNativeMediaSource('https://cdn.example.org/photo.webp')).toBeNull();
  expect(resolveNativeMediaSource('https://img.luckread.com.example.org/photo.webp')).toBeNull();
  expect(resolveNativeMediaSource('https://video.luckread.com:8443/clip.mp4')).toBeNull();
  expect(resolveNativeMediaSource('http://img.luckread.com/photo.webp')).toBeNull();
  expect(resolveNativeMediaSource('//img.luckread.com/photo.webp')).toBeNull();
  expect(resolveNativeMediaSource('r2://private-bucket/photo.webp')).toBeNull();
});

test('rejects embedded credentials and URL fragments for off-origin media', () => {
  expect(resolveNativeMediaSource('https://user:pass@img.luckread.com/photo.webp')).toBeNull();
  expect(resolveNativeMediaSource('https://video.luckread.com/clip.mp4#fragment')).toBeNull();
});

test('forwards a session token only to the W01 API and first-party media delivery hosts', () => {
  expect(resolveNativeMediaSource('https://img.luckread.com/photo.webp', 'session-secret')).toEqual({
    uri: 'https://img.luckread.com/photo.webp',
    headers: { Authorization: 'Bearer session-secret' },
  });
  expect(resolveNativeMediaSource('https://video.luckread.com/clip.mp4', 'session-secret')).toEqual({
    uri: 'https://video.luckread.com/clip.mp4',
    headers: { Authorization: 'Bearer session-secret' },
  });
  expect(resolveNativeMediaSource('/api/media/file/photo.webp', 'session-secret')).toEqual({
    uri: 'https://api.luckread.com/api/media/file/photo.webp',
    headers: { Authorization: 'Bearer session-secret' },
  });
  expect(resolveNativeMediaSource('https://img.luckread.com/photo.webp')).toEqual({
    uri: 'https://img.luckread.com/photo.webp',
  });
});

test('maps counts with the same non-negative integer normalization used by detail summaries', () => {
  const item = mapContentToFeedContent({
    id: 'count-normalization-post',
    counts: {
      likes: '-1',
      retweets: '4.9',
      comments: 'not-a-count',
      replies: '3',
      views: 0,
      favorites: Number.POSITIVE_INFINITY,
    },
    likeCount: 7,
    saveCount: 5,
  });

  expect(item.like_count).toBe(7);
  expect(item.retweet_count).toBe(4);
  expect(item.reply_count).toBe(3);
  expect(item.view_count).toBe('0');
  expect(item.save_count).toBe(5);
});


test('public multi-image posts use anonymous delivery and do not attach a bearer token', () => {
  const mapped = mapContentToFeedContent(
    {
      id: 'public-gallery-post',
      accessMode: 'PUBLIC',
      mediaRefs: [
        'https://img.luckread.com/users/1/first.webp',
        'https://img.luckread.com/users/1/second.webp',
      ],
    },
    undefined,
    null,
    null,
    'session-secret',
  );

  expect(mapped.media_items).toHaveLength(2);
  expect(mapped.media_items?.map((media) => media.src)).toEqual([
    'https://img.luckread.com/users/1/first.webp',
    'https://img.luckread.com/users/1/second.webp',
  ]);
  expect(mapped.media_items?.every((media) => media.headers === undefined)).toBe(true);
  expect(mapped.media_items?.every((media) => media.requiresAuthentication !== true)).toBe(true);
});

test('entitled member-only images retain the W02 bearer header for the authenticated viewer', () => {
  const mapped = mapContentToFeedContent(
    {
      id: 'member-gallery-post',
      accessMode: 'MEMBERS_ONLY',
      accessGranted: true,
      mediaRefs: [
        'https://img.luckread.com/members/creator/first.webp',
        'https://img.luckread.com/members/creator/second.webp',
      ],
    },
    undefined,
    null,
    null,
    'member-session-secret',
  );

  expect(mapped.media_items).toHaveLength(2);
  expect(mapped.media_items?.every((media) => media.requiresAuthentication === true)).toBe(true);
  expect(mapped.media_items?.every((media) => media.headers?.Authorization === 'Bearer member-session-secret')).toBe(true);
});

test('unentitled member-only content never exposes its media references to the native gallery', () => {
  const mapped = mapContentToFeedContent(
    {
      id: 'locked-gallery-post',
      accessMode: 'MEMBERS_ONLY',
      accessGranted: false,
      mediaRefs: ['https://img.luckread.com/members/creator/locked.webp'],
    },
    undefined,
    null,
    null,
    'non-member-session-secret',
  );

  expect(mapped.media_items).toEqual([]);
});


test('maps the creator media warning for public posts', () => {
  const mapped = mapContentToFeedContent({
    id: 'warning-public-post',
    contentType: 'post',
    accessMode: 'PUBLIC',
    accessGranted: true,
    mediaWarning: 'VIOLENCE',
    mediaRefs: ['https://img.luckread.com/users/1/scene.webp'],
  });
  expect(mapped.mediaWarning).toBe('VIOLENCE');
});

test('does not expose a media warning for an unentitled member-only preview', () => {
  const mapped = mapContentToFeedContent({
    id: 'warning-locked-post',
    contentType: 'post',
    accessMode: 'MEMBERS_ONLY',
    accessGranted: false,
    mediaWarning: 'NUDITY',
    mediaRefs: ['https://img.luckread.com/members/creator/locked.webp'],
  });
  expect(mapped.mediaWarning).toBeNull();
  expect(mapped.media_items).toEqual([]);
});
