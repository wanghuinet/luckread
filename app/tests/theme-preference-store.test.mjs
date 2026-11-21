import { expect, mock, test } from 'bun:test';

let storedPreference = 'dark';
let readCount = 0;
let failWrites = false;

mock.module('expo-secure-store', () => ({
  getItemAsync: async (key) => {
    expect(key).toBe('luckread.theme-preference');
    readCount += 1;
    return storedPreference;
  },
  setItemAsync: async (key, value) => {
    expect(key).toBe('luckread.theme-preference');
    if (failWrites) throw new Error('secure store unavailable');
    storedPreference = value;
  },
}));

const { useThemePreferenceStore } = await import('../lib/theme-preference-store.ts');

test('hydrates a saved appearance preference once for the whole app', async () => {
  await Promise.all([
    useThemePreferenceStore.getState().hydrate(),
    useThemePreferenceStore.getState().hydrate(),
  ]);

  expect(readCount).toBe(1);
  expect(useThemePreferenceStore.getState().preference).toBe('dark');
  expect(useThemePreferenceStore.getState().hydrated).toBe(true);
});

test('persists preference changes through the shared settings store', async () => {
  const saved = await useThemePreferenceStore.getState().savePreference('light');

  expect(saved).toBe(true);
  expect(storedPreference).toBe('light');
  expect(useThemePreferenceStore.getState().preference).toBe('light');
  expect(useThemePreferenceStore.getState().saving).toBe(false);
  expect(useThemePreferenceStore.getState().error).toBeNull();
});

test('rolls back an appearance change when secure persistence fails', async () => {
  failWrites = true;
  const saved = await useThemePreferenceStore.getState().savePreference('system');
  failWrites = false;

  expect(saved).toBe(false);
  expect(storedPreference).toBe('light');
  expect(useThemePreferenceStore.getState().preference).toBe('light');
  expect(useThemePreferenceStore.getState().saving).toBe(false);
  expect(useThemePreferenceStore.getState().error).toContain('保存外观设置失败');
});
