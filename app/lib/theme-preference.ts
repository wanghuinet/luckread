export type ThemePreference = 'light' | 'dark' | 'system';

export const THEME_PREFERENCE_KEY = 'luckread.theme-preference';

export function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}
