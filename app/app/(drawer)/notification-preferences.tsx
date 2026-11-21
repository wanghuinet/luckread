import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  fetchNotificationPreferences,
  NotificationPreferencesApiError,
  saveNotificationPreferences,
  type NotificationPreferenceKey,
  type NotificationPreferences,
} from '~/lib/notification-preferences-api';
import { useAuthStore } from '~/store/auth-store';
import {
  getDevicePushPermission,
  requestDevicePushPermission,
  type DevicePushPermission,
} from '~/lib/push-notifications';

const PRIMARY = '#1d9bf0';

const OPTIONS: Array<{
  key: NotificationPreferenceKey;
  title: string;
  description: string;
}> = [
  {
    key: 'follow',
    title: '新关注者',
    description: '有人关注你的账号时通知你。',
  },
  {
    key: 'like',
    title: '收到点赞',
    description: '有人点赞你的内容时通知你。',
  },
  {
    key: 'comment',
    title: '收到评论',
    description: '有人评论你的内容时通知你。',
  },
  {
    key: 'mention',
    title: '提及你',
    description: '有人在内容中提及你时通知你。',
  },
];

function equalPreferences(
  left: NotificationPreferences | null,
  right: NotificationPreferences | null,
): boolean {
  if (!left || !right) return left === right;
  return OPTIONS.every(({ key }) => left[key] === right[key]);
}

export default function NotificationPreferencesScreen() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const authStatus = useAuthStore((state) => state.status);
  const accountId = useAuthStore((state) => state.user?.id ?? null);
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [savedPreferences, setSavedPreferences] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [authRequired, setAuthRequired] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [devicePushPermission, setDevicePushPermission] = useState<DevicePushPermission>({
    supported: true,
    status: 'undetermined',
    canAskAgain: true,
  });
  const [devicePushBusy, setDevicePushBusy] = useState(false);
  const [devicePushError, setDevicePushError] = useState('');
  const [devicePushMessage, setDevicePushMessage] = useState('');


  useEffect(() => {
    if (authStatus === 'loading') return;
    if (authStatus !== 'authenticated') {
      setAuthRequired(true);
      setPreferences(null);
      setSavedPreferences(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError('');
    setMessage('');
    setAuthRequired(false);

    void fetchNotificationPreferences(controller.signal)
      .then((result) => {
        if (!active || controller.signal.aborted) return;
        setPreferences(result);
        setSavedPreferences(result);
      })
      .catch((cause) => {
        if (!active || controller.signal.aborted) return;
        if (cause instanceof NotificationPreferencesApiError && cause.status === 401) {
          setAuthRequired(true);
          return;
        }
        setError(cause instanceof Error
          ? cause.message
          : '通知偏好设置加载失败，请重试。');
      })
      .finally(() => {
        if (active && !controller.signal.aborted) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [authStatus, retryKey]);


  useEffect(() => {
    let active = true;
    const refreshDevicePushPermission = () => {
      void getDevicePushPermission()
        .then((permission) => {
          if (active) setDevicePushPermission(permission);
        })
        .catch(() => {
          if (active) {
            setDevicePushPermission({
              supported: false,
              status: 'undetermined',
              canAskAgain: false,
            });
          }
        });
    };

    refreshDevicePushPermission();
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') refreshDevicePushPermission();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  const enableDevicePush = useCallback(async () => {
    if (!accountId || devicePushBusy || !devicePushPermission.supported) return;
    setDevicePushBusy(true);
    setDevicePushError('');
    setDevicePushMessage('');
    try {
      if (devicePushPermission.status === 'denied' && !devicePushPermission.canAskAgain) {
        await Linking.openSettings();
        return;
      }

      const result = await requestDevicePushPermission(accountId);
      const permission = await getDevicePushPermission();
      setDevicePushPermission(permission);

      if (result === 'enabled') {
        setDevicePushMessage('此设备的推送通知已启用，令牌已通过 LuckRead 安全接口同步。');
      } else if (result === 'settings-required') {
        setDevicePushMessage('系统已禁止再次询问，请在系统设置中允许 LuckRead 通知。');
      } else if (result === 'denied') {
        setDevicePushMessage('你尚未允许系统通知；可以随时在系统设置中更改。');
      } else if (result === 'unsupported') {
        setDevicePushError('设备推送仅支持安装版 iOS 或 Android APP。');
      } else {
        setDevicePushMessage('尚未授予通知权限。');
      }
    } catch (cause) {
      setDevicePushError(cause instanceof Error ? cause.message : '无法启用此设备的推送通知，请重试。');
    } finally {
      setDevicePushBusy(false);
    }
  }, [accountId, devicePushBusy, devicePushPermission]);

  const openSystemNotificationSettings = useCallback(async () => {
    setDevicePushError('');
    try {
      await Linking.openSettings();
    } catch {
      setDevicePushError('无法打开系统设置，请在设备设置中找到 LuckRead 的通知权限。');
    }
  }, []);

  const dirty = useMemo(
    () => !equalPreferences(preferences, savedPreferences),
    [preferences, savedPreferences],
  );

  const changePreference = useCallback((key: NotificationPreferenceKey, value: boolean) => {
    setPreferences((current) => current ? { ...current, [key]: value } : current);
    setError('');
    setMessage('');
  }, []);

  const save = useCallback(async () => {
    if (!preferences || saving || !dirty) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const canonical = await saveNotificationPreferences(preferences);
      setPreferences(canonical);
      setSavedPreferences(canonical);
      setMessage('通知偏好设置已保存。');
    } catch (cause) {
      if (cause instanceof NotificationPreferencesApiError && cause.status === 401) {
        setAuthRequired(true);
        return;
      }
      setError(cause instanceof Error
        ? cause.message
        : '通知偏好设置保存失败，请重试。');
    } finally {
      setSaving(false);
    }
  }, [dirty, preferences, saving]);

  return (
    <View className="flex-1 bg-white dark:bg-black" style={{ paddingTop: insets.top }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View className="flex-row items-center border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回"
          onPress={() => router.back()}
          className="mr-3 h-10 w-10 items-center justify-center rounded-full"
        >
          <Feather name="arrow-left" size={22} color={isDark ? '#d1d5db' : '#536471'} />
        </Pressable>
        <View className="flex-1">
          <Text className="text-lg font-bold text-neutral-900 dark:text-white">通知设置</Text>
          <Text className="text-xs text-neutral-500 dark:text-neutral-400">管理哪些互动会通知你</Text>
        </View>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center px-6">
          <ActivityIndicator color={PRIMARY} size="large" />
          <Text className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">正在加载通知偏好设置…</Text>
        </View>
      ) : authRequired ? (
        <View className="flex-1 items-center justify-center px-6">
          <Feather name="bell" size={38} color={PRIMARY} />
          <Text className="mt-4 text-lg font-bold text-neutral-900 dark:text-white">登录后管理通知</Text>
          <Text className="mt-2 text-center text-sm leading-6 text-neutral-500 dark:text-neutral-400">
            通知偏好会保存到你的 LuckRead 账户。
          </Text>
          <Pressable
            accessibilityRole="button"
            className="mt-5 rounded-full bg-sky-500 px-6 py-3"
            onPress={() => router.push(('/login?returnTo=' + encodeURIComponent('/notification-preferences')) as never)}
          >
            <Text className="font-bold text-white">登录</Text>
          </Pressable>
        </View>
      ) : error && !preferences ? (
        <View className="flex-1 items-center justify-center px-6">
          <Feather name="alert-circle" size={32} color="#dc2626" />
          <Text className="mt-4 text-center text-sm text-red-600">{error}</Text>
          <Pressable
            accessibilityRole="button"
            className="mt-4 rounded-full border border-neutral-300 px-5 py-2.5 dark:border-neutral-700"
            onPress={() => setRetryKey((value) => value + 1)}
          >
            <Text className="font-bold text-neutral-900 dark:text-white">重试</Text>
          </Pressable>
        </View>
      ) : preferences ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 20) + 20 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="px-4 py-4">
            <Text className="text-sm leading-6 text-neutral-500 dark:text-neutral-400">
              选择哪些社交活动可以通知你。保存后设置会同步到你的账号，并用于后续通知投递。
            </Text>
          </View>

          <View className="mx-4 mb-3 rounded-2xl border border-neutral-200 px-4 py-4 dark:border-neutral-800">
            <Text className="text-base font-bold text-neutral-900 dark:text-white">此设备的推送通知</Text>
            <Text className="mt-1 text-sm leading-5 text-neutral-500 dark:text-neutral-400">
              {devicePushPermission.supported
                ? devicePushPermission.status === 'granted'
                  ? '系统已允许通知。登录期间，LuckRead 会自动同步此设备的推送地址。'
                  : devicePushPermission.status === 'denied'
                    ? '系统当前禁止通知。启用前可能需要到设备设置中重新允许。'
                    : '开启后，LuckRead 才会向系统申请通知权限；不会在后台自动弹出授权请求。'
                : '此功能仅支持安装版 iOS 或 Android APP。'}
            </Text>
            {devicePushError ? (
              <Text accessibilityRole="alert" className="mt-3 text-sm text-red-600">{devicePushError}</Text>
            ) : null}
            {devicePushMessage ? (
              <Text accessibilityRole="text" className="mt-3 text-sm text-emerald-600">{devicePushMessage}</Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: devicePushBusy || !devicePushPermission.supported || !accountId }}
              disabled={devicePushBusy || !devicePushPermission.supported || !accountId}
              onPress={() => void enableDevicePush()}
              className="mt-3 min-h-11 items-center justify-center rounded-full bg-sky-500 px-5 py-2.5"
            >
              {devicePushBusy ? <ActivityIndicator color="#ffffff" /> : (
                <Text className="font-bold text-white">
                  {devicePushPermission.status === 'denied' && !devicePushPermission.canAskAgain
                    ? '打开系统设置'
                    : devicePushPermission.status === 'granted'
                      ? '重新同步设备推送'
                      : '启用设备推送'}
                </Text>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => void openSystemNotificationSettings()}
              className="mt-2 min-h-10 items-center justify-center rounded-full px-5 py-2"
            >
              <Text className="font-semibold text-sky-600 dark:text-sky-400">管理系统通知</Text>
            </Pressable>
          </View>

          {OPTIONS.map((option) => (
            <View
              key={option.key}
              className="flex-row items-center border-t border-neutral-100 px-4 py-4 dark:border-neutral-800"
            >
              <View className="mr-3 flex-1">
                <Text className="text-base font-bold text-neutral-900 dark:text-white">
                  {option.title}
                </Text>
                <Text className="mt-1 text-sm leading-5 text-neutral-500 dark:text-neutral-400">
                  {option.description}
                </Text>
              </View>
              <Switch
                accessibilityLabel={option.title}
                disabled={saving}
                onValueChange={(value) => changePreference(option.key, value)}
                trackColor={{ false: isDark ? '#52525b' : '#d0d5dd', true: '#91d0fa' }}
                thumbColor={preferences[option.key] ? PRIMARY : '#f9fafb'}
                value={preferences[option.key]}
              />
            </View>
          ))}

          <View className="px-4 py-5">
            {error ? (
              <Text accessibilityRole="alert" className="mb-3 text-sm text-red-600">
                {error}
              </Text>
            ) : null}
            {message ? (
              <Text accessibilityRole="text" className="mb-3 text-sm text-emerald-600">
                {message}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: saving || loading || !dirty }}
              disabled={saving || loading || !dirty}
              onPress={() => void save()}
              className={
                'min-h-12 flex-row items-center justify-center rounded-full px-5 py-3 ' +
                (saving || !dirty ? 'bg-sky-300 dark:bg-sky-900' : 'bg-sky-500')
              }
            >
              {saving ? <ActivityIndicator color="#ffffff" /> : (
                <Text className="font-bold text-white">{dirty ? '保存设置' : '已保存'}</Text>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              onPress={() => setRetryKey((value) => value + 1)}
              className="mt-3 min-h-10 items-center justify-center"
            >
              <Text className="font-semibold text-neutral-500 dark:text-neutral-400">重新加载服务器设置</Text>
            </Pressable>
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}
