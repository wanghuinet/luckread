import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StatusBar,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

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
import { useAuthStore } from '~/store/auth-store';

const PRIMARY = '#1d9bf0';

export default function Bookmarks() {
  const router = useRouter();
  const authStatus = useAuthStore((state) => state.status);
  const [items, setItems] = useState<FeedContent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [authRequired, setAuthRequired] = useState(false);

  const loadPage = useCallback(async (nextCursor: string | null, append: boolean) => {
    if (authStatus === 'loading') return;
    if (authStatus !== 'authenticated') {
      setAuthRequired(true);
      setItems([]);
      setLoading(false);
      setLoadingMore(false);
      return;
    }
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError('');

    try {
      const result = await fetchBookmarksPage({ cursor: nextCursor });
      if (result.response.status === 401) {
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
      setItems((current) => {
        if (!append) return mapped;
        const seen = new Set(current.map((item) => item.contentId));
        return [...current, ...mapped.filter((item) => item.contentId && !seen.has(item.contentId))];
      });
      setCursor(page.nextCursor || null);
      setHasMore(page.hasMore === true);
      setAuthRequired(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法加载收藏内容。');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [authStatus]);

  useEffect(() => {
    if (authStatus !== 'loading') void loadPage(null, false);
  }, [authStatus, loadPage]);

  if (authRequired) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6 dark:bg-black">
        <StatusBar barStyle="dark-content" />
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
      <StatusBar barStyle="dark-content" />
      <View className="flex-row items-center justify-between border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <Text className="text-xl font-bold text-neutral-900 dark:text-white">收藏</Text>
        <Pressable accessibilityRole="button" onPress={() => void loadPage(null, false)} disabled={loading} className="p-2">
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
        data={items}
        keyExtractor={(item, index) => item.contentId || 'bookmark-' + index}
        renderItem={({ item }) => <FeedItem itemData={item} onPress={() => {
          if (item.contentId) router.push(('/post/' + encodeURIComponent(item.contentId)) as never);
        }} />}
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
        ListFooterComponent={loadingMore ? (
          <ActivityIndicator className="py-5" color={PRIMARY} />
        ) : hasMore ? (
          <Pressable onPress={() => void loadPage(cursor, true)} className="items-center py-5">
            <Text className="font-semibold text-sky-600">加载更多</Text>
          </Pressable>
        ) : <View className="h-6" />}
      />
    </View>
  );
}
