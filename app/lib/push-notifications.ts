import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { apiRequest } from './api-client';

export type PushPermissionStatus = 'granted' | 'denied' | 'undetermined';

export type DevicePushPermission = Readonly<{
  supported: boolean;
  status: PushPermissionStatus;
  canAskAgain: boolean;
}>;

export type PushRegistrationResult =
  | 'enabled'
  | 'denied'
  | 'settings-required'
  | 'not-requested'
  | 'unsupported';

const INSTALLATION_KEY_PREFIX = 'luckread.native.push-installation.';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EAS_PROJECT_ID_PATTERN = UUID_PATTERN;

function nativePlatform(): 'ios' | 'android' | null {
  if (Platform.OS === 'ios' || Platform.OS === 'android') return Platform.OS;
  return null;
}

function accountInstallationKey(userId: string): string {
  const normalized = userId.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(normalized)) {
    throw new TypeError('A valid authenticated LuckRead account is required.');
  }
  return INSTALLATION_KEY_PREFIX + normalized;
}

function createInstallationUuid(): string {
  const bytes = new Uint8Array(16);
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.getRandomValues === 'function') {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

async function readInstallationId(userId: string): Promise<string | null> {
  const value = await SecureStore.getItemAsync(accountInstallationKey(userId));
  return value && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

async function getOrCreateInstallationId(userId: string): Promise<string> {
  const key = accountInstallationKey(userId);
  const existing = await SecureStore.getItemAsync(key);
  if (existing && UUID_PATTERN.test(existing)) return existing.toLowerCase();

  const installationId = createInstallationUuid();
  await SecureStore.setItemAsync(key, installationId, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED,
  });
  return installationId;
}

function expoProjectId(): string {
  const candidate = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (typeof candidate !== 'string' || !EAS_PROJECT_ID_PATTERN.test(candidate)) {
    throw new Error('Push notifications are not configured for this LuckRead build.');
  }
  return candidate;
}

function currentAppVersion(): string | undefined {
  const version = Constants.expoConfig?.version;
  return typeof version === 'string' && /^[A-Za-z0-9.+_-]{1,64}$/.test(version)
    ? version
    : undefined;
}

async function writePushEndpoint(
  userId: string,
  permissionStatus: PushPermissionStatus,
  expoPushToken: string | null,
  installationId?: string,
): Promise<void> {
  const platform = nativePlatform();
  if (!platform) return;

  const resolvedInstallationId = installationId ?? await getOrCreateInstallationId(userId);
  const appVersion = currentAppVersion();
  const result = await apiRequest<unknown>(
    '/push/endpoints/' + encodeURIComponent(resolvedInstallationId),
    {
      method: 'PUT',
      body: JSON.stringify({
        platform,
        permissionStatus,
        expoPushToken,
        ...(appVersion ? { appVersion } : {}),
      }),
    },
  );

  if (!result.response.ok) {
    throw new Error(result.error?.message || 'Could not register this device for LuckRead notifications.');
  }
}

async function disableExistingPushEndpoint(userId: string): Promise<void> {
  const installationId = await readInstallationId(userId);
  if (!installationId) return;
  await writePushEndpoint(userId, 'denied', null, installationId);
}

async function registerGrantedPushEndpoint(userId: string): Promise<void> {
  const tokenResult = await Notifications.getExpoPushTokenAsync({
    projectId: expoProjectId(),
  });
  const token = typeof tokenResult.data === 'string' ? tokenResult.data.trim() : '';
  if (!token) throw new Error('Expo did not return a push token for this device.');
  await writePushEndpoint(userId, 'granted', token);
}

export async function getDevicePushPermission(): Promise<DevicePushPermission> {
  if (!nativePlatform()) {
    return { supported: false, status: 'undetermined', canAskAgain: false };
  }
  const permission = await Notifications.getPermissionsAsync();
  const status: PushPermissionStatus = permission.status === 'granted'
    ? 'granted'
    : permission.status === 'denied'
      ? 'denied'
      : 'undetermined';
  return {
    supported: true,
    status,
    canAskAgain: permission.canAskAgain !== false,
  };
}

/**
 * Reconcile permission and token state without ever opening a permission prompt.
 * Called after authentication and when the app returns to the foreground.
 */
export async function syncPushEndpointForAuthenticatedUser(
  userId: string,
): Promise<PushRegistrationResult> {
  if (!nativePlatform()) return 'unsupported';

  const permission = await getDevicePushPermission();
  if (permission.status === 'undetermined') return 'not-requested';

  if (permission.status === 'denied') {
    await disableExistingPushEndpoint(userId);
    return 'denied';
  }

  await registerGrantedPushEndpoint(userId);
  return 'enabled';
}

/**
 * Called only by an explicit user action in Notification Settings.
 */
export async function requestDevicePushPermission(
  userId: string,
): Promise<PushRegistrationResult> {
  const platform = nativePlatform();
  if (!platform) return 'unsupported';

  if (platform === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#1d9bf0',
    });
  }

  let permission = await Notifications.getPermissionsAsync();
  if (permission.status !== 'granted' && permission.canAskAgain !== false) {
    permission = await Notifications.requestPermissionsAsync();
  }

  if (permission.status === 'granted') {
    await registerGrantedPushEndpoint(userId);
    return 'enabled';
  }

  if (permission.status === 'denied') {
    await disableExistingPushEndpoint(userId);
    return permission.canAskAgain === false ? 'settings-required' : 'denied';
  }

  return 'not-requested';
}

/**
 * Best-effort removal before logout. A separate installation UUID is kept per
 * account so one account can never take over another account's endpoint row.
 */
export async function unregisterPushEndpointForUser(userId: string): Promise<void> {
  const key = accountInstallationKey(userId);
  const installationId = await readInstallationId(userId);
  if (!installationId) return;

  const result = await apiRequest<unknown>(
    '/push/endpoints/' + encodeURIComponent(installationId),
    { method: 'DELETE' },
  );
  if (!result.response.ok) {
    throw new Error(result.error?.message || 'Could not unregister this device from LuckRead notifications.');
  }
  await SecureStore.deleteItemAsync(key);
}
