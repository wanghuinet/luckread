import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  Linking,
  Pressable,
  ScrollView,
  StatusBar,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { getApiErrorMessage } from '~/lib/api-client';
import { fetchDiscoveryTopics, findPublicUserByUsername } from '~/lib/social-screen-api';
import { unwrapApiData } from '~/lib/content-adapter';
import { useAuthStore } from '~/store/auth-store';

type DiscoveryTopic = {
  topicId: string;
  name: string;
  displayName: string;
  contentCount: number;
  latestContentAt: string;
};

type DiscoveryPage = {
  items: DiscoveryTopic[];
  hasMore: boolean;
  nextCursor: string | null;
};

type PublicUser = {
  id: string;
  username?: string;
  displayName?: string | null;
  bio?: string | null;
  avatar?: string | null;
};

const PRIMARY = '#1d9bf0';

export default function Search() {
  const router = useRouter();
  const authStatus = useAuthStore((state) => state.status);
  const [usernameInput, setUsernameInput] = useState('');
  const [userResult, setUserResult] = useState<PublicUser | null>(null);
  const [userError, setUserError] = useState('');
  const [userBusy, setUserBusy] = useState(false);
  const [topics, setTopics] = useState<DiscoveryTopic[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(true);
  const [topicsError, setTopicsError] = useState('');

  const loadTopics = useCallback(async () => {
    setTopicsLoading(true);
    setTopicsError('');
    try {
      const result = await fetchDiscoveryTopics();
      if (!result.response.ok) {
        throw new Error(getApiErrorMessage(result.data, '专题暂时无法加载。', result.response.status));
      }
      const page = unwrapApiData<DiscoveryPage>(result.data);
      if (!page || !Array.isArray(page.items)) {
        throw new Error('专题接口返回的数据格式无效。');
      }
      setTopics(page.items);
    } catch (cause) {
      setTopicsError(cause instanceof Error ? cause.message : '专题暂时无法加载。');
    } finally {
      setTopicsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTopics();
  }, [loadTopics]);

  const findUser = useCallback(async () => {
    const username = usernameInput.trim().replace(/^@/, '');
    Keyboard.dismiss();
    setUserResult(null);
    setUserError('');
    if (!username) {
      setUserError('请输入完整用户名。');
      return;
    }

    setUserBusy(true);
    try {
      // Only the confirmed exact username lookup is used here. No generic search
      // endpoint or new backend contract is assumed by the native app.
      const result = await findPublicUserByUsername(username);
      if (!result.response.ok) {
        if (result.response.status === 404) {
          throw new Error('没有找到这个用户名对应的公开资料。');
        }
        throw new Error(getApiErrorMessage(result.data, '暂时无法查找该用户。', result.response.status));
      }
      const profile = unwrapApiData<PublicUser>(result.data);
      if (!profile?.id) throw new Error('用户资料返回的数据格式无效。');
      setUserResult(profile);
    } catch (cause) {
      setUserError(cause instanceof Error ? cause.message : '暂时无法查找该用户。');
    } finally {
      setUserBusy(false);
    }
  }, [usernameInput]);

  const openTopic = useCallback(async (topic: DiscoveryTopic) => {
    const name = topic.name?.trim();
    if (!name) return;
    const url = 'https://luckread.com/topics/' + encodeURIComponent(name);
    try {
      await Linking.openURL(url);
    } catch {
      setTopicsError('无法打开该专题，请稍后重试。');
    }
  }, []);

  const openProfile = useCallback((profile: PublicUser) => {
    const identifier = profile.username || profile.id;
    router.push(('/profile/' + encodeURIComponent(identifier)) as never);
  }, [router]);

  return (
    <View className="flex-1 bg-white dark:bg-black">
      <StatusBar barStyle="dark-content" />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 28 }}>
        <View className="border-b border-neutral-100 px-4 py-4 dark:border-neutral-800">
          <Text className="text-xl font-bold text-neutral-900 dark:text-white">发现</Text>
          <Text className="mt-1 text-sm text-neutral-500">按用户名查找用户，或浏览近期公开内容中的专题。</Text>
          <View className="mt-4 flex-row items-center rounded-full bg-neutral-100 px-4 dark:bg-neutral-900">
            <Feather name="search" size={18} color="#6b7280" />
            <TextInput
              accessibilityLabel="按用户名查找"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              returnKeyType="search"
              onSubmitEditing={() => void findUser()}
              value={usernameInput}
              onChangeText={setUsernameInput}
              placeholder="输入完整用户名，例如 wanghui"
              placeholderTextColor="#9ca3af"
              className="ml-3 min-h-12 flex-1 text-base text-neutral-900 dark:text-white"
            />
            <Pressable accessibilityRole="button" disabled={userBusy} onPress={() => void findUser()} className="ml-2 rounded-full bg-sky-500 px-4 py-2">
              {userBusy ? <ActivityIndicator size="small" color="#fff" /> : <Text className="font-bold text-white">查找</Text>}
            </Pressable>
          </View>
          {userError ? <Text accessibilityRole="alert" className="mt-3 text-sm text-red-600">{userError}</Text> : null}
          {userResult ? (
            <Pressable onPress={() => openProfile(userResult)} className="mt-4 flex-row items-center rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800">
              {userResult.avatar ? (
                <Image source={{ uri: userResult.avatar }} className="h-12 w-12 rounded-full" />
              ) : (
                <View className="h-12 w-12 items-center justify-center rounded-full bg-neutral-200 dark:bg-neutral-700">
                  <Feather name="user" size={21} color="#6b7280" />
                </View>
              )}
              <View className="ml-3 flex-1">
                <Text className="font-bold text-neutral-900 dark:text-white">{userResult.displayName?.trim() || userResult.username || 'LuckRead 用户'}</Text>
                <Text className="mt-1 text-sm text-neutral-500">@{userResult.username || userResult.id}</Text>
                {userResult.bio ? <Text numberOfLines={2} className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">{userResult.bio}</Text> : null}
              </View>
              <Feather name="chevron-right" size={20} color="#9ca3af" />
            </Pressable>
          ) : null}
        </View>

        <View className="px-4 pt-5">
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-lg font-bold text-neutral-900 dark:text-white">专题发现</Text>
            <Pressable accessibilityRole="button" onPress={() => void loadTopics()} disabled={topicsLoading} className="p-1">
              <Feather name="refresh-cw" size={18} color={PRIMARY} />
            </Pressable>
          </View>
          <Text className="mb-4 text-sm text-neutral-500">来自近期更新的公开内容，按现有专题发现接口展示。</Text>
          {topicsLoading ? <ActivityIndicator className="py-8" color={PRIMARY} /> : null}
          {!topicsLoading && topicsError ? (
            <View className="items-start rounded-2xl bg-neutral-50 p-4 dark:bg-neutral-900">
              <Text className="text-sm text-neutral-700 dark:text-neutral-200">{topicsError}</Text>
              <Pressable onPress={() => void loadTopics()} className="mt-3">
                <Text className="font-semibold text-sky-600">重试</Text>
              </Pressable>
            </View>
          ) : null}
          {!topicsLoading && !topicsError && topics.length === 0 ? (
            <View className="items-center py-10">
              <Feather name="hash" size={28} color="#9ca3af" />
              <Text className="mt-3 text-sm text-neutral-500">暂时没有近期公开专题。</Text>
            </View>
          ) : null}
          {topics.map((topic) => (
            <Pressable
              key={topic.topicId}
              accessibilityRole="button"
              onPress={() => void openTopic(topic)}
              className="flex-row items-center border-b border-neutral-100 py-4 dark:border-neutral-800"
            >
              <View className="h-11 w-11 items-center justify-center rounded-full bg-sky-50 dark:bg-sky-950/40">
                <Feather name="hash" size={20} color={PRIMARY} />
              </View>
              <View className="ml-3 flex-1">
                <Text className="font-bold text-neutral-900 dark:text-white">{topic.displayName || topic.name}</Text>
                <Text className="mt-1 text-sm text-neutral-500">{topic.contentCount} 条近期公开内容</Text>
              </View>
              <Feather name="chevron-right" size={20} color="#9ca3af" />
            </Pressable>
          ))}
        </View>
        {authStatus === 'anonymous' ? (
          <Pressable onPress={() => router.push('/login' as never)} className="mx-4 mt-6 rounded-full bg-sky-500 px-5 py-3">
            <Text className="text-center font-bold text-white">登录以使用更多功能</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}
