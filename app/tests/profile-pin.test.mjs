import { beforeEach, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const calls = [];
let responseStatus = 200;
let responseData = { data: null };

mock.module('../lib/api-client.ts', () => ({
  apiRequest: async (path, options) => {
    calls.push({ path, options });
    return {
      response: new Response(null, { status: responseStatus }),
      data: responseData,
      error: responseStatus >= 400 ? { message: 'mock request failed' } : null,
    };
  },
  createIdempotencyKey: () => 'profile-pin-test-key',
  getApiErrorMessage: (_data, fallback) => fallback,
}));

const { getProfilePinSnapshot, refreshProfilePin, setProfilePin } = await import('../lib/profile-pin-state.ts');

beforeEach(() => {
  calls.length = 0;
  responseStatus = 200;
  responseData = { data: null };
});

test('loads the current profile pin through the public W01 route once', async () => {
  responseData = { data: { userId: 'pin-owner-load', contentId: 'older-post', pinnedAt: '2026-10-21T10:00:00.000Z' } };
  await refreshProfilePin('pin-owner-load');

  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/users/pin-owner-load/pinned-content');
  expect(calls[0].options).toMatchObject({ method: 'GET', auth: false });
  expect(getProfilePinSnapshot()).toMatchObject({
    userId: 'pin-owner-load',
    contentId: 'older-post',
    loaded: true,
    loading: false,
  });
});

test('pins and unpins using the canonical W01 endpoint and idempotency key', async () => {
  const pinned = await setProfilePin('pin-owner-write', 'post-123', true);
  expect(pinned.ok).toBe(true);
  expect(calls[0].path).toBe('/content/post-123/pin');
  expect(calls[0].options).toMatchObject({ method: 'POST', idempotencyKey: 'profile-pin-test-key' });
  expect(getProfilePinSnapshot()).toMatchObject({
    userId: 'pin-owner-write',
    contentId: 'post-123',
    loaded: true,
    pending: false,
  });

  const unpinned = await setProfilePin('pin-owner-write', 'post-123', false);
  expect(unpinned.ok).toBe(true);
  expect(calls[1].path).toBe('/content/post-123/pin');
  expect(calls[1].options).toMatchObject({ method: 'DELETE', idempotencyKey: 'profile-pin-test-key' });
  expect(getProfilePinSnapshot()).toMatchObject({
    userId: 'pin-owner-write',
    contentId: null,
    loaded: true,
    pending: false,
  });
});

test('preserves the existing pin when a pin write fails', async () => {
  responseData = { data: { userId: 'pin-owner-fail', contentId: 'existing-post', pinnedAt: '2026-10-21T10:00:00.000Z' } };
  await refreshProfilePin('pin-owner-fail');
  responseStatus = 403;

  const result = await setProfilePin('pin-owner-fail', 'other-post', true);
  expect(result).toMatchObject({ ok: false, status: 403 });
  expect(getProfilePinSnapshot()).toMatchObject({
    userId: 'pin-owner-fail',
    contentId: 'existing-post',
    loaded: true,
    pending: false,
  });
});

test('native profile and post menus expose the pin state and use the shared boundary', () => {
  const feedItem = readFileSync(new URL('../components/FeedItem.tsx', import.meta.url), 'utf8');
  const profile = readFileSync(new URL('../app/(drawer)/(tabs)/(index,search,messages,grok,video,notifications)/profile/[id].tsx', import.meta.url), 'utf8');
  const pinState = readFileSync(new URL('../lib/profile-pin-state.ts', import.meta.url), 'utf8');

  expect(feedItem).toContain('Pin to profile');
  expect(feedItem).toContain('Unpin from profile');
  expect(feedItem).toContain('setProfilePin(');
  expect(feedItem).toContain('isProfilePinned');
  expect(profile).toContain("'/users/' + encodeURIComponent(profile.id) + '/pinned-content'");
  expect(profile).toContain('isProfilePinned: true');
  expect(profile).toContain('pinnedPost');
  expect(pinState).not.toMatch(/\bfetch\s*\(/);
});
