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
  BottomSheetScrollView,
  BottomSheetBackdrop,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWindowDimensions } from 'react-native';

import { resolvePublicProfileById, type ApiPublicProfile } from '~/lib/content-adapter';
import { MAX_STORED_ACCOUNTS } from '~/lib/secure-session';
import { useAuthStore } from '~/store/auth-store';

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

function CustomDrawerContent(props: any) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const user = useAuthStore((state) => state.user);
  const authStatus = useAuthStore((state) => state.status);
  const logout = useAuthStore((state) => state.logout);
  const accounts = useAuthStore((state) => state.accounts);
  const switchAccount = useAuthStore((state) => state.switchAccount);
  const removeAccount = useAuthStore((state) => state.removeAccount);
  const [profile, setProfile] = useState<ApiPublicProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [accountActionId, setAccountActionId] = useState<string | null>(null);
  const accountSheetRef = useRef<BottomSheetModal>(null);
  const accountSnapPoints = useMemo(() => ['82%'], []);

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

  const handleSwitchAccount = useCallback(async (accountId: string) => {
    if (accountActionId) return;
    setAccountActionId(accountId);
    try {
      await switchAccount(accountId);
      accountSheetRef.current?.dismiss();
    } catch (cause) {
      Alert.alert(
        '切换账号失败',
        cause instanceof Error ? cause.message : '账号切换暂时无法完成，请重试。',
      );
    } finally {
      setAccountActionId(null);
    }
  }, [accountActionId, switchAccount]);

  const handleAddAccount = useCallback(() => {
    if (accounts.length >= MAX_STORED_ACCOUNTS) {
      Alert.alert(
        '账号数量已达上限',
        '此设备最多保存 5 个 LuckRead 账号。请先移除一个账号，再添加新账号。',
      );
      return;
    }
    accountSheetRef.current?.dismiss();
    router.push((authStatus === 'authenticated' ? '/login?addAccount=1' : '/login') as never);
  }, [accounts.length, authStatus, router]);

  const handleRemoveAccount = useCallback((accountId: string) => {
    if (accountActionId) return;
    const account = accounts.find((item) => item.id === accountId);
    if (!account) return;

    const isActiveAccount = authStatus === 'authenticated' && user?.id === accountId;
    const nextAccount = isActiveAccount
      ? accounts.find((item) => item.id !== accountId)
      : undefined;

    Alert.alert(
      '从此设备移除账号',
      isActiveAccount && nextAccount
        ? '移除后将切换到最近使用的其他账号。此操作只移除此设备保存的凭证，不会撤销其他账号。'
        : '这只会删除此设备保存的账号凭证，不会影响其他已保存账号。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '移除账号',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setAccountActionId(accountId);
              try {
                if (isActiveAccount && nextAccount) {
                  await switchAccount(nextAccount.id);
                }
                await removeAccount(accountId);
                if (isActiveAccount && !nextAccount) {
                  accountSheetRef.current?.dismiss();
                  router.replace('/login' as never);
                }
              } catch (cause) {
                Alert.alert(
                  '移除账号失败',
                  cause instanceof Error ? cause.message : '移除账号暂时无法完成，请重试。',
                );
              } finally {
                setAccountActionId(null);
              }
            })();
          },
        },
      ],
    );
  }, [accountActionId, accounts, authStatus, removeAccount, router, switchAccount, user?.id]);

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
          icon="settings"
          label="设置与隐私"
          onPress={() => router.push('/settings' as never)}
          isDark={isDark}
        />
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
        <DrawerMenuItem
          icon="file-text"
          label="账单与付款"
          isDark={isDark}
          onPress={() => {
            if (authStatus !== 'authenticated') {
              router.push(('/login?returnTo=' + encodeURIComponent('/billing')) as never);
            } else {
              router.push('/billing' as never);
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
        <DrawerMenuItem icon="edit-3" label="创作者工作室" onPress={() => router.push('/creator-studio' as never)} isDark={isDark} />
      </DrawerContentScrollView>

      <View
        className="border-t border-neutral-200 px-5 py-3 dark:border-neutral-800"
        style={{ paddingBottom: insets.bottom > 0 ? insets.bottom : 12 }}
      >
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
        ref={accountSheetRef}
        index={0}
        snapPoints={accountSnapPoints}
        backdropComponent={(sheetProps) => (
          <BottomSheetBackdrop {...sheetProps} appearsOnIndex={0} disappearsOnIndex={-1} />
        )}
        handleIndicatorStyle={{ backgroundColor: isDark ? '#333333' : '#d1d5db', height: 5, width: 36 }}
        backgroundStyle={{ backgroundColor: drawerBackground, borderRadius: 24 }}
      >
        <BottomSheetScrollView
          className="flex-1 bg-white dark:bg-black"
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: Math.max(24, insets.bottom + 16) }}
          keyboardShouldPersistTaps="handled"
        >
          <Text className={'mb-1 text-center text-lg font-bold ' + sheetTextClass}>账号管理</Text>
          <Text className="mb-5 text-center text-sm text-neutral-500">
            最多保存 5 个账号。账号凭证独立保存在此设备的安全存储中。
          </Text>

          {accounts.length > 0 ? (
            <View className="mb-4 overflow-hidden rounded-2xl border border-neutral-200 dark:border-neutral-800">
              {accounts.map((account, index) => {
                const isActiveAccount = authStatus === 'authenticated' && user?.id === account.id;
                const isBusy = accountActionId === account.id;
                return (
                  <View
                    key={account.id}
                    className={
                      'flex-row items-center px-3 py-2 ' +
                      (index > 0 ? 'border-t border-neutral-200 dark:border-neutral-800' : '')
                    }
                  >
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={isActiveAccount ? '当前账号 ' + account.email : '切换到 ' + account.email}
                      accessibilityState={{ selected: isActiveAccount, disabled: Boolean(accountActionId) || isActiveAccount }}
                      disabled={Boolean(accountActionId) || isActiveAccount}
                      onPress={() => void handleSwitchAccount(account.id)}
                      className="min-h-[62px] flex-1 flex-row items-center"
                      activeOpacity={0.72}
                    >
                      {account.image ? (
                        <Image source={{ uri: account.image }} className="h-11 w-11 rounded-full bg-neutral-200 dark:bg-neutral-800" />
                      ) : (
                        <View className="h-11 w-11 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-900">
                          <Feather name="user" size={20} color={isDark ? '#9ca3af' : '#6b7280'} />
                        </View>
                      )}
                      <View className="ml-3 mr-2 flex-1">
                        <Text numberOfLines={1} className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                          {account.name?.trim() || account.email}
                        </Text>
                        <Text numberOfLines={1} className="mt-1 text-xs text-neutral-500">
                          {account.email}
                        </Text>
                      </View>
                      {isBusy ? (
                        <Text className="text-xs font-semibold text-sky-600">处理中…</Text>
                      ) : isActiveAccount ? (
                        <View className="flex-row items-center gap-1">
                          <Feather name="check-circle" size={17} color="#1d9bf0" />
                          <Text className="text-xs font-semibold text-sky-600">当前</Text>
                        </View>
                      ) : (
                        <Feather name="chevron-right" size={18} color={isDark ? '#737373' : '#9ca3af'} />
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={'从设备移除 ' + account.email}
                      accessibilityState={{ disabled: Boolean(accountActionId) }}
                      disabled={Boolean(accountActionId)}
                      onPress={() => handleRemoveAccount(account.id)}
                      hitSlop={8}
                      className="ml-2 h-10 w-10 items-center justify-center rounded-full"
                    >
                      <Feather name="trash-2" size={17} color={isDark ? '#a3a3a3' : '#737373'} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          ) : (
            <View className="mb-4 rounded-2xl bg-neutral-100 px-4 py-5 dark:bg-neutral-900">
              <Text className="text-center text-sm text-neutral-500 dark:text-neutral-400">此设备还没有保存账号。</Text>
            </View>
          )}

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="添加其他账号"
            onPress={handleAddAccount}
            className="min-h-[52px] flex-row items-center justify-center gap-2 rounded-full bg-sky-500 px-5 py-3"
          >
            <Feather name="plus" size={19} color="#ffffff" />
            <Text className="font-bold text-white">{authStatus === 'authenticated' ? '添加其他账号' : '添加账号'}</Text>
            <Text className="text-xs font-semibold text-sky-100">{accounts.length}/{MAX_STORED_ACCOUNTS}</Text>
          </TouchableOpacity>

          {authStatus === 'authenticated' ? (
            <TouchableOpacity
              accessibilityRole="button"
              disabled={signOutBusy || Boolean(accountActionId)}
              onPress={() => void handleSignOut()}
              className="mt-3 min-h-[48px] flex-row items-center justify-center gap-2 rounded-full border border-neutral-300 px-5 py-3 dark:border-neutral-700"
            >
              <Feather name="log-out" size={18} color="#dc2626" />
              <Text className="font-bold text-red-600">{signOutBusy ? '正在退出…' : '退出当前账号'}</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            onPress={() => accountSheetRef.current?.dismiss()}
            className="mt-2 min-h-[44px] items-center justify-center rounded-full px-5 py-3"
          >
            <Text className="font-semibold text-neutral-600 dark:text-neutral-300">关闭</Text>
          </TouchableOpacity>
        </BottomSheetScrollView>
      </BottomSheetModal>
    </SafeAreaView>
  );
}

function DrawerLayout() {
  const { width } = useWindowDimensions();
  const segments = useSegments();
  const isGrokRoute = segments.includes('(grok)');
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  return (
    <Drawer
      drawerContent={(props) => <CustomDrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        swipeEnabled: isGrokRoute,
        swipeEdgeWidth: width,
        overlayColor: isDark ? '#000000b3' : '#adadad8c',
        drawerStyle: { width: '82%', backgroundColor: 'transparent' },
      }}
    >
      <Drawer.Screen name="index" options={{ headerShown: false }} />
      <Drawer.Screen name="(tabs)" options={{ headerShown: false }} />
      <Drawer.Screen name="profile" options={{ headerShown: false }} />
      <Drawer.Screen name="settings" options={{ headerShown: false }} />
      <Drawer.Screen name="about" options={{ headerShown: false, drawerItemStyle: { display: 'none' } }} />
      <Drawer.Screen name="sessions" options={{ headerShown: false, drawerItemStyle: { display: 'none' } }} />
      <Drawer.Screen name="bookmarks" options={{ headerShown: false }} />
      <Drawer.Screen name="notification-preferences" options={{ headerShown: false }} />
      <Drawer.Screen name="blocked-muted" options={{ headerShown: false }} />
      <Drawer.Screen name="billing" options={{ headerShown: false, drawerItemStyle: { display: 'none' } }} />
      <Drawer.Screen name="subscription-change" options={{ headerShown: false, drawerItemStyle: { display: 'none' } }} />
    </Drawer>
  );
}

export default DrawerLayout;
