import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useColorScheme } from 'nativewind';

import { FeedContent, FeedItem } from '~/components/FeedItem';
import { getApiErrorMessage } from '~/lib/api-client';
import { fetchBookmarksPage } from '~/lib/social-screen-api';
import {
  mapContentToFeedContent,
  readContentAuthor,
  readContentBody,
  readContentSocial,
  unwrapApiData,
  type ApiContentPage,
  type ApiContentRecord,
} from '~/lib/content-adapter';
import { readSessionToken } from '~/lib/secure-session';
import { useContentBookmark } from '~/lib/content-bookmark-state';
import { useAuthStore } from '~/store/auth-store';

const PRIMARY = '#1d9bf0';

function BookmarkFeedRow({
  item,
  viewerId,
  onOpen,
  onRemoved,
}: {
  item: FeedContent;
  viewerId: string;
  onOpen: (contentId: string) => void;
  onRemoved: (contentId: string, viewerId: string) => void;
}) {
  const bookmark = useContentBookmark(item.contentId);

  useEffect(() => {
    const contentId = item.contentId;
    // Only remove the row after the W05-backed status for this exact viewer is known.
    if (!contentId || !bookmark.loaded || bookmark.loading || bookmark.pending || bookmark.bookmarked) return;
    onRemoved(contentId, viewerId);
  }, [
    item.contentId,
    viewerId,
    bookmark.bookmarked,
    bookmark.loaded,
    bookmark.loading,
    bookmark.pending,
    onRemoved,
  ]);

  return (
    <FeedItem
      itemData={item}
      onPress={() => {
        if (item.contentId) onOpen(item.contentId);
      }}
    />
  );
}

export default function Bookmarks() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const router = useRouter();
  const authStatus = useAuthStore((state) => state.status);
  const viewerId = useAuthStore((state) => state.user?.id ?? null);
  const [items, setItems] = useState<FeedContent[]>([]);
  const [dataViewerId, setDataViewerId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [authRequired, setAuthRequired] = useState(false);

  const requestRef = useRef<AbortController | null>(null);
  const viewerIdRef = useRef<string | null>(viewerId);
  const authStatusRef = useRef(authStatus);
  const dataViewerIdRef = useRef<string | null>(null);
  const previousViewerIdRef = useRef<string | null>(viewerId);
  const previousAuthStatusRef = useRef(authStatus);

  useLayoutEffect(() => {
    viewerIdRef.current = viewerId;
    authStatusRef.current = authStatus;

    const identityChanged = previousViewerIdRef.current !== viewerId ||
      previousAuthStatusRef.current !== authStatus;
    if (!identityChanged) return;

    previousViewerIdRef.current = viewerId;
    previousAuthStatusRef.current = authStatus;
    requestRef.current?.abort();
    requestRef.current = null;
    dataViewerIdRef.current = null;
    setDataViewerId(null);
    setItems([]);
    setCursor(null);
    setHasMore(false);
    setLoading(authStatus === 'authenticated' && Boolean(viewerId));
    setLoadingMore(false);
    setError('');
    setAuthRequired(authStatus !== 'authenticated' || !viewerId);
  }, [authStatus, viewerId]);

  const isCurrentViewerData = Boolean(viewerId) && dataViewerId === viewerId;
  const visibleItems = isCurrentViewerData ? items : [];
  const visibleCursor = isCurrentViewerData ? cursor : null;
  const visibleHasMore = isCurrentViewerData && hasMore;
  const visibleLoadingMore = isCurrentViewerData && loadingMore;

  const removeUnbookmarkedItem = useCallback((contentId: string, ownerViewerId: string) => {
    if (
      viewerIdRef.current !== ownerViewerId ||
      authStatusRef.current !== 'authenticated' ||
      dataViewerIdRef.current !== ownerViewerId
    ) return;
    setItems((current) => current.filter((item) => item.contentId !== contentId));
  }, []);

  const openPost = useCallback((contentId: string) => {
    router.push(('/post/' + encodeURIComponent(contentId)) as never);
  }, [router]);

  const loadPage = useCallback(async (nextCursor: string | null, append: boolean) => {
    const requestViewerId = viewerId;
    if (authStatus === 'loading') return;
    if (authStatus !== 'authenticated' || !requestViewerId) {
      requestRef.current?.abort();
      requestRef.current = null;
      dataViewerIdRef.current = null;
      setDataViewerId(null);
      setItems([]);
      setCursor(null);
      setHasMore(false);
      setAuthRequired(true);
      setLoading(false);
      setLoadingMore(false);
      return;
    }
    if (append && dataViewerIdRef.current !== requestViewerId) return;

    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const isCurrentRequest = () => (
      !controller.signal.aborted &&
      viewerIdRef.current === requestViewerId &&
      authStatusRef.current === 'authenticated'
    );

    dataViewerIdRef.current = requestViewerId;
    setDataViewerId(requestViewerId);
    setError('');
    if (append) setLoadingMore(true);
    else setLoading(true);

    try {
      const result = await fetchBookmarksPage({ cursor: nextCursor, signal: controller.signal });
      if (!isCurrentRequest()) return;

      if (result.response.status === 401) {
        dataViewerIdRef.current = null;
        setDataViewerId(null);
        setAuthRequired(true);
        setItems([]);
        setCursor(null);
        setHasMore(false);
        return;
      }
      if (!result.response.ok) {
        throw new Error(getApiErrorMessage(result.data, '无法加载收藏内容。', result.response.status));
      }
      const page = unwrapApiData<ApiContentPage>(result.data);
      if (!page || !Array.isArray(page.items)) throw new Error('收藏接口返回的数据格式无效。');

      const sessionToken = await readSessionToken().catch(() => null);
      if (!isCurrentRequest()) return;
      const mapped = await Promise.all(page.items
        .filter((item): item is ApiContentRecord => Boolean(item && typeof item.id === 'string'))
        .map(async (item) => {
          const [body, social, author] = await Promise.all([
            readContentBody(item, undefined, sessionToken),
            readContentSocial(item.id),
            readContentAuthor(item),
          ]);
          return mapContentToFeedContent(item, body, social, author, sessionToken);
        }));
      if (!isCurrentRequest()) return;

      setItems((current) => {
        if (!append) return mapped;
        const seen = new Set(current.map((item) => item.contentId));
        return [...current, ...mapped.filter((item) => item.contentId && !seen.has(item.contentId))];
      });
      setCursor(page.nextCursor || null);
      setHasMore(page.hasMore === true);
      setAuthRequired(false);
    } catch (cause) {
      if (isCurrentRequest()) setError(cause instanceof Error ? cause.message : '无法加载收藏内容。');
    } finally {
      if (isCurrentRequest()) {
        setLoading(false);
        setLoadingMore(false);
      }
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [authStatus, viewerId]);

  useEffect(() => {
    if (authStatus !== 'loading') void loadPage(null, false);
  }, [authStatus, viewerId, loadPage]);

  useEffect(() => () => requestRef.current?.abort(), []);

  const requiresAuthentication = authRequired || authStatus !== 'authenticated' || !viewerId;
  const currentLoading = authStatus === 'loading' || (
    authStatus === 'authenticated' && !viewerId
  ) || (
    authStatus === 'authenticated' && Boolean(viewerId) && !authRequired &&
    (!isCurrentViewerData || loading)
  );

  if (currentLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  if (requiresAuthentication) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6 dark:bg-black">
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <Feather name="bookmark" size={34} color={PRIMARY} />
        <Text className="mt-4 text-lg font-bold text-neutral-900 dark:text-white">登录后查看收藏</Text>
        <Text className="mt-2 text-center text-sm text-neutral-500">收藏列表来自你的账号，不展示示例内容。</Text>
        <Pressable onPress={() => router.push('/login' as never)} className="mt-5 rounded-full bg-sky-500 px-6 py-3">
          <Text className="font-bold text-white">登录</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white dark:bg-black">
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <View className="flex-row items-center justify-between border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <Text className="text-xl font-bold text-neutral-900 dark:text-white">收藏</Text>
        <Pressable accessibilityRole="button" onPress={() => void loadPage(null, false)} disabled={currentLoading} className="p-2">
          <Feather name="refresh-cw" size={19} color={PRIMARY} />
        </Pressable>
      </View>
      {error ? (
        <View className="flex-row items-center justify-between px-4 py-3">
          <Text className="mr-3 flex-1 text-sm text-red-600">{error}</Text>
          <Pressable onPress={() => void loadPage(null, false)}><Text className="font-semibold text-sky-600">重试</Text></Pressable>
        </View>
      ) : null}
      <FlatList
        data={visibleItems}
        keyExtractor={(item, index) => item.contentId || 'bookmark-' + index}
        renderItem={({ item }) => (
          <BookmarkFeedRow
            item={item}
            viewerId={viewerId}
            onOpen={openPost}
            onRemoved={removeUnbookmarkedItem}
          />
        )}
        ListEmptyComponent={(
          <View className="items-center px-8 py-14">
            {loading ? <ActivityIndicator color={PRIMARY} /> : (
              <>
                <Feather name="bookmark" size={32} color="#9ca3af" />
                <Text className="mt-4 text-base font-semibold text-neutral-800 dark:text-neutral-100">
                  {error ? '暂时无法显示收藏' : '暂无收藏内容'}
                </Text>
                <Text className="mt-2 text-center text-sm text-neutral-500">
                  {error ? '请检查网络后重试。' : '收藏的真实内容会显示在这里。'}
                </Text>
              </>
            )}
          </View>
        )}
        ListFooterComponent={visibleLoadingMore ? (
          <ActivityIndicator className="py-5" color={PRIMARY} />
        ) : visibleHasMore ? (
          <Pressable onPress={() => void loadPage(visibleCursor, true)} className="items-center py-5">
            <Text className="font-semibold text-sky-600">加载更多</Text>
          </Pressable>
        ) : <View className="h-6" />}
      />
    </View>
  );
}
