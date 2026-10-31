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

test('never forwards a session token to the public media delivery hosts', () => {
  expect(resolveNativeMediaSource('https://img.luckread.com/photo.webp', 'session-secret')).toEqual({
    uri: 'https://img.luckread.com/photo.webp',
  });
  expect(resolveNativeMediaSource('/api/media/file/photo.webp', 'session-secret')).toEqual({
    uri: 'https://api.luckread.com/api/media/file/photo.webp',
    headers: { Authorization: 'Bearer session-secret' },
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
