import { readFileSync } from 'node:fs';
import { beforeEach, expect, mock, test } from 'bun:test';

const calls = [];
let respond = async () => ({
  response: { ok: true, status: 200 },
  data: { data: { follow: true, like: true, comment: true, mention: true } },
  error: null,
});

mock.module('../lib/api-client.ts', () => ({
  apiRequest: async (path, options) => {
    calls.push({ path, options });
    return respond(path, options);
  },
  getApiErrorMessage: (data, fallback) => data?.error?.message || fallback,
}));

const {
  NotificationPreferencesApiError,
  fetchNotificationPreferences,
  saveNotificationPreferences,
} = await import('../lib/notification-preferences-api.ts');

beforeEach(() => {
  calls.length = 0;
  respond = async () => ({
    response: { ok: true, status: 200 },
    data: { data: { follow: true, like: true, comment: true, mention: true } },
    error: null,
  });
});

test('loads all four canonical preferences and forwards cancellation', async () => {
  const controller = new AbortController();
  await expect(fetchNotificationPreferences(controller.signal)).resolves.toEqual({
    follow: true,
    like: true,
    comment: true,
    mention: true,
  });
  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/notification-preferences');
  expect(calls[0].options.method).toBe('GET');
  expect(calls[0].options.signal).toBe(controller.signal);
});

test('saves the complete settings payload and uses the server response as canonical state', async () => {
  respond = async (path, options) => {
    expect(path).toBe('/notification-preferences');
    expect(options.method).toBe('PATCH');
    expect(JSON.parse(options.body)).toEqual({
      follow: false,
      like: true,
      comment: false,
      mention: true,
    });
    return {
      response: { ok: true, status: 200 },
      data: { data: { follow: false, like: true, comment: false, mention: true } },
      error: null,
    };
  };

  await expect(saveNotificationPreferences({
    follow: false,
    like: true,
    comment: false,
    mention: true,
  })).resolves.toEqual({
    follow: false,
    like: true,
    comment: false,
    mention: true,
  });
  expect(calls).toHaveLength(1);
});

test('preserves authentication errors rather than silently applying defaults', async () => {
  respond = async () => ({
    response: { ok: false, status: 401 },
    data: { error: { code: 'UNAUTHENTICATED', message: 'Sign in to manage preferences.' } },
    error: { status: 401, code: 'UNAUTHENTICATED', message: 'Sign in to manage preferences.' },
  });
  await expect(fetchNotificationPreferences()).rejects.toMatchObject({
    name: 'NotificationPreferencesApiError',
    status: 401,
    code: 'UNAUTHENTICATED',
    message: 'Sign in to manage preferences.',
  });
});

test('rejects incomplete server payloads and failed saves', async () => {
  respond = async () => ({
    response: { ok: true, status: 200 },
    data: { data: { follow: true, like: true, comment: false } },
    error: null,
  });
  await expect(fetchNotificationPreferences()).rejects.toThrow(
    'The notification preferences response was invalid.',
  );

  respond = async () => ({
    response: { ok: false, status: 503 },
    data: { error: { code: 'SERVICE_UNAVAILABLE', message: 'Social service unavailable.' } },
    error: { status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Social service unavailable.' },
  });
  await expect(saveNotificationPreferences({
    follow: true,
    like: false,
    comment: true,
    mention: false,
  })).rejects.toBeInstanceOf(NotificationPreferencesApiError);
});

test('does not request the API for an invalid runtime preference payload', async () => {
  await expect(saveNotificationPreferences({
    follow: true,
    like: 'false',
    comment: true,
    mention: false,
  })).rejects.toThrow('Every notification preference must be a boolean.');
  expect(calls).toHaveLength(0);
});

test('connects the native screen to the four preference API operations and drawer entry', () => {
  const screen = readFileSync(new URL('../app/(drawer)/notification-preferences.tsx', import.meta.url), 'utf8');
  const drawer = readFileSync(new URL('../app/(drawer)/_layout.tsx', import.meta.url), 'utf8');
  expect(screen).toContain('fetchNotificationPreferences');
  expect(screen).toContain('saveNotificationPreferences');
  expect(screen).toContain("key: 'follow'");
  expect(screen).toContain("key: 'like'");
  expect(screen).toContain("key: 'comment'");
  expect(screen).toContain("key: 'mention'");
  expect(drawer).toContain("router.push('/notification-preferences'");
});
