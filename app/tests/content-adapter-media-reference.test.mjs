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

const { resolveNativeMediaSource } = await import('../lib/content-adapter.ts');

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

test('forwards session credentials only to the configured API and approved media delivery hosts', () => {
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
  expect(resolveNativeMediaSource('https://cdn.example.org/photo.webp', 'session-secret')).toBeNull();
});
