import { afterEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const resolveAppConfig = require('../app.config.js');
const baseConfig = JSON.parse(
  readFileSync(new URL('../app.json', import.meta.url), 'utf8'),
).expo;

const envKeys = [
  'EXPO_PROJECT_ID',
  'EXPO_UPDATE_CHANNEL',
  'LUCKREAD_REQUIRE_OTA_CONFIG',
  'LUCKREAD_RUNTIME_VERSION',
];
const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]));

function resetEnv() {
  for (const key of envKeys) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(resetEnv);

test('enables EAS Update only with a valid project ID and binds the selected channel', () => {
  process.env.EXPO_PROJECT_ID = '00000000-0000-4000-8000-000000000001';
  process.env.EXPO_UPDATE_CHANNEL = 'preview';
  process.env.LUCKREAD_REQUIRE_OTA_CONFIG = '1';

  const config = resolveAppConfig({ config: baseConfig });

  expect(config.updates.enabled).toBe(true);
  expect(config.updates.url).toBe(
    'https://u.expo.dev/00000000-0000-4000-8000-000000000001',
  );
  expect(config.updates.requestHeaders['expo-channel-name']).toBe('preview');
  expect(config.runtimeVersion).toEqual({ policy: 'appVersion' });
  expect(config.extra.eas.projectId).toBe('00000000-0000-4000-8000-000000000001');
});

test('fails closed when a production build requires OTA but has no project ID', () => {
  delete process.env.EXPO_PROJECT_ID;
  process.env.LUCKREAD_REQUIRE_OTA_CONFIG = '1';

  expect(() => resolveAppConfig({ config: baseConfig })).toThrow(
    'OTA is required for this build',
  );
});

test('keeps local and pull-request builds OTA-disabled when no project ID is supplied', () => {
  delete process.env.EXPO_PROJECT_ID;
  delete process.env.LUCKREAD_REQUIRE_OTA_CONFIG;

  const config = resolveAppConfig({ config: baseConfig });

  expect(config.updates.enabled).toBe(false);
  expect(config.updates.url).toBeUndefined();
  expect(config.extra?.eas?.projectId).toBeUndefined();
});

test('allows an OTA publication to target the exact versionName embedded in a Beta APK', () => {
  process.env.EXPO_PROJECT_ID = '00000000-0000-4000-8000-000000000001';
  process.env.LUCKREAD_RUNTIME_VERSION = '1.0.0-beta.123';

  const config = resolveAppConfig({ config: baseConfig });

  expect(config.version).toBe('1.0.0-beta.123');
  expect(config.runtimeVersion).toEqual({ policy: 'appVersion' });
});

test('rejects malformed project IDs and runtime versions', () => {
  process.env.EXPO_PROJECT_ID = 'not-a-project-id';
  expect(() => resolveAppConfig({ config: baseConfig })).toThrow(
    'valid Expo EAS project UUID',
  );

  process.env.EXPO_PROJECT_ID = '00000000-0000-4000-8000-000000000001';
  process.env.LUCKREAD_RUNTIME_VERSION = 'latest';
  expect(() => resolveAppConfig({ config: baseConfig })).toThrow(
    'LUCKREAD_RUNTIME_VERSION must match',
  );
});
