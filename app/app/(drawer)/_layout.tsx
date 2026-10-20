import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  SafeAreaView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { DrawerContentScrollView, DrawerItem } from '@react-navigation/drawer';
import { Feather } from '@expo/vector-icons';
import { useRouter, useSegments } from 'expo-router';
import { Drawer } from 'expo-router/drawer';
import {
  BottomSheetModal,
  BottomSheetView,
  BottomSheetBackdrop,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWindowDimensions } from 'react-native';

import { apiRequest } from '~/lib/api-client';
import { unwrapApiData } from '~/lib/content-adapter';
import { useAuthStore } from '~/store/auth-store';

type PublicProfile = {
  id: string;
  username?: string;
  displayName?: string | null;
  avatar?: string | null;
  bio?: string | null;
};

function CustomDrawerContent(props: any) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const user = useAuthStore((state) => state.user);
  const authStatus = useAuthStore((state) => state.status);
  const logout = useAuthStore((state) => state.logout);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [signOutBusy, setSignOutBusy] = useState(false);
  const accountSheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ['32%'], []);

  useEffect(() => {
    let active = true;
    if (authStatus !== 'authenticated' || !user?.id) {
      setProfile(null);
      setProfileLoading(false);
      return () => { active = false; };
    }

    setProfileLoading(true);
    setProfileError('');
    void apiRequest<unknown>('/users/' + encodeURIComponent(user.id), { method: 'GET' })
      .then((result) => {
        if (!active) return;
        if (!result.response.ok) throw new Error('无法加载个人资料。');
        const value = unwrapApiData<PublicProfile>(result.data);
        if (!value?.id) throw new Error('用户资料返回的数据格式无效。');
        setProfile(value);
      })
      .catch((cause) => {
        if (active) setProfileError(cause instanceof Error ? cause.message : '无法加载个人资料。');
      })
      .finally(() => {
        if (active) setProfileLoading(false);
      });
    return () => { active = false; };
  }, [authStatus, user?.id]);

  const openMyProfile = useCallback(() => {
    if (authStatus !== 'authenticated' || !user?.id) {
      router.push('/login' as never);
      return;
    }
    const identifier = profile?.username || user.id;
    router.push(('/profile/' + encodeURIComponent(identifier)) as never);
  }, [authStatus, profile?.username, router, user?.id]);

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

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
      <View className="border-b border-neutral-200 px-5 py-5 dark:border-neutral-800">
        <View className="flex-row items-start">
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="打开个人主页" onPress={openMyProfile} className="mr-3">
            {avatar ? (
              <Image source={{ uri: avatar }} className="h-12 w-12 rounded-full" />
            ) : (
              <View className="h-12 w-12 items-center justify-center rounded-full bg-neutral-200 dark:bg-neutral-800">
                <Feather name="user" size={23} color="#6b7280" />
              </View>
            )}
          </TouchableOpacity>
          <View className="flex-1">
            <Text className="text-lg font-extrabold text-neutral-900 dark:text-white">{displayName}</Text>
            <Text numberOfLines={1} className="mt-1 text-sm text-neutral-500">{username}</Text>
            {profileLoading ? <Text className="mt-1 text-xs text-neutral-400">正在同步资料…</Text> : null}
            {profileError ? <Text className="mt-1 text-xs text-amber-600">{profileError}</Text> : null}
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="账户选项"
            className="rounded-full border border-neutral-300 p-2 dark:border-neutral-700"
            onPress={() => accountSheetRef.current?.present()}
          >
            <Feather name="more-horizontal" size={20} color="#6b7280" />
          </TouchableOpacity>
        </View>
        <View className="mt-4 flex-row gap-5">
          <TouchableOpacity accessibilityRole="button" onPress={openMyProfile}>
            <Text className="text-sm text-neutral-500">查看个人主页 <Feather name="arrow-up-right" size={12} /></Text>
          </TouchableOpacity>
        </View>
      </View>

      <DrawerContentScrollView
        {...props}
        className="flex-1"
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 16 }}
        swipeEdgeWidth={width}
      >
        <DrawerItem
          icon={({ color, size }) => <Feather name="home" color={color} size={size} />}
          label="首页动态"
          labelStyle={{ fontSize: 16, fontWeight: '700', color: '#111827' }}
          onPress={() => router.push('/(drawer)/(tabs)/(index)' as never)}
        />
        <DrawerItem
          icon={({ color, size }) => <Feather name="search" color={color} size={size} />}
          label="发现"
          labelStyle={{ fontSize: 16, fontWeight: '700', color: '#111827' }}
          onPress={() => router.push('/(drawer)/(tabs)/(search)' as never)}
        />
        <DrawerItem
          icon={({ color, size }) => <Feather name="bell" color={color} size={size} />}
          label="通知"
          labelStyle={{ fontSize: 16, fontWeight: '700', color: '#111827' }}
          onPress={() => router.push('/(drawer)/(tabs)/(notifications)' as never)}
        />
        <DrawerItem
          icon={({ color, size }) => <Feather name="message-circle" color={color} size={size} />}
          label="私信"
          labelStyle={{ fontSize: 16, fontWeight: '700', color: '#111827' }}
          onPress={() => router.push('/(drawer)/(tabs)/(messages)' as never)}
        />
        <DrawerItem
          icon={({ color, size }) => <Feather name="user" color={color} size={size} />}
          label="个人主页"
          labelStyle={{ fontSize: 16, fontWeight: '700', color: '#111827' }}
          onPress={openMyProfile}
        />
        <DrawerItem
          icon={({ color, size }) => <Feather name="bookmark" color={color} size={size} />}
          label="收藏"
          labelStyle={{ fontSize: 16, fontWeight: '700', color: '#111827' }}
          onPress={() => {
            if (authStatus !== 'authenticated') router.push('/login' as never);
            else router.push('/bookmarks' as never);
          }}
        />
      </DrawerContentScrollView>

      <View className="border-t border-neutral-200 px-5 py-4 dark:border-neutral-800" style={{ paddingBottom: insets.bottom > 0 ? insets.bottom : 16 }}>
        <TouchableOpacity onPress={() => accountSheetRef.current?.present()} className="flex-row items-center gap-3">
          <Feather name="settings" size={20} color="#6b7280" />
          <Text className="text-sm font-semibold text-neutral-700 dark:text-neutral-200">账户与登录</Text>
        </TouchableOpacity>
      </View>

      <BottomSheetModal
        ref={accountSheetRef}
        index={0}
        snapPoints={snapPoints}
        backdropComponent={(sheetProps) => (
          <BottomSheetBackdrop {...sheetProps} appearsOnIndex={0} disappearsOnIndex={-1} />
        )}
        handleIndicatorStyle={{ backgroundColor: '#d1d5db', height: 5, width: 36 }}
        backgroundStyle={{ backgroundColor: '#ffffff', borderRadius: 24 }}
      >
        <BottomSheetView className="flex-1 px-5 pt-2">
          <Text className="mb-1 text-center text-lg font-bold text-neutral-900">账户</Text>
          <Text numberOfLines={1} className="mb-5 text-center text-sm text-neutral-500">
            {user?.email || '尚未登录'}
          </Text>
          {authStatus === 'authenticated' ? (
            <TouchableOpacity
              accessibilityRole="button"
              disabled={signOutBusy}
              onPress={() => void handleSignOut()}
              className="flex-row items-center justify-center gap-2 rounded-full border border-neutral-300 px-5 py-3"
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
            <Text className="font-semibold text-neutral-600">取消</Text>
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
        drawerStyle: { width: '80%' },
      }}
    >
      <Drawer.Screen name="index" options={{ headerShown: false }} />
      <Drawer.Screen name="(tabs)" options={{ headerShown: false }} />
      <Drawer.Screen name="profile" options={{ headerShown: false }} />
      <Drawer.Screen name="bookmarks" options={{ headerShown: false }} />
    </Drawer>
  );
}

export default DrawerLayout;
