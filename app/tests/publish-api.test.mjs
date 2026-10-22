import { afterEach, beforeEach, expect, mock, test } from 'bun:test';

const calls = [];
let nextResult;
const originalFormData = globalThis.FormData;

mock.module('../lib/api-client.ts', () => ({
  apiRequest: async (path, options) => {
    calls.push({ path, options });
    return nextResult;
  },
  createIdempotencyKey: () => 'generated-idempotency-key',
  getApiBaseUrl: () => 'https://luckread.com',
  getApiErrorMessage: (_data, fallback) => fallback,
}));

const {
  getMediaPlayback,
  normalizeUploadedMedia,
  uploadMediaFile,
  uploadTextBody,
} = await import('../lib/publish-api.ts');

beforeEach(() => {
  calls.length = 0;
  nextResult = {
    response: new Response('{}', { status: 201 }),
    data: { doc: { id: 'media-1', url: 'https://assets.luckread.com/media-1.png', filename: 'photo.png', mimeType: 'image/png', filesize: 42 } },
    error: null,
  };
});

afterEach(() => {
  globalThis.FormData = originalFormData;
});

test('uploads a selected file as multipart and reuses its supplied idempotency key', async () => {
  const result = await uploadMediaFile({
    uri: 'content://device/cache/photo.png',
    name: 'photo.png',
    mimeType: 'image/png',
    size: 42,
  }, 'upload-retry-key');

  expect(result.id).toBe('media-1');
  expect(result.url).toBe('https://assets.luckread.com/media-1.png');
  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/media');
  expect(calls[0].options.method).toBe('POST');
  expect(calls[0].options.idempotencyKey).toBe('upload-retry-key');
  expect(calls[0].options.headers['X-LuckRead-Upload-Fingerprint']).toMatch(/^lr-up1-[a-f0-9]{16}$/);
  expect(calls[0].options.body instanceof FormData).toBe(true);
  expect(calls[0].options.body.get('_payload')).toContain('photo.png');
  expect(calls[0].options.body.get('file')).toBeTruthy();
});

test('rejects local temporary paths returned as media URLs', () => {
  expect(normalizeUploadedMedia({
    doc: { id: 'media-2', url: 'content://device/cache/photo.png' },
  })).toBeNull();
  expect(normalizeUploadedMedia({
    doc: { id: 'media-2', url: 'file:///cache/photo.png' },
  })).toBeNull();
});

test('uploads text body through Payload media so content receives a permanent bodyRef', async () => {
  const result = await uploadTextBody('Hello LuckRead', 'body-retry-key');

  expect(result.url).toBe('https://assets.luckread.com/media-1.png');
  expect(calls[0].path).toBe('/media');
  expect(calls[0].options.idempotencyKey).toBe('body-retry-key');
  expect(calls[0].options.headers['X-LuckRead-Upload-Fingerprint']).toMatch(/^lr-up1-[a-f0-9]{16}$/);
  expect(calls[0].options.body.get('_payload')).toContain('.txt');
  expect(calls[0].options.body.get('file')).toBeInstanceOf(Blob);
});

test('resolves playback from the server using the media ID', async () => {
  nextResult = {
    response: new Response('{}', { status: 200 }),
    data: { id: 'media-99', url: 'https://assets.luckread.com/clip.mp4', mimeType: 'video/mp4', filename: 'clip.mp4', filesize: 99, status: 'READY' },
    error: null,
  };
  const playback = await getMediaPlayback('media-99');

  expect(calls[0].path).toBe('/media/media-99/playback');
  expect(calls[0].options.method).toBe('GET');
  expect(playback.url).toBe('https://assets.luckread.com/clip.mp4');
  expect(playback.status).toBe('READY');
});

test('surfaces upload errors without pretending the media was saved', async () => {
  nextResult = {
    response: new Response('{}', { status: 503 }),
    data: { error: { message: 'Media store unavailable' } },
    error: { status: 503 },
  };
  await expect(uploadMediaFile({
    uri: 'content://device/cache/photo.png',
    name: 'photo.png',
    mimeType: 'image/png',
  }, 'retry-key')).rejects.toThrow('Media upload failed. Please retry.');
});


test('uses the same upload fingerprint for the same file retry and a different fingerprint for changed metadata', async () => {
  const file = {
    uri: 'content://device/cache/retry-photo.png',
    name: 'retry-photo.png',
    mimeType: 'image/png',
    size: 42,
  };
  await uploadMediaFile(file, 'same-upload-key');
  const first = calls[0].options.headers['X-LuckRead-Upload-Fingerprint'];

  await uploadMediaFile(file, 'same-upload-key');
  const replay = calls[1].options.headers['X-LuckRead-Upload-Fingerprint'];

  await uploadMediaFile({ ...file, size: 43 }, 'same-upload-key');
  const changed = calls[2].options.headers['X-LuckRead-Upload-Fingerprint'];

  expect(first).toBe(replay);
  expect(changed).not.toBe(first);
});
