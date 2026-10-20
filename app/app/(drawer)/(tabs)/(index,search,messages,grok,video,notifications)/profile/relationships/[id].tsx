import React, { useCallback, useEffect, useState } from 'react';
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
import { useLocalSearchParams, useRouter } from 'expo-router';

import { getApiErrorMessage } from '~/lib/api-client';
import { fetchUserRelationshipsPage } from '~/lib/social-screen-api';
import { resolvePublicProfileById, unwrapApiData } from '~/lib/content-adapter';

type FollowRelation = {
  relationshipId: string;
  userId: string;
  followedAt: string;
};

type FollowPage = {
  items: FollowRelation[];
  totalCount: number;
  nextCursor: string | null;
  hasMore: boolean;
};

type PublicUser = {
  id: string;
  username?: string;
  displayName?: string | null;
  bio?: string | null;
  avatar?: string | null;
};

type FollowListRow = {
  relation: FollowRelation;
  profile: PublicUser | null;
};

const PRIMARY = '#1d9bf0';

export default function ProfileRelationships() {
  const params = useLocalSearchParams<{ id?: string | string[]; type?: string | string[] }>();
  const ownerId = Array.isArray(params.id) ? params.id[0] : params.id || '';
  const rawType = Array.isArray(params.type) ? params.type[0] : params.type;
  const relationType = rawType === 'following' ? 'following' : 'followers';
  const title = relationType === 'following' ? '关注列表' : '关注者';
  const router = useRouter();
  const [rows, setRows] = useState<FollowListRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadPage = useCallback(async (nextCursor: string | null, append: boolean) => {
    if (!ownerId) {
      setError('缺少用户 ID。');
      setLoading(false);
      return;
    }
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError('');
    try {
      const result = await fetchUserRelationshipsPage(ownerId, relationType, {
        cursor: nextCursor,
      });
      if (!result.response.ok) {
        throw new Error(getApiErrorMessage(result.data, '无法读取关注列表。', result.response.status));
      }
      const page = unwrapApiData<FollowPage>(result.data);
      if (!page || !Array.isArray(page.items)) throw new Error('关注列表返回的数据格式无效。');

      const profileRows = await Promise.all(page.items.map(async (relation): Promise<FollowListRow> => {
        const profile = await resolvePublicProfileById(relation.userId);
        return { relation, profile: profile as PublicUser | null };
      }));

      setRows((current) => {
        if (!append) return profileRows;
        const known = new Set(current.map((item) => item.relation.relationshipId));
        return [...current, ...profileRows.filter((item) => !known.has(item.relation.relationshipId))];
      });
      setTotalCount(Math.max(0, Number(page.totalCount) || 0));
      setCursor(page.nextCursor || null);
      setHasMore(page.hasMore === true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取关注列表。');
    } finally {
      setLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
    }
  }, [ownerId, relationType]);

  useEffect(() => {
    void loadPage(null, false);
  }, [loadPage]);

  const renderItem = useCallback(({ item }: { item: FollowListRow }) => {
    const profile = item.profile;
    const name = profile?.displayName?.trim() || profile?.username || 'LuckRead 用户';
    const username = profile?.username || profile?.id || item.relation.userId;
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push(('/profile/' + encodeURIComponent(username)) as never)}
        className="flex-row items-center border-b border-neutral-100 px-4 py-3 dark:border-neutral-800"
      >
        {profile?.avatar ? (
          <Image source={{ uri: profile.avatar }} className="h-11 w-11 rounded-full" />
        ) : (
          <View className="h-11 w-11 items-center justify-center rounded-full bg-neutral-200 dark:bg-neutral-800">
            <Feather name="user" size={21} color="#6b7280" />
          </View>
        )}
        <View className="ml-3 flex-1">
          <Text className="font-bold text-neutral-900 dark:text-white">{name}</Text>
          <Text className="mt-1 text-sm text-neutral-500">@{username}</Text>
          {profile?.bio ? <Text numberOfLines={2} className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">{profile.bio}</Text> : null}
        </View>
        <Feather name="chevron-right" size={19} color="#9ca3af" />
      </Pressable>
    );
  }, [router]);

  return (
    <View className="flex-1 bg-white dark:bg-black">
      <StatusBar barStyle="dark-content" />
      <View className="flex-row items-center border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <Pressable accessibilityRole="button" onPress={() => router.back()} className="mr-4 rounded-full p-1">
          <Feather name="arrow-left" size={23} color="#6b7280" />
        </Pressable>
        <View className="flex-1">
          <Text className="text-xl font-bold text-neutral-900 dark:text-white">{title}</Text>
          <Text className="mt-0.5 text-xs text-neutral-500">{totalCount} 人</Text>
        </View>
      </View>
      {error ? (
        <View className="flex-row items-center justify-between px-4 py-3">
          <Text className="mr-3 flex-1 text-sm text-red-600">{error}</Text>
          <Pressable onPress={() => void loadPage(null, false)}><Text className="font-semibold text-sky-600">重试</Text></Pressable>
        </View>
      ) : null}
      <FlatList
        data={rows}
        keyExtractor={(item) => item.relation.relationshipId}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => {
          setRefreshing(true);
          void loadPage(null, false);
        }} tintColor={PRIMARY} />}
        ListEmptyComponent={(
          <View className="items-center px-8 py-12">
            {loading ? <ActivityIndicator color={PRIMARY} /> : (
              <>
                <Feather name="users" size={30} color="#9ca3af" />
                <Text className="mt-3 text-sm text-neutral-500">{error ? '暂时无法显示列表。' : '列表为空。'}</Text>
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
