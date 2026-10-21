import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Text, TouchableOpacity, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { ProfileImage } from '~/components/FeedItem';
import {
  fetchContentLikesPage,
  fetchPostInteractionSummary,
  type ContentLike,
  type PostInteractionSummary,
} from '~/lib/post-interactions-api';
import { resolvePublicProfileById } from '~/lib/content-adapter';

type LikeRow = ContentLike & {
  profileId: string;
  displayName: string;
  username?: string;
  avatar?: string | null;
};

const interactionLabels: Array<{ key: keyof PostInteractionSummary; label: string }> = [
  { key: 'likeCount', label: 'Likes' },
  { key: 'repostCount', label: 'Reposts' },
  { key: 'replyCount', label: 'Replies' },
  { key: 'viewCount', label: 'Views' },
];

function likedAtLabel(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  return 'Liked ' + new Date(timestamp).toLocaleDateString();
}

export default function PostInteractionsScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const rawId = params.id;
  const postId = Array.isArray(rawId) ? rawId[0] || '' : rawId || '';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [summary, setSummary] = useState<PostInteractionSummary>({});
  const [items, setItems] = useState<LikeRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const hydrateLikes = useCallback(async (
    likes: ContentLike[],
    signal: AbortSignal,
  ): Promise<LikeRow[]> => Promise.all(likes.map(async (like) => {
    try {
      const profile = await resolvePublicProfileById(like.userId, signal);
      return {
        ...like,
        profileId: profile?.id || like.userId,
        displayName: profile?.displayName?.trim() || profile?.username || like.userId,
        ...(profile?.username ? { username: profile.username } : {}),
        avatar: profile?.avatar ?? null,
      };
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') throw cause;
      return {
        ...like,
        profileId: like.userId,
        displayName: like.userId,
        avatar: null,
      };
    }
  })), []);

  useEffect(() => {
    const generation = ++generationRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    let active = true;

    setLoading(true);
    setLoadingMore(false);
    setSummary({});
    setItems([]);
    setNextCursor(null);
    setHasMore(false);
    setError('');

    if (!postId.trim()) {
      setError('The post ID is missing.');
      setLoading(false);
      return () => {
        active = false;
        controller.abort();
      };
    }

    void (async () => {
      try {
        const [nextSummary, page] = await Promise.all([
          fetchPostInteractionSummary(postId, controller.signal),
          fetchContentLikesPage(postId, { signal: controller.signal }),
        ]);
        const rows = await hydrateLikes(page.items, controller.signal);
        if (!active || controller.signal.aborted || generation !== generationRef.current) return;
        setSummary(nextSummary);
        setItems(rows);
        setNextCursor(page.nextCursor);
        setHasMore(page.hasMore);
      } catch (cause) {
        if (!active || controller.signal.aborted || generation !== generationRef.current) return;
        setError(cause instanceof Error ? cause.message : 'Could not load post interactions. Please retry.');
      } finally {
        if (active && !controller.signal.aborted && generation === generationRef.current) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
      controller.abort();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [postId, retryKey, hydrateLikes]);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || !hasMore || !nextCursor) return;
    const generation = generationRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoadingMore(true);
    setError('');

    try {
      const page = await fetchContentLikesPage(postId, {
        cursor: nextCursor,
        signal: controller.signal,
      });
      const rows = await hydrateLikes(page.items, controller.signal);
      if (controller.signal.aborted || generation !== generationRef.current) return;
      setItems((current) => {
        const known = new Set(current.map((item) => item.userId + ':' + item.likedAt));
        return [...current, ...rows.filter((item) => !known.has(item.userId + ':' + item.likedAt))];
      });
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (cause) {
      if (controller.signal.aborted || generation !== generationRef.current) return;
      setError(cause instanceof Error ? cause.message : 'Could not load more likes. Please retry.');
    } finally {
      if (!controller.signal.aborted && generation === generationRef.current) setLoadingMore(false);
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [hasMore, hydrateLikes, loading, loadingMore, nextCursor, postId]);

  const availableStats = interactionLabels.filter(({ key }) => typeof summary[key] === 'number');

  return (
    <View className="flex-1 bg-white dark:bg-black" style={{ paddingTop: insets.top }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View className="flex-row items-center border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <TouchableOpacity
          accessibilityLabel="Go back"
          accessibilityRole="button"
          className="mr-4 h-10 w-10 items-center justify-center rounded-full"
          onPress={() => router.back()}
        >
          <Feather name="arrow-left" size={22} color="#536471" />
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-lg font-bold text-black dark:text-white">Post interactions</Text>
          <Text className="text-xs text-neutral-500 dark:text-neutral-400">Live counts and people who liked this post</Text>
        </View>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.userId + ':' + item.likedAt}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) }}
        ListHeaderComponent={
          <View className="px-4 pt-4">
            {availableStats.length > 0 ? (
              <View className="flex-row flex-wrap gap-2">
                {availableStats.map(({ key, label }) => (
                  <View key={key} className="min-w-[43%] flex-1 rounded-xl border border-neutral-200 px-4 py-3 dark:border-neutral-800">
                    <Text className="text-xs text-neutral-500 dark:text-neutral-400">{label}</Text>
                    <Text className="mt-1 text-xl font-bold text-black dark:text-white">
                      {summary[key]?.toLocaleString?.() ?? ''}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
            <Text className="mb-2 mt-5 text-base font-bold text-black dark:text-white">Liked by</Text>
          </View>
        }
        renderItem={({ item }) => {
          const profileIdentifier = item.username || item.profileId;
          const timestamp = likedAtLabel(item.likedAt);
          return (
            <TouchableOpacity
              accessibilityRole="button"
              className="flex-row items-center px-4 py-3"
              onPress={() => router.push(('/profile/' + encodeURIComponent(profileIdentifier)) as never)}
            >
              <ProfileImage source={{ uri: item.avatar || '' }} displaySize="m" />
              <View className="ml-3 flex-1">
                <Text className="text-base font-bold text-black dark:text-white">{item.displayName}</Text>
                <Text className="text-sm text-neutral-500 dark:text-neutral-400">
                  @{item.username || item.userId}
                </Text>
                {timestamp ? (
                  <Text className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{timestamp}</Text>
                ) : null}
              </View>
              <Feather name="chevron-right" size={18} color="#536471" />
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View className="items-center px-6 py-8">
            {loading ? (
              <ActivityIndicator color="#1D9BF0" />
            ) : error ? (
              <Text className="text-center text-sm text-red-500">{error}</Text>
            ) : (
              <Text className="text-center text-sm text-neutral-500 dark:text-neutral-400">No likes yet.</Text>
            )}
            {error && !loading ? (
              <TouchableOpacity
                accessibilityRole="button"
                className="mt-4 rounded-full border border-neutral-300 px-4 py-2 dark:border-neutral-700"
                onPress={() => setRetryKey((value) => value + 1)}
              >
                <Text className="font-bold text-black dark:text-white">Retry</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        }
        ListFooterComponent={
          hasMore && nextCursor ? (
            <View className="items-center px-4 py-4">
              <TouchableOpacity
                accessibilityRole="button"
                className="rounded-full border border-neutral-300 px-5 py-2.5 dark:border-neutral-700"
                disabled={loadingMore}
                onPress={() => void loadMore()}
              >
                {loadingMore ? (
                  <ActivityIndicator color="#1D9BF0" />
                ) : (
                  <Text className="font-bold text-black dark:text-white">Load more likes</Text>
                )}
              </TouchableOpacity>
              {error ? <Text className="mt-3 text-sm text-red-500">{error}</Text> : null}
            </View>
          ) : error && items.length > 0 ? (
            <View className="items-center px-4 py-4">
              <Text className="mb-3 text-sm text-red-500">{error}</Text>
              <TouchableOpacity
                accessibilityRole="button"
                className="rounded-full border border-neutral-300 px-5 py-2.5 dark:border-neutral-700"
                onPress={() => void loadMore()}
              >
                <Text className="font-bold text-black dark:text-white">Retry loading more</Text>
              </TouchableOpacity>
            </View>
          ) : null
        }
      />
    </View>
  );
}
