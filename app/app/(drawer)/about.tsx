import React, { useCallback, useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';

const TERMS_URL = 'https://luckread.com/terms';
const PRIVACY_URL = 'https://luckread.com/privacy';

function Section({
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

function PolicyRow({
  title,
  description,
  busy,
  onPress,
  isDark,
}: {
  title: string;
  description: string;
  busy: boolean;
  onPress: () => void;
  isDark: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={description + '。在系统浏览器中打开。'}
      accessibilityState={{ disabled: busy }}
      disabled={busy}
      onPress={onPress}
      className="min-h-[68px] flex-row items-center px-4 py-3 active:bg-neutral-100 dark:active:bg-neutral-900"
    >
      <View className="mr-3 h-10 w-10 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-900">
        <Feather name="file-text" size={18} color={isDark ? '#d1d5db' : '#536471'} />
      </View>
      <View className="mr-3 flex-1">
        <Text className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">{title}</Text>
        <Text className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{description}</Text>
      </View>
      <Text className="mr-2 text-xs text-neutral-500 dark:text-neutral-400">{busy ? '正在打开…' : '打开'}</Text>
      <Feather name="external-link" size={17} color={isDark ? '#737373' : '#9ca3af'} />
    </Pressable>
  );
}

function InformationRow({
  label,
  value,
  isDark,
}: {
  label: string;
  value: string;
  isDark: boolean;
}) {
  return (
    <View className="min-h-[54px] flex-row items-center justify-between px-4 py-3">
      <Text className="text-sm text-neutral-600 dark:text-neutral-400">{label}</Text>
      <Text selectable className="ml-4 text-sm font-semibold text-neutral-900 dark:text-neutral-100">{value}</Text>
    </View>
  );
}

export default function HelpAboutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [openingPolicy, setOpeningPolicy] = useState<'terms' | 'privacy' | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const openPolicy = useCallback(async (kind: 'terms' | 'privacy') => {
    if (openingPolicy) return;
    setOpeningPolicy(kind);
    setErrorMessage('');
    const url = kind === 'terms' ? TERMS_URL : PRIVACY_URL;
    try {
      await Linking.openURL(url);
    } catch {
      setErrorMessage(kind === 'terms'
        ? '暂时无法打开用户协议，请检查网络后重试。'
        : '暂时无法打开隐私政策，请检查网络后重试。');
    } finally {
      setOpeningPolicy(null);
    }
  }, [openingPolicy]);

  const appVersion = Constants.expoConfig?.version?.trim() || '当前运行环境未提供';
  const nativeBuildNumber = Platform.OS === 'android'
    ? Constants.platform?.android?.versionCode
    : Platform.OS === 'ios'
      ? Constants.platform?.ios?.buildNumber
      : null;
  const buildLabel = typeof nativeBuildNumber === 'string' || typeof nativeBuildNumber === 'number'
    ? String(nativeBuildNumber)
    : '当前运行环境未提供';
  const buildKind = Platform.OS === 'android'
    ? 'Android 版本代码'
    : Platform.OS === 'ios'
      ? 'iOS 构建号'
      : '原生构建号';

  return (
    <View className="flex-1 bg-neutral-50 dark:bg-black" style={{ paddingTop: insets.top }}>
      <Stack.Screen options={{ headerShown: false, title: '帮助与关于' }} />
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
          <Text className="text-lg font-bold text-neutral-900 dark:text-white">帮助与关于</Text>
          <Text className="text-xs text-neutral-500 dark:text-neutral-400">LuckRead APP 1.0 Beta</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingTop: 18, paddingBottom: Math.max(insets.bottom, 16) + 20 }}
      >
        <Section title="帮助与支持">
          <View className="flex-row items-start px-4 pb-4 pt-2">
            <Feather name="info" size={18} color={isDark ? '#9ca3af' : '#667085'} style={{ marginTop: 2, marginRight: 10 }} />
            <Text className="flex-1 text-sm leading-6 text-neutral-600 dark:text-neutral-400">
              帮助中心、在线客服和工单系统尚未接入 APP 1.0。当前可用的官方资料包括用户协议和隐私政策；我们不会显示未经验证的客服邮箱或空白支持入口。
            </Text>
          </View>
        </Section>

        <Section title="官方政策">
          <PolicyRow
            title="用户协议"
            description="查看 LuckRead 服务条款"
            busy={openingPolicy === 'terms'}
            onPress={() => { void openPolicy('terms'); }}
            isDark={isDark}
          />
          <View className="mx-4 h-px bg-neutral-100 dark:bg-neutral-800" />
          <PolicyRow
            title="隐私政策"
            description="了解信息处理和隐私相关说明"
            busy={openingPolicy === 'privacy'}
            onPress={() => { void openPolicy('privacy'); }}
            isDark={isDark}
          />
          {errorMessage ? (
            <Text accessibilityLiveRegion="assertive" className="px-4 pb-4 text-xs text-red-600 dark:text-red-400">
              {errorMessage}
            </Text>
          ) : null}
        </Section>

        <Section title="应用信息">
          <InformationRow label="应用名称" value="LuckRead" isDark={isDark} />
          <View className="mx-4 h-px bg-neutral-100 dark:bg-neutral-800" />
          <InformationRow label="应用版本" value={appVersion} isDark={isDark} />
          <View className="mx-4 h-px bg-neutral-100 dark:bg-neutral-800" />
          <InformationRow label={buildKind} value={buildLabel} isDark={isDark} />
          <View className="mx-4 h-px bg-neutral-100 dark:bg-neutral-800" />
          <InformationRow label="平台" value={Platform.OS} isDark={isDark} />
          <View className="px-4 pb-4 pt-2">
            <Text className="text-xs leading-5 text-neutral-500 dark:text-neutral-400">
              构建信息取自当前安装的原生应用清单。开发环境或 Expo Go 未提供构建号时会明确显示不可用，不会用 OTA 更新编号代替原生构建号。
            </Text>
          </View>
        </Section>
      </ScrollView>
    </View>
  );
}
