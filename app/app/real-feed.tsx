import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, SafeAreaView, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ApiError, FeedItem, getCurrentSession, getFollowingFeed, logout } from '~/lib/luckread-api';

const textValue = (value: unknown): string => typeof value === 'string' ? value : '';

export default function RealFeedScreen() {
  const router = useRouter();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      await getCurrentSession();
      const result = await getFollowingFeed();
      setItems(result.items);
      setNextCursor(result.nextCursor);
    } catch (e) {
      const err = e as ApiError;
      setError(err.message || '信息流加载失败。');
      if (err.status === 401) router.replace('/login');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore || loading || refreshing) return;
    setLoadingMore(true);
    try {
      const result = await getFollowingFeed(nextCursor);
      setItems(current => [...current, ...result.items.filter(item => !current.some(old => old.id === item.id))]);
      setNextCursor(result.nextCursor);
    } catch (e) {
      setError((e as Error).message || '加载更多失败。');
    } finally {
      setLoadingMore(false);
    }
  };

  const signOut = async () => {
    await logout();
    router.replace('/login');
  };

  const renderItem = ({ item }: { item: FeedItem }) => {
    const author = item.author?.name || textValue(item.authorName) || item.author?.username || textValue(item.authorHandle) || 'LuckRead 用户';
    const body = textValue(item.text) || textValue(item.content) || textValue(item.body) || textValue(item.message) || textValue(item.title) || '（此动态暂无可显示的文本）';
    const date = textValue(item.createdAt) || textValue(item.created_at) || textValue(item.publishedAt);
    return (
      <View className="border-b border-neutral-200 px-4 py-4 dark:border-neutral-800">
        <Text className="font-semibold text-black dark:text-white">{author}</Text>
        {!!date && <Text className="mt-1 text-xs text-neutral-500">{date}</Text>}
        <Text className="mt-2 text-base leading-6 text-black dark:text-white">{body}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
      <View className="flex-row items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <View>
          <Text className="text-xl font-bold text-black dark:text-white">LuckRead</Text>
          <Text className="text-xs text-neutral-500">Following · 实时 API</Text>
        </View>
        <TouchableOpacity accessibilityRole="button" onPress={signOut}>
          <Text className="font-semibold text-sky-600">退出登录</Text>
        </TouchableOpacity>
      </View>
      {loading ? <View className="flex-1 items-center justify-center"><ActivityIndicator size="large" /></View> : (
        <FlatList
          data={items}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={<View className="px-6 py-12"><Text className="text-center text-neutral-500">{error || '暂时没有关注动态。关注创作者后，这里会显示他们的内容。'}</Text></View>}
          ListFooterComponent={loadingMore ? <ActivityIndicator className="py-4" /> : null}
        />
      )}
      {!!error && !loading && items.length > 0 && <Text className="px-4 py-2 text-sm text-red-600">{error}</Text>}
      {!loading && !!error && items.length === 0 && <TouchableOpacity onPress={() => void load(true)} className="items-center py-3"><Text className="font-semibold text-sky-600">重试</Text></TouchableOpacity>}
    </SafeAreaView>
  );
}
