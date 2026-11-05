import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const drawer = readFileSync(new URL('../app/(drawer)/_layout.tsx', import.meta.url), 'utf8');
const screen = readFileSync(new URL('../app/(drawer)/settings.tsx', import.meta.url), 'utf8');
const root = readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
const themeStore = readFileSync(new URL('../lib/theme-preference-store.ts', import.meta.url), 'utf8');

test('registers one discoverable Settings & privacy route from the main drawer', () => {
  expect(drawer).toContain('label="设置与隐私"');
  expect(drawer).toContain("router.push('/settings' as never)");
  expect(drawer).toContain('<Drawer.Screen name="settings"');
});

test('settings home links only to existing profile, notification and block/mute destinations', () => {
  expect(screen).toContain("router.push('/profile' as never)");
  expect(screen).toContain("router.push('/notification-preferences' as never)");
  expect(screen).toContain("router.push('/blocked-muted' as never)");
  expect(screen).not.toContain('showUnavailable');
  expect(screen).not.toContain('TODO');
});

test('uses one shared persisted light, dark and system preference across the app', () => {
  expect(screen).toContain('useThemePreferenceStore');
  expect(screen).toContain('value={themeLabel}');
  expect(screen).toContain('value="light"');
  expect(screen).toContain('value="dark"');
  expect(screen).toContain('value="system"');
  expect(screen).toContain('saveThemePreference(preference)');
  expect(screen).not.toContain('SecureStore');
  expect(root).toContain('hydrateThemePreference()');
  expect(root).toContain('setColorScheme(themePreference)');
  expect(root).not.toContain('getItemAsync(THEME_PREFERENCE_KEY)');
  expect(themeStore).toContain('SecureStore.getItemAsync(THEME_PREFERENCE_KEY)');
  expect(themeStore).toContain('SecureStore.setItemAsync(THEME_PREFERENCE_KEY, preference)');
  expect(themeStore).toContain('保存外观设置失败');
  expect(drawer).not.toContain('夜间模式设置');
});

test('keeps settings navigation usable in both app color schemes with screen-reader labels', () => {
  expect(screen).toContain('dark:bg-black');
  expect(screen).toContain('accessibilityRole="button"');
  expect(screen).toContain('accessibilityHint={description}');
  expect(screen).toContain('accessibilityState={{ selected, disabled }}');
  expect(screen).toContain('accessibilityRole="alert"');
});
