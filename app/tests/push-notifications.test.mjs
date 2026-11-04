import { beforeEach, expect, mock, test } from 'bun:test';

const calls = [];
const events = [];
const secureValues = new Map();
const permissionState = {
  current: { status: 'undetermined', canAskAgain: true },
  requested: { status: 'granted', canAskAgain: false },
};
let pushToken = 'ExponentPushToken[abcdefghijklmnop_1234567890]';
let apiStatus = 200;

mock.module('expo-constants', () => ({
  default: {
    expoConfig: { version: '1.0.0', extra: { eas: { projectId: '123e4567-e89b-42d3-a456-426614174000' } } },
    easConfig: { projectId: '123e4567-e89b-42d3-a456-426614174000' },
  },
}));

mock.module('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  getPermissionsAsync: async () => ({ ...permissionState.current }),
  requestPermissionsAsync: async () => {
    events.push('request-permissions');
    permissionState.current = { ...permissionState.requested };
    return { ...permissionState.current };
  },
  setNotificationChannelAsync: async () => {
    events.push('create-android-channel');
  },
  getExpoPushTokenAsync: async ({ projectId }) => {
    events.push('get-expo-token:' + projectId);
    return { data: pushToken };
  },
}));

mock.module('expo-secure-store', () => ({
  WHEN_UNLOCKED: 'WHEN_UNLOCKED',
  getItemAsync: async (key) => secureValues.get(key) ?? null,
  setItemAsync: async (key, value) => { secureValues.set(key, value); },
  deleteItemAsync: async (key) => { secureValues.delete(key); },
}));

mock.module('react-native', () => ({
  Platform: { OS: 'android' },
}));

mock.module('../lib/api-client.ts', () => ({
  apiRequest: async (path, options) => {
    calls.push({ path, options });
    return {
      response: { ok: apiStatus >= 200 && apiStatus < 300, status: apiStatus },
      data: null,
      error: apiStatus >= 400 ? { message: 'API request failed' } : null,
    };
  },
}));

const {
  getDevicePushPermission,
  requestDevicePushPermission,
  syncPushEndpointForAuthenticatedUser,
  unregisterPushEndpointForUser,
} = await import('../lib/push-notifications.ts');

beforeEach(() => {
  calls.length = 0;
  events.length = 0;
  secureValues.clear();
  permissionState.current = { status: 'undetermined', canAskAgain: true };
  permissionState.requested = { status: 'granted', canAskAgain: false };
  pushToken = 'ExponentPushToken[abcdefghijklmnop_1234567890]';
  apiStatus = 200;
});

test('app resume never prompts when notification permission is undetermined', async () => {
  const result = await syncPushEndpointForAuthenticatedUser('user-1');

  expect(result).toBe('not-requested');
  expect(events).toEqual([]);
  expect(calls).toHaveLength(0);
});

test('explicit enable action creates the Android channel before asking permission and registers the Expo token', async () => {
  const result = await requestDevicePushPermission('user-1');

  expect(result).toBe('enabled');
  expect(events[0]).toBe('create-android-channel');
  expect(events[1]).toBe('request-permissions');
  expect(events[2]).toContain('get-expo-token:123e4567-e89b-42d3-a456-426614174000');
  expect(calls).toHaveLength(1);
  expect(calls[0].options.method).toBe('PUT');
  expect(calls[0].path).toMatch(/^\/push\/endpoints\/[0-9a-f-]{36}$/i);

  const body = JSON.parse(calls[0].options.body);
  expect(body.platform).toBe('android');
  expect(body.permissionStatus).toBe('granted');
  expect(body.expoPushToken).toBe(pushToken);
  expect(body.appVersion).toBe('1.0.0');

  const key = 'luckread.native.push-installation.user-1';
  const firstId = secureValues.get(key);
  expect(firstId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

  permissionState.current = { status: 'granted', canAskAgain: false };
  await syncPushEndpointForAuthenticatedUser('user-1');
  expect(calls[1].path).toBe(calls[0].path);
});

test('denied permission clears an existing endpoint without requesting permission again', async () => {
  secureValues.set('luckread.native.push-installation.user-1', '123e4567-e89b-42d3-a456-426614174000');
  permissionState.current = { status: 'denied', canAskAgain: false };

  const result = await syncPushEndpointForAuthenticatedUser('user-1');

  expect(result).toBe('denied');
  expect(events).toEqual([]);
  expect(calls).toHaveLength(1);
  const body = JSON.parse(calls[0].options.body);
  expect(body.permissionStatus).toBe('denied');
  expect(body.expoPushToken).toBeNull();
});

test('permanently denied permission directs the user to system settings and clears any stale token', async () => {
  secureValues.set('luckread.native.push-installation.user-1', '123e4567-e89b-42d3-a456-426614174000');
  permissionState.current = { status: 'denied', canAskAgain: false };

  const result = await requestDevicePushPermission('user-1');

  expect(result).toBe('settings-required');
  expect(events).toEqual([]);
  expect(calls).toHaveLength(1);
  expect(JSON.parse(calls[0].options.body).expoPushToken).toBeNull();
});

test('logout deletes only the current account installation endpoint and clears its local correlation id', async () => {
  secureValues.set('luckread.native.push-installation.user-1', '123e4567-e89b-42d3-a456-426614174000');
  secureValues.set('luckread.native.push-installation.user-2', '123e4567-e89b-42d3-a456-426614174001');

  await unregisterPushEndpointForUser('user-1');

  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/push/endpoints/123e4567-e89b-42d3-a456-426614174000');
  expect(calls[0].options.method).toBe('DELETE');
  expect(secureValues.has('luckread.native.push-installation.user-1')).toBe(false);
  expect(secureValues.has('luckread.native.push-installation.user-2')).toBe(true);
});

test('API errors are not reported as successful registration', async () => {
  apiStatus = 503;
  await expect(requestDevicePushPermission('user-1')).rejects.toThrow('API request failed');
});
