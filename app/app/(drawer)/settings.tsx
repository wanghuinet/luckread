import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import { Stack, useRouter } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import { Image as ExpoImage } from 'expo-image';

import { isThemePreference, THEME_PREFERENCE_KEY, type ThemePreference } from '~/lib/theme-preference';
import { readVideoFeedAutoplayEnabled, writeVideoFeedAutoplayEnabled } from '~/lib/video-feed-autoplay-preference';
import { clearImageCaches } from '~/lib/image-cache-management';
import { useAuthStore } from '~/store/auth-store';

type SettingsRowProps = {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  description: string;
  value?: string;
  onPress: () => void;
  isDark: boolean;
  disabled?: boolean;
};

function SettingsRow({
  icon,
  title,
  description,
  value,
  onPress,
  isDark,
  disabled = false,
}: SettingsRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={description}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={disabled ? 'min-h-[72px] flex-row items-center px-4 py-3 opacity-60' : 'min-h-[72px] flex-row items-center px-4 py-3 active:bg-neutral-100 dark:active:bg-neutral-900'}
    >
      <View className="mr-3 h-10 w-10 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-900">
        <Feather name={icon} size={19} color={isDark ? '#d1d5db' : '#536471'} />
      </View>
      <View className="mr-2 flex-1">
        <Text className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">{title}</Text>
        <Text className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">{description}</Text>
      </View>
      {value ? (
        <Text className="mr-2 text-xs text-neutral-500 dark:text-neutral-400">{value}</Text>
      ) : null}
      <Feather name="chevron-right" size={19} color={isDark ? '#737373' : '#9ca3af'} />
    </Pressable>
  );
}


type SettingsSwitchRowProps = {
  title: string;
  description: string;
  value: boolean;
  disabled?: boolean;
  onValueChange: (value: boolean) => void;
  isDark: boolean;
};

function SettingsSwitchRow({
  title,
  description,
  value,
  disabled = false,
  onValueChange,
  isDark,
}: SettingsSwitchRowProps) {
  return (
    <View className="min-h-[72px] flex-row items-center px-4 py-3">
      <View className="mr-3 flex-1">
        <Text className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">{title}</Text>
        <Text className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">{description}</Text>
      </View>
      <Switch
        accessibilityLabel={title}
        accessibilityHint={description}
        accessibilityState={{ checked: value, disabled }}
        disabled={disabled}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: isDark ? '#404040' : '#d1d5db', true: '#1d9bf0' }}
        thumbColor={isDark ? '#f4f4f5' : '#ffffff'}
      />
    </View>
  );
}

function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View className="mx-4 mb-4 overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-black">
      <View className="px-4 pb-2 pt-4">
        <Text className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}

function ThemeModeOption({
  label,
  value,
  selected,
  onPress,
}: {
  label: string;
  value: ThemePreference;
  selected: boolean;
  onPress: (value: ThemePreference) => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={() => onPress(value)}
      className="min-h-[56px] flex-row items-center justify-between px-1"
    >
      <Text className="text-[16px] text-neutral-900 dark:text-neutral-100">{label}</Text>
      <View
        className={
          'h-6 w-6 items-center justify-center rounded-full border-2 ' +
          (selected ? 'border-sky-500' : 'border-neutral-400 dark:border-neutral-500')
        }
      >
        {selected ? <View className="h-3 w-3 rounded-full bg-sky-500" /> : null}
      </View>
    </Pressable>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colorScheme, setColorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const authStatus = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const [themePreference, setThemePreference] = useState<ThemePreference>('system');
  const [videoAutoPlayEnabled, setVideoAutoPlayEnabled] = useState(true);
  const [videoAutoPlayLoaded, setVideoAutoPlayLoaded] = useState(false);
  const [videoAutoPlaySaving, setVideoAutoPlaySaving] = useState(false);
  const [videoAutoPlayError, setVideoAutoPlayError] = useState('');
  const [imageCacheClearing, setImageCacheClearing] = useState(false);
  const [imageCacheError, setImageCacheError] = useState('');
  const imageCacheClearInFlight = useRef(false);
  const themeSheetRef = useRef<BottomSheetModal>(null);
  const themeSnapPoints = useMemo(() => ['36%'], []);

  useEffect(() => {
    let active = true;
    void SecureStore.getItemAsync(THEME_PREFERENCE_KEY)
      .then((savedPreference) => {
        if (active && isThemePreference(savedPreference)) setThemePreference(savedPreference);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void readVideoFeedAutoplayEnabled(SecureStore).then((enabled) => {
      if (!active) return;
      setVideoAutoPlayEnabled(enabled);
      setVideoAutoPlayLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const updateVideoAutoPlay = useCallback(async (enabled: boolean) => {
    if (!videoAutoPlayLoaded || videoAutoPlaySaving) return;
    setVideoAutoPlaySaving(true);
    setVideoAutoPlayError('');
    try {
      await writeVideoFeedAutoplayEnabled(SecureStore, enabled);
      setVideoAutoPlayEnabled(enabled);
    } catch {
      setVideoAutoPlayError('保存失败。此设备的视频自动播放设置未更改，请重试。');
    } finally {
      setVideoAutoPlaySaving(false);
    }
  }, [videoAutoPlayLoaded, videoAutoPlaySaving]);

  const confirmClearImageCache = useCallback(() => {
    if (imageCacheClearing || imageCacheClearInFlight.current) return;

    Alert.alert(
      '清理图片缓存',
      '将清除此设备中图片组件使用的内存和磁盘缓存。之后浏览图片时可能需要重新加载。不会删除原始媒体、发布草稿、待上传文件、视频缓存或账号数据。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '清理',
          style: 'destructive',
          onPress: () => {
            if (imageCacheClearInFlight.current) return;
            imageCacheClearInFlight.current = true;
            setImageCacheClearing(true);
            setImageCacheError('');
            void (async () => {
              try {
                const result = await clearImageCaches({
                  clearMemoryCache: () => ExpoImage.clearMemoryCache(),
                  clearDiskCache: () => ExpoImage.clearDiskCache(),
                });
                if (result.complete) {
                  Alert.alert('清理完成', '此设备的图片内存和磁盘缓存已清理。再次浏览图片时会重新加载。');
                  return;
                }

                const failedAreas: string[] = [];
                if (!result.memoryCacheCleared) failedAreas.push('内存');
                if (!result.diskCacheCleared) failedAreas.push('磁盘');
                setImageCacheError(
                  failedAreas.length === 2
                    ? '图片内存和磁盘缓存清理未能确认完成。请重试。'
                    : `图片${failedAreas[0]}缓存未能确认清除。请重试。`,
                );
              } catch {
                setImageCacheError('图片缓存清理失败。请检查应用状态后重试。');
              } finally {
                imageCacheClearInFlight.current = false;
                setImageCacheClearing(false);
              }
            })();
          },
        },
      ],
    );
  }, [imageCacheClearing]);

  const selectTheme = useCallback(async (preference: ThemePreference) => {
    setThemePreference(preference);
    setColorScheme(preference);
    try {
      await SecureStore.setItemAsync(THEME_PREFERENCE_KEY, preference);
    } catch {
      // The selected mode still applies for this session if secure storage is unavailable.
    }
    themeSheetRef.current?.dismiss();
  }, [setColorScheme]);

  const themeLabel = themePreference === 'light'
    ? '浅色'
    : themePreference === 'dark'
      ? '深色'
      : '跟随系统';

  return (
    <View className="flex-1 bg-neutral-50 dark:bg-black" style={{ paddingTop: insets.top }}>
      <Stack.Screen options={{ headerShown: false, title: '设置与隐私' }} />
      <View className="flex-row items-center border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-black">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回"
          onPress={() => router.back()}
          className="mr-3 h-10 w-10 items-center justify-center rounded-full"
        >
          <Feather name="arrow-left" size={22} color={isDark ? '#d1d5db' : '#536471'} />
        </Pressable>
        <View className="flex-1">
          <Text className="text-lg font-bold text-neutral-900 dark:text-white">设置与隐私</Text>
          <Text className="text-xs text-neutral-500 dark:text-neutral-400">管理 LuckRead 账户和使用偏好</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingTop: 18, paddingBottom: Math.max(insets.bottom, 16) + 20 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="mx-4 mb-4 rounded-2xl bg-neutral-100 px-4 py-4 dark:bg-neutral-900">
          <Text className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            {authStatus === 'authenticated'
              ? (user?.email || '已登录 LuckRead')
              : authStatus === 'loading'
                ? '正在读取账户状态…'
                : '登录 LuckRead 以管理账号设置'}
          </Text>
          {authStatus !== 'authenticated' && authStatus !== 'loading' ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(('/login?returnTo=' + encodeURIComponent('/settings')) as never)}
              className="mt-3 min-h-10 self-start justify-center rounded-full bg-sky-500 px-5"
            >
              <Text className="font-bold text-white">登录或注册</Text>
            </Pressable>
          ) : null}
        </View>

        <SettingsSection title="账户">
          <SettingsRow
            icon="user"
            title="个人主页"
            description="查看你的公开个人资料和内容"
            onPress={() => router.push('/profile' as never)}
            isDark={isDark}
          />
        </SettingsSection>

        <SettingsSection title="隐私与安全">
          <SettingsRow
            icon="shield"
            title="屏蔽和静音"
            description="查看并管理你屏蔽或静音的账号"
            onPress={() => router.push('/blocked-muted' as never)}
            isDark={isDark}
          />
        </SettingsSection>

        <SettingsSection title="通知">
          <SettingsRow
            icon="bell"
            title="通知设置"
            description="管理互动通知偏好和此设备的推送权限"
            onPress={() => router.push('/notification-preferences' as never)}
            isDark={isDark}
          />
        </SettingsSection>

        <SettingsSection title="显示">
          <SettingsRow
            icon="moon"
            title="外观"
            description="选择浅色、深色或跟随设备设置"
            value={themeLabel}
            onPress={() => themeSheetRef.current?.present()}
            isDark={isDark}
          />
        </SettingsSection>

        <SettingsSection title="数据使用">
          <SettingsSwitchRow
            title="视频信息流自动播放"
            description="关闭后，视频信息流需要点击播放；此设置仅保存在当前设备。"
            value={videoAutoPlayEnabled}
            disabled={!videoAutoPlayLoaded || videoAutoPlaySaving}
            onValueChange={(enabled) => { void updateVideoAutoPlay(enabled); }}
            isDark={isDark}
          />
          {!videoAutoPlayLoaded ? (
            <Text className="px-4 pb-3 text-xs text-neutral-500 dark:text-neutral-400">正在读取此设备的设置…</Text>
          ) : null}
          {videoAutoPlayError ? (
            <Text accessibilityLiveRegion="assertive" className="px-4 pb-3 text-xs text-red-600 dark:text-red-400">
              {videoAutoPlayError}
            </Text>
          ) : null}
          {Platform.OS === 'ios' || Platform.OS === 'android' ? (
            <>
              <View className="mx-4 h-px bg-neutral-100 dark:bg-neutral-800" />
              <SettingsRow
                icon="trash-2"
                title={imageCacheClearing ? '正在清理图片缓存…' : '清理图片缓存'}
                description="清除此设备的图片内存与磁盘缓存；不会删除草稿、待上传文件、视频或账号数据。"
                value={imageCacheClearing ? '处理中' : undefined}
                onPress={confirmClearImageCache}
                isDark={isDark}
                disabled={imageCacheClearing}
              />
              {imageCacheError ? (
                <Text accessibilityLiveRegion="assertive" className="px-4 pb-3 text-xs text-red-600 dark:text-red-400">
                  {imageCacheError}
                </Text>
              ) : null}
            </>
          ) : null}
        </SettingsSection>

        <Text className="px-6 pb-3 text-center text-xs leading-5 text-neutral-400 dark:text-neutral-500">
          账户偏好由对应服务保存；外观、视频自动播放和图片缓存操作均限于此设备。未开放的控制不会显示为可操作选项。
        </Text>
      </ScrollView>

      <BottomSheetModal
        ref={themeSheetRef}
        index={0}
        snapPoints={themeSnapPoints}
        backdropComponent={(sheetProps) => (
          <BottomSheetBackdrop {...sheetProps} appearsOnIndex={0} disappearsOnIndex={-1} />
        )}
        handleIndicatorStyle={{ backgroundColor: isDark ? '#333333' : '#d1d5db', height: 5, width: 36 }}
        backgroundStyle={{ backgroundColor: isDark ? '#000000' : '#ffffff', borderRadius: 26 }}
      >
        <BottomSheetView className="flex-1 bg-white px-6 pt-2 dark:bg-black">
          <Text className="mb-3 text-lg font-bold text-neutral-900 dark:text-neutral-100">外观</Text>
          <ThemeModeOption label="浅色" value="light" selected={themePreference === 'light'} onPress={selectTheme} />
          <ThemeModeOption label="深色" value="dark" selected={themePreference === 'dark'} onPress={selectTheme} />
          <ThemeModeOption label="跟随系统设置" value="system" selected={themePreference === 'system'} onPress={selectTheme} />
        </BottomSheetView>
      </BottomSheetModal>
    </View>
  );
}
