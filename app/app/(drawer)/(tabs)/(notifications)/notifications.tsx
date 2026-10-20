import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StatusBar,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { getApiErrorMessage } from '~/lib/api-client';
import { fetchNotificationsPage, markAllNotificationsRead, markNotificationRead } from '~/lib/social-screen-api';
import { resolvePublicProfileById, unwrapApiData } from '~/lib/content-adapter';
import { useAuthStore } from '~/store/auth-store';

type NotificationType = 'FOLLOW' | 'LIKE' | 'COMMENT' | 'REPLY' | 'MENTION';
type NotificationFilter = 'all' | 'mentions';

type SocialNotification = {
  id: string;
  type: NotificationType;
  actorUserId: string;
  targetType: 'user' | 'content' | 'comment';
  targetId: string;
  payload?: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

type NotificationPage = {
  items: SocialNotification[];
  unreadCount: number;
  nextCursor: string | null;
  hasMore: boolean;
};

type PublicUser = {
  id: string;
  username?: string;
  displayName?: string | null;
  avatar?: string | null;
};

const PRIMARY = '#1d9bf0';

function messageFor(item: SocialNotification): string {
  switch (item.type) {
    case 'FOLLOW': return '开始关注你';
    case 'LIKE': return '赞了你的内容';
    case 'COMMENT': return '评论了你的内容';
    case 'REPLY': return '回复了你的评论';
    case 'MENTION': return '在内容中提到了你';
    default: return '与你互动';
  }
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function resolveContentId(item: SocialNotification): string | null {
  if (item.targetType === 'content') return item.targetId;
  if (item.targetType === 'comment' && typeof item.payload?.contentId === 'string') {
    return item.payload.contentId.trim() || null;
  }
  return null;
}

export default function Notifications() {
  const router = useRouter();
  const authStatus = useAuthStore((state) => state.status);
  const [items, setItems] = useState<SocialNotification[]>([]);
  const [actorProfiles, setActorProfiles] = useState<Record<string, PublicUser>>({});
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [readAllBusy, setReadAllBusy] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState('');
  const [authRequired, setAuthRequired] = useState(false);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const requestedActorsRef = useRef(new Set<string>());

  const loadActorProfiles = useCallback(async (notifications: SocialNotification[], signal: AbortSignal) => {
    const actorIds = Array.from(new Set(notifications.map((item) => item.actorUserId)))
      .filter((id) => id && !requestedActorsRef.current.has(id));
    actorIds.forEach((id) => requestedActorsRef.current.add(id));
    const results = await Promise.all(actorIds.map(async (id) => ({
      id,
      profile: await resolvePublicProfileById(id, signal),
    })));
    if (signal.aborted) {
      actorIds.forEach((id) => requestedActorsRef.current.delete(id));
      return;
    }
    setActorProfiles((current) => {
      const next = { ...current };
      // Key by the notification's actor ID, not the mapped Payload profile ID.
      for (const result of results) {
        if (result.profile?.id) next[result.id] = result.profile;
      }
      return next;
    });
    // Permit retry for profile lookups that failed transiently.
    results.forEach((result) => {
      if (!result.profile) requestedActorsRef.current.delete(result.id);
    });
  }, []);

  const loadPage = useCallback(async (nextCursor: string | null, append: boolean) => {
    if (authStatus === 'loading') return;
    if (authStatus !== 'authenticated') {
      setAuthRequired(true);
      setItems([]);
      setCursor(null);
      setHasMore(false);
      setUnreadCount(0);
      setLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = ++requestIdRef.current;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError('');

    try {
      const result = await fetchNotificationsPage({
        cursor: nextCursor,
        filter,
        signal: controller.signal,
      });
      if (requestId !== requestIdRef.current || controller.signal.aborted) return;

      if (result.response.status === 401) {
        setAuthRequired(true);
        setItems([]);
        setUnreadCount(0);
        setCursor(null);
        setHasMore(false);
        return;
      }

      const page = result.response.ok ? unwrapApiData<NotificationPage>(result.data) : null;
      if (!page || !Array.isArray(page.items)) {
        throw new Error(getApiErrorMessage(result.data, '无法加载通知，请重试。', result.response.status));
      }

      setAuthRequired(false);
      setItems((current) => {
        if (!append) return page.items;
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !seen.has(item.id))];
      });
      setUnreadCount(Math.max(0, Number(page.unreadCount) || 0));
      setCursor(page.nextCursor || null);
      setHasMore(page.hasMore === true);
      void loadActorProfiles(page.items, controller.signal);
    } catch (cause) {
      if (requestId !== requestIdRef.current || controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : '无法加载通知，请重试。');
    } finally {
      if (requestId === requestIdRef.current && !controller.signal.aborted) {
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
        if (abortRef.current === controller) abortRef.current = null;
      }
    }
  }, [authStatus, filter, loadActorProfiles]);

  useEffect(() => {
    if (authStatus !== 'loading') void loadPage(null, false);
    return () => {
      abortRef.current?.abort();
    };
  }, [authStatus, filter, loadPage]);

  const markRead = useCallback(async (item: SocialNotification) => {
    if (item.readAt || busyIds.has(item.id)) return;
    setBusyIds((current) => new Set(current).add(item.id));
    setError('');
    try {
      const result = await markNotificationRead(item.id);
      if (!result.response.ok) {
        throw new Error(getApiErrorMessage(result.data, '无法标记通知为已读。', result.response.status));
      }
      const readAt = new Date().toISOString();
      setItems((current) => current.map((candidate) =>
        candidate.id === item.id && !candidate.readAt ? { ...candidate, readAt } : candidate,
      ));
      setUnreadCount((count) => Math.max(0, count - 1));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法标记通知为已读。');
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  }, [busyIds]);

  const markAllRead = useCallback(async () => {
    if (unreadCount <= 0 || readAllBusy) return;
    setReadAllBusy(true);
    setError('');
    try {
      const result = await markAllNotificationsRead();
      if (!result.response.ok) {
        throw new Error(getApiErrorMessage(result.data, '无法将通知全部标记为已读。', result.response.status));
      }
      const readAt = new Date().toISOString();
      setItems((current) => current.map((item) => item.readAt ? item : { ...item, readAt }));
      setUnreadCount(0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法将通知全部标记为已读。');
    } finally {
      setReadAllBusy(false);
    }
  }, [readAllBusy, unreadCount]);

  const filteredItems = useMemo(
    () => filter === 'mentions' ? items.filter((item) => item.type === 'MENTION') : items,
    [filter, items],
  );

  const openNotification = useCallback((item: SocialNotification) => {
    void markRead(item);
    const contentId = resolveContentId(item);
    if (contentId) {
      router.push(('/post/' + encodeURIComponent(contentId)) as never);
      return;
    }
    const actor = actorProfiles[item.actorUserId];
    if (actor?.username || actor?.id) {
      router.push(('/profile/' + encodeURIComponent(actor.username || actor.id)) as never);
    }
  }, [actorProfiles, markRead, router]);

  const renderItem = useCallback(({ item }: { item: SocialNotification }) => {
    const profile = actorProfiles[item.actorUserId];
    const displayName = profile?.displayName?.trim() || (profile?.username ? '@' + profile.username : '') ||
      (typeof item.payload?.handle === 'string' ? '@' + item.payload.handle.replace(/^@/, '') : '') ||
      'LuckRead 用户';
    const initial = displayName.slice(0, 1).toUpperCase() || 'L';
    const icon = item.type === 'FOLLOW' ? 'user-plus'
      : item.type === 'LIKE' ? 'heart'
        : item.type === 'MENTION' ? 'at-sign' : 'message-circle';
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={displayName + messageFor(item)}
        onPress={() => openNotification(item)}
        className={'flex-row gap-3 border-b border-neutral-100 px-4 py-4 dark:border-neutral-800 ' + (item.readAt ? 'bg-white dark:bg-black' : 'bg-sky-50 dark:bg-sky-950/30')}
      >
        <View className="relative h-11 w-11 items-center justify-center">
          {profile?.avatar ? (
            <Image source={{ uri: profile.avatar }} className="h-11 w-11 rounded-full" />
          ) : (
            <View className="h-11 w-11 items-center justify-center rounded-full bg-neutral-200 dark:bg-neutral-700">
              <Text className="font-bold text-neutral-700 dark:text-neutral-100">{initial}</Text>
            </View>
          )}
          <View className="absolute -bottom-1 -right-1 h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-sky-50 dark:border-black dark:bg-neutral-900">
            <Feather name={icon as 'user-plus' | 'heart' | 'at-sign' | 'message-circle'} size={12} color={PRIMARY} />
          </View>
        </View>
        <View className="flex-1">
          <View className="flex-row items-start gap-2">
            <Text className="flex-1 text-base leading-6 text-neutral-900 dark:text-neutral-100">
              <Text className="font-bold">{displayName}</Text>
              {' ' + messageFor(item)}
            </Text>
            {!item.readAt ? <View className="mt-2 h-2 w-2 rounded-full bg-sky-500" /> : null}
          </View>
          {typeof item.payload?.excerpt === 'string' && item.payload.excerpt.trim() ? (
            <Text numberOfLines={3} className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
              {item.payload.excerpt}
            </Text>
          ) : null}
          <Text className="mt-2 text-xs text-neutral-500">{formatTimestamp(item.createdAt)}</Text>
          {!item.readAt ? (
            <Pressable
              accessibilityRole="button"
              className="mt-2 self-start rounded-full border border-neutral-300 px-3 py-1 dark:border-neutral-700"
              disabled={busyIds.has(item.id)}
              onPress={(event) => {
                event.stopPropagation();
                void markRead(item);
              }}
            >
              <Text className="text-xs font-semibold text-neutral-700 dark:text-neutral-200">
                {busyIds.has(item.id) ? '处理中…' : '标记已读'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </Pressable>
    );
  }, [actorProfiles, busyIds, markRead, openNotification]);

  const header = (
    <View className="bg-white dark:bg-black">
      <View className="flex-row items-center justify-between border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <Text className="text-xl font-bold text-neutral-900 dark:text-white">通知</Text>
        <Pressable
          accessibilityRole="button"
          disabled={unreadCount === 0 || readAllBusy}
          onPress={() => void markAllRead()}
          className="rounded-full px-3 py-2"
        >
          <Text className={'text-sm font-semibold ' + (unreadCount === 0 ? 'text-neutral-400' : 'text-sky-600')}>
            {readAllBusy ? '处理中…' : unreadCount > 0 ? '全部标记已读' : '全部已读'}
          </Text>
        </Pressable>
      </View>
      <View className="flex-row border-b border-neutral-100 dark:border-neutral-800">
        {(['all', 'mentions'] as const).map((tab) => (
          <Pressable
            key={tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: filter === tab }}
            onPress={() => setFilter(tab)}
            className="flex-1 items-center py-3"
          >
            <Text className={'font-semibold ' + (filter === tab ? 'text-neutral-900 dark:text-white' : 'text-neutral-500')}>
              {tab === 'all' ? '全部' : '提及'}
            </Text>
            {filter === tab ? <View className="mt-2 h-1 w-12 rounded-full bg-sky-500" /> : null}
          </Pressable>
        ))}
      </View>
      {error ? (
        <View className="flex-row items-center justify-between px-4 py-3">
          <Text className="mr-3 flex-1 text-sm text-red-600">{error}</Text>
          <Pressable onPress={() => void loadPage(null, false)}>
            <Text className="font-semibold text-sky-600">重试</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  if (authRequired) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6 dark:bg-black">
        <StatusBar barStyle="dark-content" />
        <Feather name="bell" size={34} color={PRIMARY} />
        <Text className="mt-4 text-lg font-bold text-neutral-900 dark:text-white">登录后查看通知</Text>
        <Text className="mt-2 text-center text-sm text-neutral-500">通知只展示账号真实收到的互动，不使用示例内容。</Text>
        <Pressable onPress={() => router.push('/login' as never)} className="mt-5 rounded-full bg-sky-500 px-6 py-3">
          <Text className="font-bold text-white">登录</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white dark:bg-black">
      <StatusBar barStyle="dark-content" />
      <FlatList
        data={filteredItems}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={(
          <View className="items-center px-6 py-14">
            {loading ? <ActivityIndicator color={PRIMARY} /> : (
              <>
                <Feather name="bell" size={34} color="#9ca3af" />
                <Text className="mt-4 text-base font-semibold text-neutral-800 dark:text-neutral-100">
                  {error ? '暂时无法显示通知' : filter === 'mentions' ? '暂无提及通知' : '暂无通知'}
                </Text>
                <Text className="mt-2 text-center text-sm text-neutral-500">
                  {error ? '请检查网络后重试。' : '当有人关注、点赞、评论或提及你时，会显示在这里。'}
                </Text>
                {error ? <Pressable onPress={() => void loadPage(null, false)} className="mt-4 rounded-full border border-neutral-300 px-4 py-2"><Text className="font-semibold">重试</Text></Pressable> : null}
              </>
            )}
          </View>
        )}
        ListFooterComponent={loadingMore ? (
          <ActivityIndicator className="py-5" color={PRIMARY} />
        ) : hasMore ? (
          <Pressable onPress={() => void loadPage(cursor, true)} className="items-center py-5">
            <Text className="font-semibold text-sky-600">加载更多</Text>
          </Pressable>
        ) : <View className="h-6" />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => {
          setRefreshing(true);
          void loadPage(null, false);
        }} tintColor={PRIMARY} />}
      />
    </View>
  );
}
