import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

import {
  isThemePreference,
  THEME_PREFERENCE_KEY,
  type ThemePreference,
} from './theme-preference';

type ThemePreferenceState = {
  preference: ThemePreference;
  hydrated: boolean;
  saving: boolean;
  error: string | null;
  hydrate: () => Promise<void>;
  savePreference: (preference: ThemePreference) => Promise<boolean>;
};

let hydrationTask: Promise<void> | null = null;

export const useThemePreferenceStore = create<ThemePreferenceState>((set, get) => ({
  preference: 'system',
  hydrated: false,
  saving: false,
  error: null,

  hydrate: () => {
    if (get().hydrated) return Promise.resolve();
    if (hydrationTask) return hydrationTask;

    hydrationTask = (async () => {
      try {
        const savedPreference = await SecureStore.getItemAsync(THEME_PREFERENCE_KEY);
        set({
          preference: isThemePreference(savedPreference) ? savedPreference : 'system',
          hydrated: true,
          error: null,
        });
      } catch {
        // The app must remain usable when the platform secure store is unavailable.
        set({
          preference: 'system',
          hydrated: true,
          error: '无法读取已保存的外观设置，当前暂用跟随系统。',
        });
      } finally {
        hydrationTask = null;
      }
    })();

    return hydrationTask;
  },

  savePreference: async (preference) => {
    if (get().saving) return false;
    if (!get().hydrated) await get().hydrate();
    if (get().saving) return false;

    const previousPreference = get().preference;
    set({ preference, saving: true, error: null });

    try {
      await SecureStore.setItemAsync(THEME_PREFERENCE_KEY, preference);
      set({ hydrated: true, saving: false, error: null });
      return true;
    } catch {
      // Do not present a preference as saved when it cannot survive an app restart.
      set({
        preference: previousPreference,
        hydrated: true,
        saving: false,
        error: '保存外观设置失败，请检查设备存储后重试。',
      });
      return false;
    }
  },
}));
