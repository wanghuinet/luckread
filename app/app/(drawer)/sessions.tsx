import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getApiErrorMessage } from '~/lib/api-client';
import {
  fetchSessionListPage,
  parseSessionListPage,
  revokeSession,
  type SessionListItem,
} from '~/lib/session-management-api';
import { useAuthStore } from '~/store/auth-store';

const PRIMARY = '#1d9bf0';
const SESSION_RETURN_TO = '/sessions';
// Step 5 remains hidden until security admission and unified device acceptance.
const SESSION_MANAGEMENT_ADMITTED = false;

function formatSessionDate(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default function SessionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const authStatus = useAuthStore((state) => state.status);
  const authUser = useAuthStore((state) => state.user);
  const accountId = authUser?.id ?? null;
  const authUserRef = useRef(authUser);
  authUserRef.current = authUser;
  const accountIdRef = useRef(accountId);
  accountIdRef.current = accountId;
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loadedAccountId, setLoadedAccountId] = useState<string | null>(null);
  const [loadedAuthUser, setLoadedAuthUser] = useState<typeof authUser>(null);
  const [currentSessionId, setCurrentSessionId] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const requestRef = useRef<AbortController | null>(null);

  const loadPage = useCallback(async (
    cursor: string | null,
    append: boolean,
    pullRefresh = false,
  ) => {
    if (!SESSION_MANAGEMENT_ADMITTED || authStatus === 'loading') return;
    if (authStatus !== 'authenticated') {
      requestRef.current?.abort();
      requestRef.current = null;
      setSessions([]);
      setCurrentSessionId('');
      setNextCursor(null);
      setLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
      return;
    }

    if (requestRef.current && !pullRefresh) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError('');
    setNotice('');
    if (pullRefresh) setRefreshing(true);

    try {
      const result = await fetchSessionListPage({
        cursor,
        signal: controller.signal,
      });
      if (controller.signal.aborted || accountIdRef.current !== accountId || authUserRef.current !== authUser) return;

      if (result.response.status === 401) {
        router.replace(('/login?returnTo=' + encodeURIComponent(SESSION_RETURN_TO)) as never);
        return;
      }

      const page = result.response.ok ? parseSessionListPage(result.data) : null;
      if (!result.response.ok || !page) {
        throw new Error(result.error?.message || getApiErrorMessage(
          result.data,
          append ? '无法加载更多登录会话，请重试。' : '无法读取登录会话，请重试。',
          result.response.status,
        ));
      }

      setSessions((current) => {
        if (!append) return page.items;
        const known = new Set(current.map((session) => session.sessionId));
        return [...current, ...page.items.filter((session) => !known.has(session.sessionId))];
      });
      setCurrentSessionId(page.currentSessionId);
      setNextCursor(page.nextCursor);
      setLoadedAccountId(accountId);
      setLoadedAuthUser(authUser);
    } catch (cause) {
      if (!controller.signal.aborted && accountIdRef.current === accountId && authUserRef.current === authUser) {
        setError(cause instanceof Error ? cause.message : '无法读取登录会话，请重试。');
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        if (!controller.signal.aborted && accountIdRef.current === accountId && authUserRef.current === authUser) {
          setLoading(false);
          setLoadingMore(false);
          setRefreshing(false);
        }
      }
    }
  }, [accountId, authStatus, authUser, router]);

  useEffect(() => {
    if (!SESSION_MANAGEMENT_ADMITTED) return;
    setSessions([]);
    setLoadedAccountId(null);
    setLoadedAuthUser(null);
    setCurrentSessionId('');
    setNextCursor(null);
    setError('');
    setNotice('');
    setRevokingId(null);
    void loadPage(null, false);
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [accountId, loadPage]);

  const runRevoke = useCallback(async (
    sessionId: string,
    operationAccountId: string | null,
    operationUser: typeof authUser,
  ) => {
    if (!SESSION_MANAGEMENT_ADMITTED || sessionId === currentSessionId || revokingId ||
        accountIdRef.current !== operationAccountId || authUserRef.current !== operationUser) return;

    setRevokingId(sessionId);
    setError('');
    setNotice('');
    try {
      const result = await revokeSession(sessionId);
      if (accountIdRef.current !== operationAccountId || authUserRef.current !== operationUser) return;
      if (result.response.status === 401) {
        router.replace(('/login?returnTo=' + encodeURIComponent(SESSION_RETURN_TO)) as never);
        return;
      }
      if (!result.response.ok) {
        throw new Error(result.error?.message || getApiErrorMessage(
          result.data,
          '退出此登录会话失败，请重试。',
          result.response.status,
        ));
      }

      setSessions((current) => current.filter((item) => item.sessionId !== sessionId));
      setNotice('已退出该登录会话。');
    } catch (cause) {
      if (accountIdRef.current === operationAccountId && authUserRef.current === operationUser) {
        setError(cause instanceof Error ? cause.message : '退出此登录会话失败，请重试。');
      }
    } finally {
      if (accountIdRef.current === operationAccountId && authUserRef.current === operationUser) {
        setRevokingId(null);
      }
    }
  }, [accountId, authUser, currentSessionId, revokingId, router]);

  const confirmRevoke = useCallback((sessionId: string) => {
    if (!SESSION_MANAGEMENT_ADMITTED || !sessionId || sessionId === currentSessionId || revokingId) return;
    const operationAccountId = accountId;
    const operationUser = authUser;
    Alert.alert(
      '退出此会话',
      '退出后，该登录会话将立即失效；对应设备需要重新登录才能继续使用 LuckRead。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '退出会话',
          style: 'destructive',
          onPress: () => { void runRevoke(sessionId, operationAccountId, operationUser); },
        },
      ],
    );
  }, [accountId, authUser, currentSessionId, revokingId, runRevoke]);

  const retry = useCallback(() => {
    void loadPage(null, false);
  }, [loadPage]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loading || loadingMore) return;
    void loadPage(nextCursor, true);
  }, [loadPage, loading, loadingMore, nextCursor]);

  if (!SESSION_MANAGEMENT_ADMITTED) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6 dark:bg-black" style={{ paddingTop: insets.top }}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <Feather name="lock" size={32} color={PRIMARY} />
        <Text className="mt-4 text-lg font-bold text-neutral-900 dark:text-white">登录会话管理暂未开放</Text>
        <Text className="mt-2 text-center text-sm text-neutral-500 dark:text-neutral-400">此功能仍在安全准入和统一验收阶段。</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} className="mt-5 min-h-11 items-center justify-center rounded-full border border-neutral-300 px-6 dark:border-neutral-700">
          <Text className="font-bold text-sky-600">返回设置</Text>
        </Pressable>
      </View>
    );
  }

  const accountDataReady = loadedAccountId === accountId && loadedAuthUser === authUser;
  const visibleSessions = accountDataReady ? sessions : [];

  if (authStatus === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <ActivityIndicator color={PRIMARY} />
      </View>
    );
  }

  if (authStatus !== 'authenticated') {
    return (
      <View
        className="flex-1 items-center justify-center bg-white px-6 dark:bg-black"
        style={{ paddingTop: insets.top }}
      >
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <Feather name="smartphone" size={36} color={PRIMARY} />
        <Text className="mt-4 text-lg font-bold text-neutral-900 dark:text-white">请先登录</Text>
        <Text className="mt-2 text-center text-sm text-neutral-500">
          登录后可以查看并管理你的登录会话。
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(('/login?returnTo=' + encodeURIComponent(SESSION_RETURN_TO)) as never)}
          className="mt-5 min-h-11 items-center justify-center rounded-full bg-sky-500 px-6"
        >
          <Text className="font-bold text-white">登录</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-neutral-50 dark:bg-black" style={{ paddingTop: insets.top }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack.Screen options={{ headerShown: false, title: '登录会话' }} />
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
          <Text className="text-lg font-bold text-neutral-900 dark:text-white">登录会话</Text>
          <Text className="text-xs text-neutral-500 dark:text-neutral-400">查看当前账号的有效登录会话</Text>
        </View>
      </View>

      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadPage(null, false, true)}
            tintColor={PRIMARY}
          />
        }
        contentContainerStyle={{ paddingTop: 12, paddingBottom: Math.max(insets.bottom, 16) + 20 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="px-4 pb-3">
          <Text className="text-sm leading-6 text-neutral-600 dark:text-neutral-400">
            查看当前账号的登录会话。当前会话无法从此页面退出；退出其他会话后，对应登录状态会由身份服务撤销。
          </Text>
        </View>

        {error ? (
          <View className="mx-4 mb-3 flex-row items-center rounded-xl bg-rose-50 px-3 py-3 dark:bg-rose-950/30">
            <Text accessibilityRole="alert" className="mr-3 flex-1 text-sm text-rose-700 dark:text-rose-300">
              {error}
            </Text>
            <Pressable accessibilityRole="button" onPress={retry} disabled={loading}>
              <Text className="font-bold text-sky-600">重试</Text>
            </Pressable>
          </View>
        ) : null}

        {notice ? (
          <View className="mx-4 mb-3 rounded-xl bg-emerald-50 px-3 py-3 dark:bg-emerald-950/30">
            <Text accessibilityRole="status" className="text-sm text-emerald-700 dark:text-emerald-300">
              {notice}
            </Text>
          </View>
        ) : null}

        {loading && visibleSessions.length === 0 ? (
          <View className="items-center py-12">
            <ActivityIndicator color={PRIMARY} />
            <Text className="mt-3 text-sm text-neutral-500">正在加载登录会话…</Text>
          </View>
        ) : null}

        {!loading && visibleSessions.length === 0 && !error ? (
          <View className="items-center px-8 py-12">
            <Feather name="smartphone" size={32} color="#9ca3af" />
            <Text className="mt-4 text-base font-semibold text-neutral-800 dark:text-neutral-100">
              暂无可显示的登录会话
            </Text>
            <Text className="mt-2 text-center text-sm text-neutral-500">
              会话列表由身份服务提供，不会使用示例数据。
            </Text>
          </View>
        ) : null}

        {visibleSessions.map((session) => {
          const isCurrent = session.sessionId === currentSessionId;
          const isRevoking = revokingId === session.sessionId;
          return (
            <View
              key={session.sessionId}
              className="mx-4 mb-3 rounded-2xl border border-neutral-200 bg-white px-4 py-4 dark:border-neutral-800 dark:bg-neutral-950"
            >
              <View className="flex-row items-start justify-between">
                <View className="mr-3 flex-1">
                  <Text className="text-[15px] font-bold text-neutral-900 dark:text-white">
                    {isCurrent ? '当前会话' : '其他登录会话'}
                  </Text>
                  <Text className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
                    {isCurrent ? '此会话正在用于当前 APP 操作' : '此会话可以单独退出'}
                  </Text>
                </View>
                {isCurrent ? (
                  <View className="rounded-full bg-sky-500/10 px-3 py-1.5">
                    <Text className="text-xs font-bold text-sky-600">正在使用</Text>
                  </View>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="退出此会话"
                    accessibilityHint="撤销该登录会话，需要确认后执行"
                    disabled={revokingId !== null}
                    onPress={() => confirmRevoke(session.sessionId)}
                    className={
                      'min-h-10 items-center justify-center rounded-full border border-neutral-300 px-4 dark:border-neutral-700' +
                      (isRevoking ? ' opacity-50' : '')
                    }
                  >
                    <Text className="text-sm font-bold text-rose-600">
                      {isRevoking ? '退出中…' : '退出会话'}
                    </Text>
                  </Pressable>
                )}
              </View>

              <View className="mt-4 flex-row border-t border-neutral-100 pt-3 dark:border-neutral-800">
                <View className="mr-4 flex-1">
                  <Text className="text-xs text-neutral-500 dark:text-neutral-400">登录时间</Text>
                  <Text className="mt-1 text-sm text-neutral-800 dark:text-neutral-200">
                    {formatSessionDate(session.createdAt)}
                  </Text>
                </View>
                <View className="flex-1">
                  <Text className="text-xs text-neutral-500 dark:text-neutral-400">到期时间</Text>
                  <Text className="mt-1 text-sm text-neutral-800 dark:text-neutral-200">
                    {formatSessionDate(session.expiresAt)}
                  </Text>
                </View>
              </View>
            </View>
          );
        })}

        {nextCursor ? (
          <Pressable
            accessibilityRole="button"
            onPress={loadMore}
            disabled={loadingMore || loading}
            className="mx-4 mt-1 min-h-11 items-center justify-center rounded-full border border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-950"
          >
            {loadingMore ? (
              <ActivityIndicator color={PRIMARY} />
            ) : (
              <Text className="font-bold text-sky-600">加载更多</Text>
            )}
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}
