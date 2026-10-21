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
import { fetchContentSearchPage, fetchDiscoveryTopics, findPublicUserByUsername } from '~/lib/social-screen-api';
import { mapContentToFeedContent, readContentAuthor, readContentSocial, unwrapApiData, type ApiContentPage, type ApiContentRecord } from '~/lib/content-adapter';
import { FeedItem, type FeedContent } from '~/components/FeedItem';
import { readSessionToken } from '~/lib/secure-session';
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
const SEARCH_PAGE_SIZE = 20;

export default function Search() {
  const router = useRouter();
  const authStatus = useAuthStore((state) => state.status);
  const [contentInput, setContentInput] = useState('');
  const [contentResults, setContentResults] = useState<FeedContent[]>([]);
  const [contentCursor, setContentCursor] = useState<string | null>(null);
  const [contentHasMore, setContentHasMore] = useState(false);
  const [contentSearchSubmitted, setContentSearchSubmitted] = useState(false);
  const [contentBusy, setContentBusy] = useState(false);
  const [contentLoadingMore, setContentLoadingMore] = useState(false);
  const [contentError, setContentError] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [userResult, setUserResult] = useState<PublicUser | null>(null);
  const [userError, setUserError] = useState('');
  const [userBusy, setUserBusy] = useState(false);
  const [topics, setTopics] = useState<DiscoveryTopic[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(true);
  const [topicsError, setTopicsError] = useState('');

  const runContentSearch = useCallback(async (append = false, queryValue?: string) => {
    const query = (queryValue ?? contentInput).trim();
    Keyboard.dismiss();
    setContentSearchSubmitted(true);
    if (!query) {
      setContentResults([]);
      setContentCursor(null);
      setContentHasMore(false);
      setContentError('请输入要搜索的内容。');
      return;
    }

    if (append) setContentLoadingMore(true);
    else {
      setContentBusy(true);
      setContentResults([]);
      setContentCursor(null);
    }
    setContentError('');

    try {
      const result = await fetchContentSearchPage(query, {
        cursor: append ? contentCursor : null,
        limit: SEARCH_PAGE_SIZE,
      });
      if (!result.response.ok) {
        throw new Error(getApiErrorMessage(result.data, '搜索暂时不可用，请稍后重试。', result.response.status));
      }
      const page = unwrapApiData<ApiContentPage>(result.data);
      if (!page || !Array.isArray(page.items)) {
        throw new Error('搜索接口返回的数据格式无效。');
      }
      const sessionToken = await readSessionToken().catch(() => null);
      const mapped = await Promise.all(
        page.items
          .filter((item): item is ApiContentRecord => Boolean(item && typeof item.id === 'string'))
          .map(async (item) => {
            // Search returns canonical metadata only. Do not dereference bodyRef or
            // fetch media until search-serving visibility/entitlement checks exist.
            const [social, author] = await Promise.all([
              readContentSocial(item.id),
              readContentAuthor(item),
            ]);
            return mapContentToFeedContent(item, undefined, social, author, sessionToken);
          }),
      );
      setContentResults((current) => {
        if (!append) return mapped;
        const known = new Set(current.map((item) => item.contentId));
        return [...current, ...mapped.filter((item) => !known.has(item.contentId))];
      });
      setContentCursor(page.nextCursor || null);
      setContentHasMore(page.hasMore === true);
    } catch (cause) {
      setContentError(cause instanceof Error ? cause.message : '搜索暂时不可用，请稍后重试。');
    } finally {
      setContentBusy(false);
      setContentLoadingMore(false);
    }
  }, [contentCursor, contentInput]);

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
      // Keep username lookup separate from public-content search results.
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
          <Text className="text-xl font-bold text-neutral-900 dark:text-white">搜索</Text>
          <Text className="mt-1 text-sm text-neutral-500">按标题或链接标识搜索已发布的公开内容，也可以按用户名查找用户或浏览专题。</Text>

          <Text className="mt-5 text-sm font-semibold text-neutral-800 dark:text-neutral-200">搜索公开内容</Text>
          <View className="mt-2 flex-row items-center rounded-full bg-neutral-100 px-4 dark:bg-neutral-900">
            <Feather name="search" size={18} color="#6b7280" />
            <TextInput
              accessibilityLabel="搜索公开内容"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={() => void runContentSearch(false)}
              value={contentInput}
              onChangeText={setContentInput}
              placeholder="搜索动态或文章标题"
              placeholderTextColor="#9ca3af"
              className="ml-3 min-h-12 flex-1 text-base text-neutral-900 dark:text-white"
            />
            <Pressable accessibilityRole="button" disabled={contentBusy} onPress={() => void runContentSearch(false)} className="ml-2 rounded-full bg-sky-500 px-4 py-2">
              {contentBusy ? <ActivityIndicator size="small" color="#fff" /> : <Text className="font-bold text-white">搜索</Text>}
            </Pressable>
          </View>
          {!topicsLoading && !topicsError && topics.length > 0 ? (
            <View className="mt-4">
              <Text className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">推荐搜索词</Text>
              <Text className="mt-1 text-xs text-neutral-500">根据近期公开专题生成，不代表全站搜索量排名。</Text>
              <View className="mt-3 flex-row flex-wrap">
                {topics.slice(0, 8).map((topic) => {
                  const term = (topic.displayName || topic.name).trim();
                  if (!term) return null;
                  return (
                    <Pressable
                      key={'recommended-search-' + topic.topicId}
                      accessibilityRole="button"
                      accessibilityLabel={'搜索 ' + term}
                      onPress={() => {
                        setContentInput(term);
                        void runContentSearch(false, term);
                      }}
                      className="mb-2 mr-2 rounded-full bg-neutral-100 px-3 py-2 dark:bg-neutral-900"
                    >
                      <Text className="text-sm text-neutral-800 dark:text-neutral-200">{term}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}
          {contentError ? <Text accessibilityRole="alert" className="mt-3 text-sm text-red-600">{contentError}</Text> : null}
          {contentBusy ? <ActivityIndicator className="py-5" color={PRIMARY} /> : null}
          {contentSearchSubmitted && !contentBusy && !contentError && contentResults.length === 0 ? (
            <Text className="py-5 text-sm text-neutral-500">没有找到匹配的公开内容。</Text>
          ) : null}
          {contentResults.map((item) => (
            <FeedItem
              key={item.contentId}
              itemData={item}
              onPress={() => {
                if (item.contentId) router.push(('/post/' + encodeURIComponent(item.contentId)) as never);
              }}
            />
          ))}
          {contentHasMore && !contentBusy && contentResults.length > 0 ? (
            <Pressable accessibilityRole="button" disabled={contentLoadingMore} onPress={() => void runContentSearch(true)} className="items-center py-4">
              {contentLoadingMore ? <ActivityIndicator color={PRIMARY} /> : <Text className="font-semibold text-sky-600">加载更多搜索结果</Text>}
            </Pressable>
          ) : null}

          <View className="mt-5 border-t border-neutral-100 pt-5 dark:border-neutral-800">
            <Text className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">按用户名查找</Text>
          </View>
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
