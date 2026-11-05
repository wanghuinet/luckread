import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useColorScheme } from 'nativewind';

import { getApiErrorMessage } from '~/lib/api-client';
import {
  resolvePublicProfileById,
  unwrapApiData,
  type ApiPublicProfile,
} from '~/lib/content-adapter';
import {
  fetchManagedRelationshipsPage,
  type ManagedRelationshipKind,
} from '~/lib/block-mute-management-api';
import { unblockUser, unmuteUser } from '~/lib/social-screen-api';
import { useAuthStore } from '~/store/auth-store';

type RelationItem = {
  relationshipId: string;
  targetUserId: string;
  createdAt: string;
};

type RelationPage = {
  items: RelationItem[];
  nextCursor: string | null;
  hasMore: boolean;
};

type RelationRow = {
  relation: RelationItem;
  profile: ApiPublicProfile | null;
};

const PRIMARY = '#1d9bf0';

export default function BlockedMutedScreen() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const router = useRouter();
  const authStatus = useAuthStore((state) => state.status);
  const authUser = useAuthStore((state) => state.user);
  const accountId = authUser?.id ?? null;
  const authUserRef = useRef(authUser);
  authUserRef.current = authUser;
  const accountIdRef = useRef(accountId);
  accountIdRef.current = accountId;
  const [kind, setKind] = useState<ManagedRelationshipKind>('blocks');
  const [rows, setRows] = useState<RelationRow[]>([]);
  const [loadedAccountId, setLoadedAccountId] = useState<string | null>(null);
  const loadedAccountIdRef = useRef<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingTargetId, setPendingTargetId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const requestRef = useRef<AbortController | null>(null);

  const loadPage = useCallback(async (nextCursor: string | null, append: boolean, pullRefresh = false) => {
    if (authStatus !== 'authenticated') {
      setRows([]);
      loadedAccountIdRef.current = null;
      setLoadedAccountId(null);
      setCursor(null);
      setHasMore(false);
      setLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
      return;
    }

    if (append && requestRef.current) return;
    if (append && loadedAccountIdRef.current !== accountId) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setLoadingMore(false);
    }
    setError('');
    setRefreshing(pullRefresh);

    try {
      const result = await fetchManagedRelationshipsPage(kind, {
        cursor: nextCursor,
        limit: 20,
        signal: controller.signal,
      });
      if (result.response.status === 401) {
        if (!controller.signal.aborted && accountIdRef.current === accountId && authUserRef.current === authUser) {
          router.replace(('/login?returnTo=' + encodeURIComponent('/blocked-muted')) as never);
        }
        return;
      }
      const page = result.response.ok ? unwrapApiData<RelationPage>(result.data) : null;
      if (!result.response.ok || !page || !Array.isArray(page.items) ||
          typeof page.hasMore !== 'boolean' ||
          (page.nextCursor !== null && typeof page.nextCursor !== 'string')) {
        throw new Error(getApiErrorMessage(result.data, '无法读取列表，请重试。', result.response.status));
      }

      const resolved = await Promise.all(page.items.map(async (relation): Promise<RelationRow> => {
        const profile = await resolvePublicProfileById(relation.targetUserId, controller.signal);
        return { relation, profile };
      }));
      if (controller.signal.aborted || accountIdRef.current !== accountId || authUserRef.current !== authUser) return;

      loadedAccountIdRef.current = accountId;
      setLoadedAccountId(accountId);
      setRows((current) => {
        if (!append) return resolved;
        const known = new Set(current.map((row) => row.relation.relationshipId));
        return [...current, ...resolved.filter((row) => !known.has(row.relation.relationshipId))];
      });
      setCursor(page.nextCursor || null);
      setHasMore(page.hasMore);
    } catch (cause) {
      if (!controller.signal.aborted && accountIdRef.current === accountId && authUserRef.current === authUser) {
        setError(cause instanceof Error ? cause.message : '无法读取列表，请重试。');
      }
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      if (!controller.signal.aborted && accountIdRef.current === accountId && authUserRef.current === authUser) {
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
      }
    }
  }, [accountId, authStatus, authUser, kind, router]);

  useEffect(() => {
    setRows([]);
    loadedAccountIdRef.current = null;
    setLoadedAccountId(null);
    setCursor(null);
    setHasMore(false);
    setLoadingMore(false);
    setRefreshing(false);
    setPendingTargetId(null);
    setError('');
    void loadPage(null, false);
    return () => requestRef.current?.abort();
  }, [accountId, loadPage]);

  const confirmRemove = useCallback((row: RelationRow) => {
    if (pendingTargetId) return;
    const targetId = row.relation.targetUserId;
    const operationAccountId = accountId;
    const operationUser = authUser;
    const name = row.profile?.displayName?.trim() || row.profile?.username || '该用户';
    const isBlock = kind === 'blocks';

    Alert.alert(
      isBlock ? '解除屏蔽' : '取消静音',
      isBlock ? `确定解除对 ${name} 的屏蔽吗？` : `确定取消对 ${name} 的静音吗？`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: isBlock ? '解除屏蔽' : '取消静音',
          onPress: () => {
            void (async () => {
              setPendingTargetId(targetId);
              setError('');
              try {
                if (accountIdRef.current !== operationAccountId || authUserRef.current !== operationUser) return;
                const result = isBlock ? await unblockUser(targetId) : await unmuteUser(targetId);
                if (accountIdRef.current !== operationAccountId || authUserRef.current !== operationUser) return;
                if (result.response.status === 401) {
                  router.replace(('/login?returnTo=' + encodeURIComponent('/blocked-muted')) as never);
                  return;
                }
                if (!result.response.ok) {
                  throw new Error(result.error?.message || getApiErrorMessage(
                    result.data,
                    isBlock ? '解除屏蔽失败，请重试。' : '取消静音失败，请重试。',
                    result.response.status,
                  ));
                }
                setRows((current) => current.filter((item) => item.relation.targetUserId !== targetId));
              } catch (cause) {
                if (accountIdRef.current === operationAccountId && authUserRef.current === operationUser) {
                  setError(cause instanceof Error ? cause.message : '操作失败，请重试。');
                }
              } finally {
                if (accountIdRef.current === operationAccountId && authUserRef.current === operationUser) setPendingTargetId(null);
              }
            })();
          },
        },
      ],
    );
  }, [accountId, authUser, kind, pendingTargetId, router]);

  if (authStatus === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <ActivityIndicator color={PRIMARY} />
      </View>
    );
  }

  if (authStatus !== 'authenticated') {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6 dark:bg-black">
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <Feather name="shield" size={36} color={PRIMARY} />
        <Text className="mt-4 text-lg font-bold text-neutral-900 dark:text-white">请先登录</Text>
        <Text className="mt-2 text-center text-sm text-neutral-500">登录后可以管理你屏蔽和静音的账号。</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(('/login?returnTo=' + encodeURIComponent('/blocked-muted')) as never)}
          className="mt-5 rounded-full bg-sky-500 px-6 py-3"
        >
          <Text className="font-bold text-white">登录</Text>
        </Pressable>
      </View>
    );
  }

  const accountDataReady = loadedAccountId === accountId;
  const visibleRows = accountDataReady ? rows : [];
  const visibleHasMore = accountDataReady && hasMore;
  const visibleCursor = accountDataReady ? cursor : null;

  return (
    <View className="flex-1 bg-white dark:bg-black">
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <View className="flex-row items-center border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={() => router.back()} className="mr-4 rounded-full p-1">
          <Feather name="arrow-left" size={23} color="#6b7280" />
        </Pressable>
        <Text className="text-xl font-bold text-neutral-900 dark:text-white">屏蔽和静音</Text>
      </View>

      <View className="flex-row border-b border-neutral-100 px-4 dark:border-neutral-800">
        {([
          { value: 'blocks' as const, label: '已屏蔽' },
          { value: 'mutes' as const, label: '已静音' },
        ]).map((tab) => {
          const selected = kind === tab.value;
          return (
            <Pressable
              key={tab.value}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setKind(tab.value)}
              className="min-h-12 flex-1 items-center justify-center"
            >
              <Text className={selected ? 'font-bold text-neutral-900 dark:text-white' : 'font-semibold text-neutral-500'}>
                {tab.label}
              </Text>
              {selected ? <View className="absolute bottom-0 h-[3px] w-16 rounded-full bg-sky-500" /> : null}
            </Pressable>
          );
        })}
      </View>

      {error ? (
        <View className="flex-row items-center px-4 py-3">
          <Text accessibilityRole="alert" className="mr-3 flex-1 text-sm text-rose-600">{error}</Text>
          <Pressable accessibilityRole="button" onPress={() => void loadPage(null, false)} disabled={loading}>
            <Text className="font-bold text-sky-600">重试</Text>
          </Pressable>
        </View>
      ) : null}

      <FlatList
        data={visibleRows}
        keyExtractor={(item) => item.relation.relationshipId}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadPage(null, false, true)} />}
        renderItem={({ item }) => {
          const name = item.profile?.displayName?.trim() || item.profile?.username || 'LuckRead 用户';
          const username = item.profile?.username || item.relation.targetUserId;
          const working = pendingTargetId === item.relation.targetUserId;
          return (
            <View className="flex-row items-center border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
              {item.profile?.avatar ? (
                <Image source={{ uri: item.profile.avatar }} className="h-11 w-11 rounded-full bg-neutral-200 dark:bg-neutral-800" />
              ) : (
                <View className="h-11 w-11 items-center justify-center rounded-full bg-neutral-200 dark:bg-neutral-800">
                  <Feather name="user" size={21} color="#6b7280" />
                </View>
              )}
              <View className="ml-3 flex-1">
                <Text numberOfLines={1} className="font-bold text-neutral-900 dark:text-white">{name}</Text>
                <Text numberOfLines={1} className="mt-1 text-sm text-neutral-500">@{username}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={kind === 'blocks' ? '解除屏蔽' : '取消静音'}
                disabled={pendingTargetId !== null}
                onPress={() => confirmRemove(item)}
                className={working ? 'rounded-full border border-neutral-300 px-3 py-2 opacity-50 dark:border-neutral-700' : 'rounded-full border border-neutral-300 px-3 py-2 dark:border-neutral-700'}
              >
                <Text className="text-sm font-bold text-sky-600">
                  {working ? '处理中…' : kind === 'blocks' ? '解除屏蔽' : '取消静音'}
                </Text>
              </Pressable>
            </View>
          );
        }}
        ListEmptyComponent={(
          <View className="items-center px-8 py-14">
            {loading || !accountDataReady ? <ActivityIndicator color={PRIMARY} /> : (
              <>
                <Feather name={kind === 'blocks' ? 'slash' : 'volume-x'} size={32} color="#9ca3af" />
                <Text className="mt-4 text-base font-semibold text-neutral-800 dark:text-neutral-100">
                  {error ? '暂时无法显示列表' : kind === 'blocks' ? '没有已屏蔽的账号' : '没有已静音的账号'}
                </Text>
                <Text className="mt-2 text-center text-sm text-neutral-500">
                  {error ? '请检查网络后重试。' : '列表来自你的账号设置，没有示例数据。'}
                </Text>
              </>
            )}
          </View>
        )}
        ListFooterComponent={loadingMore ? (
          <ActivityIndicator className="py-5" color={PRIMARY} />
        ) : visibleHasMore && visibleCursor ? (
          <Pressable accessibilityRole="button" onPress={() => void loadPage(visibleCursor, true)} disabled={loadingMore} className="items-center py-5">
            <Text className="font-bold text-sky-600">加载更多</Text>
          </Pressable>
        ) : <View className="h-5" />}
        onEndReached={() => {
          if (visibleHasMore && visibleCursor && !loadingMore && !loading && !error) void loadPage(visibleCursor, true);
        }}
        onEndReachedThreshold={0.4}
      />
    </View>
  );
}
