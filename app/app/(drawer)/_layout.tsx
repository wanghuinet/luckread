import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
  SafeAreaView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { DrawerContentScrollView } from '@react-navigation/drawer';
import { Feather } from '@expo/vector-icons';
import { useColorScheme } from 'nativewind';
import { useRouter, useSegments } from 'expo-router';
import { Drawer } from 'expo-router/drawer';
import {
  BottomSheetModal,
  BottomSheetView,
  BottomSheetBackdrop,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWindowDimensions } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import { resolvePublicProfileById, type ApiPublicProfile } from '~/lib/content-adapter';
import { useAuthStore } from '~/store/auth-store';
import { isThemePreference, THEME_PREFERENCE_KEY, type ThemePreference } from '~/lib/theme-preference';

type DrawerMenuItemProps = {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  isDark: boolean;
};

function DrawerMenuItem({ icon, label, onPress, isDark }: DrawerMenuItemProps) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="min-h-[58px] flex-row items-center px-6"
      activeOpacity={0.72}
    >
      <Feather name={icon} size={27} color={isDark ? '#d1d5db' : '#16181c'} />
      <Text className="ml-5 text-[19px] font-bold text-neutral-900 dark:text-neutral-100">{label}</Text>
    </TouchableOpacity>
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
    <TouchableOpacity
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={() => onPress(value)}
      className="min-h-[56px] flex-row items-center justify-between px-1"
      activeOpacity={0.72}
    >
      <Text className="text-[17px] text-neutral-900 dark:text-neutral-100">{label}</Text>
      <View
        className={
          'h-6 w-6 items-center justify-center rounded-full border-2 ' +
          (selected ? 'border-sky-500' : 'border-neutral-400 dark:border-neutral-500')
        }
      >
        {selected ? <View className="h-3 w-3 rounded-full bg-sky-500" /> : null}
      </View>
    </TouchableOpacity>
  );
}

function CustomDrawerContent(props: any) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { colorScheme, setColorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const user = useAuthStore((state) => state.user);
  const authStatus = useAuthStore((state) => state.status);
  const logout = useAuthStore((state) => state.logout);
  const [profile, setProfile] = useState<ApiPublicProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [themePreference, setThemePreference] = useState<ThemePreference>('system');
  const accountSheetRef = useRef<BottomSheetModal>(null);
  const themeSheetRef = useRef<BottomSheetModal>(null);
  const accountSnapPoints = useMemo(() => ['32%'], []);
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
    if (authStatus !== 'authenticated' || !user?.id) {
      setProfile(null);
      setProfileLoading(false);
      return () => { active = false; };
    }

    const controller = new AbortController();
    setProfileLoading(true);
    setProfileError('');
    void resolvePublicProfileById(user.id, controller.signal)
      .then((value) => {
        if (!active) return;
        if (!value?.id) throw new Error('无法加载个人资料。');
        setProfile(value);
      })
      .catch((cause) => {
        if (active) setProfileError(cause instanceof Error ? cause.message : '无法加载个人资料。');
      })
      .finally(() => {
        if (active) setProfileLoading(false);
      });
    return () => { active = false; controller.abort(); };
  }, [authStatus, user?.id]);

  const openMyProfile = useCallback(() => {
    if (authStatus !== 'authenticated' || !user?.id) {
      router.push('/login' as never);
      return;
    }
    const identifier = profile?.username || user.id;
    router.push(('/profile/' + encodeURIComponent(identifier)) as never);
  }, [authStatus, profile?.username, router, user?.id]);

  const showUnavailable = useCallback((name: string) => {
    Alert.alert(name, '该模块尚未接入 LuckRead 1.0 Beta APP。');
  }, []);

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

  const handleSignOut = useCallback(async () => {
    if (signOutBusy) return;
    setSignOutBusy(true);
    try {
      await logout();
      accountSheetRef.current?.dismiss();
      router.replace('/login' as never);
    } catch {
      accountSheetRef.current?.dismiss();
      router.replace('/login' as never);
    } finally {
      setSignOutBusy(false);
    }
  }, [logout, router, signOutBusy]);

  const displayName = profile?.displayName?.trim() || user?.name?.trim() || 'LuckRead 用户';
  const username = profile?.username ? '@' + profile.username : user?.email || '';
  const avatar = profile?.avatar || user?.image || '';
  const drawerBackground = isDark ? '#000000' : '#ffffff';
  const sheetTextClass = 'text-neutral-900 dark:text-neutral-100';

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
      <View
        className="border-b border-neutral-200 px-6 pb-5 dark:border-neutral-800"
        style={{ paddingTop: 16 }}
      >
        <View className="mb-5 flex-row items-center justify-between">
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="打开个人主页"
            onPress={openMyProfile}
            activeOpacity={0.8}
          >
            {avatar ? (
              <Image source={{ uri: avatar }} className="h-16 w-16 rounded-full bg-neutral-200 dark:bg-neutral-800" />
            ) : (
              <View className="h-16 w-16 items-center justify-center rounded-full bg-neutral-200 dark:bg-neutral-800">
                <Feather name="user" size={29} color={isDark ? '#9ca3af' : '#6b7280'} />
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="账户选项"
            className="rounded-full p-2"
            onPress={() => accountSheetRef.current?.present()}
            hitSlop={8}
          >
            <Feather name="more-horizontal" size={25} color={isDark ? '#d1d5db' : '#111827'} />
          </TouchableOpacity>
        </View>
        <TouchableOpacity onPress={openMyProfile} activeOpacity={0.8}>
          <Text className="text-[25px] font-extrabold text-neutral-900 dark:text-white">{displayName}</Text>
          <Text numberOfLines={1} className="mt-1 text-base text-neutral-500">{username}</Text>
        </TouchableOpacity>
        {profileLoading ? <Text className="mt-2 text-xs text-neutral-400">正在同步资料…</Text> : null}
        {profileError ? <Text className="mt-2 text-xs text-amber-600">{profileError}</Text> : null}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="查看个人主页"
          onPress={openMyProfile}
          className="mt-3 self-start"
        >
          <Text className="text-sm text-neutral-500">查看个人主页 <Feather name="arrow-up-right" size={12} /></Text>
        </TouchableOpacity>
      </View>

      <DrawerContentScrollView
        {...props}
        className="flex-1"
        contentContainerStyle={{ paddingTop: 14, paddingBottom: 16 }}
        swipeEdgeWidth={width}
      >
        <DrawerMenuItem icon="user" label="个人资料" onPress={openMyProfile} isDark={isDark} />
        <DrawerMenuItem
          icon="award"
          label="Premium"
          isDark={isDark}
          onPress={() => {
            if (authStatus !== 'authenticated') {
              router.push(('/login?returnTo=' + encodeURIComponent('/membership-plans')) as never);
            } else {
              router.push('/membership-plans' as never);
            }
          }}
        />
        <DrawerMenuItem
          icon="credit-card"
          label="我的订阅"
          isDark={isDark}
          onPress={() => {
            if (authStatus !== 'authenticated') {
              router.push(('/login?returnTo=' + encodeURIComponent('/subscriptions')) as never);
            } else {
              router.push('/subscriptions' as never);
            }
          }}
        />
        <DrawerMenuItem icon="users" label="社群" onPress={() => showUnavailable('社群')} isDark={isDark} />
        <DrawerMenuItem
          icon="bookmark"
          label="书签"
          isDark={isDark}
          onPress={() => {
            if (authStatus !== 'authenticated') router.push('/login' as never);
            else router.push('/bookmarks' as never);
          }}
        />
        <DrawerMenuItem
          icon="bell"
          label="通知设置"
          isDark={isDark}
          onPress={() => {
            if (authStatus !== 'authenticated') router.push(('/login?returnTo=' + encodeURIComponent('/notification-preferences')) as never);
            else router.push('/notification-preferences' as never);
          }}
        />
        <DrawerMenuItem
          icon="shield"
          label="屏蔽和静音"
          isDark={isDark}
          onPress={() => {
            if (authStatus !== 'authenticated') {
              router.push(('/login?returnTo=' + encodeURIComponent('/blocked-muted')) as never);
            } else {
              router.push('/blocked-muted' as never);
            }
          }}
        />
        <DrawerMenuItem icon="list" label="列表" onPress={() => showUnavailable('列表')} isDark={isDark} />
        <DrawerMenuItem icon="mic" label="空间" onPress={() => showUnavailable('空间')} isDark={isDark} />
        <DrawerMenuItem icon="edit-3" label="创作者工作室" onPress={() => showUnavailable('创作者工作室')} isDark={isDark} />
      </DrawerContentScrollView>

      <View
        className="border-t border-neutral-200 px-5 py-3 dark:border-neutral-800"
        style={{ paddingBottom: insets.bottom > 0 ? insets.bottom : 12 }}
      >
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="夜间模式设置"
          onPress={() => themeSheetRef.current?.present()}
          className="flex-row items-center gap-3 py-3"
        >
          <Feather name="moon" size={21} color={isDark ? '#d1d5db' : '#374151'} />
          <Text className="text-base font-semibold text-neutral-800 dark:text-neutral-200">夜间模式</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="账户与登录"
          onPress={() => accountSheetRef.current?.present()}
          className="flex-row items-center gap-3 py-3"
        >
          <Feather name="settings" size={20} color={isDark ? '#d1d5db' : '#6b7280'} />
          <Text className="text-sm font-semibold text-neutral-700 dark:text-neutral-200">账户与登录</Text>
        </TouchableOpacity>
      </View>

      <BottomSheetModal
        ref={themeSheetRef}
        index={0}
        snapPoints={themeSnapPoints}
        backdropComponent={(sheetProps) => (
          <BottomSheetBackdrop {...sheetProps} appearsOnIndex={0} disappearsOnIndex={-1} />
        )}
        handleIndicatorStyle={{ backgroundColor: isDark ? '#333333' : '#d1d5db', height: 5, width: 36 }}
        backgroundStyle={{ backgroundColor: drawerBackground, borderRadius: 26 }}
      >
        <BottomSheetView className="flex-1 px-6 pt-2 bg-white dark:bg-black">
          <Text className={'mb-3 text-lg font-bold ' + sheetTextClass}>夜间模式</Text>
          <ThemeModeOption label="关闭" value="light" selected={themePreference === 'light'} onPress={selectTheme} />
          <ThemeModeOption label="开启" value="dark" selected={themePreference === 'dark'} onPress={selectTheme} />
          <ThemeModeOption label="使用设备设置" value="system" selected={themePreference === 'system'} onPress={selectTheme} />
        </BottomSheetView>
      </BottomSheetModal>

      <BottomSheetModal
        ref={accountSheetRef}
        index={0}
        snapPoints={accountSnapPoints}
        backdropComponent={(sheetProps) => (
          <BottomSheetBackdrop {...sheetProps} appearsOnIndex={0} disappearsOnIndex={-1} />
        )}
        handleIndicatorStyle={{ backgroundColor: isDark ? '#333333' : '#d1d5db', height: 5, width: 36 }}
        backgroundStyle={{ backgroundColor: drawerBackground, borderRadius: 24 }}
      >
        <BottomSheetView className="flex-1 px-5 pt-2 bg-white dark:bg-black">
          <Text className={'mb-1 text-center text-lg font-bold ' + sheetTextClass}>账户</Text>
          <Text numberOfLines={1} className="mb-5 text-center text-sm text-neutral-500">
            {user?.email || '尚未登录'}
          </Text>
          {authStatus === 'authenticated' ? (
            <TouchableOpacity
              accessibilityRole="button"
              disabled={signOutBusy}
              onPress={() => void handleSignOut()}
              className="flex-row items-center justify-center gap-2 rounded-full border border-neutral-300 px-5 py-3 dark:border-neutral-700"
            >
              <Feather name="log-out" size={18} color="#dc2626" />
              <Text className="font-bold text-red-600">{signOutBusy ? '正在退出…' : '退出登录'}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => {
                accountSheetRef.current?.dismiss();
                router.push('/login' as never);
              }}
              className="items-center rounded-full bg-sky-500 px-5 py-3"
            >
              <Text className="font-bold text-white">登录或注册</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => accountSheetRef.current?.dismiss()} className="mt-2 items-center rounded-full px-5 py-3">
            <Text className="font-semibold text-neutral-600 dark:text-neutral-300">取消</Text>
          </TouchableOpacity>
        </BottomSheetView>
      </BottomSheetModal>
    </SafeAreaView>
  );
}

function DrawerLayout() {
  const { width } = useWindowDimensions();
  const segments = useSegments();
  const isGrokRoute = segments.includes('(grok)');

  return (
    <Drawer
      drawerContent={(props) => <CustomDrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        swipeEnabled: isGrokRoute,
        swipeEdgeWidth: width,
        overlayColor: '#adadad8c',
        drawerStyle: { width: '82%', backgroundColor: 'transparent' },
      }}
    >
      <Drawer.Screen name="index" options={{ headerShown: false }} />
      <Drawer.Screen name="(tabs)" options={{ headerShown: false }} />
      <Drawer.Screen name="profile" options={{ headerShown: false }} />
      <Drawer.Screen name="bookmarks" options={{ headerShown: false }} />
      <Drawer.Screen name="notification-preferences" options={{ headerShown: false }} />
      <Drawer.Screen name="blocked-muted" options={{ headerShown: false }} />
      <Drawer.Screen name="subscription-change" options={{ headerShown: false, drawerItemStyle: { display: 'none' } }} />
    </Drawer>
  );
}

export default DrawerLayout;
