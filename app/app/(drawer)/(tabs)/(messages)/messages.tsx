import React from 'react';
import { ActivityIndicator, FlatList, Pressable, StatusBar, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore } from '~/store/auth-store';
import { useColorScheme } from 'nativewind';
import { useQuery } from '@tanstack/react-query';
import { fetchConversations } from '~/lib/messaging-api';

export default function Messages() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const router = useRouter();
  const authStatus = useAuthStore((state) => state.status);
  const conversations = useQuery({
    queryKey: ['messaging', 'conversations'],
    queryFn: ({ signal }) => fetchConversations(signal),
    enabled: authStatus === 'authenticated',
  });

  return (
    <View className="flex-1 bg-white dark:bg-black">
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <View className="flex-row items-center justify-between border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <Text className="text-xl font-bold text-neutral-900 dark:text-white">私信</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="刷新私信" onPress={() => conversations.refetch()} className="p-2">
          <Feather name="refresh-cw" size={20} color="#1d9bf0" />
        </Pressable>
      </View>
      {authStatus !== 'authenticated' ? (
        <View className="flex-1 items-center justify-center px-8">
          <Feather name="lock" size={30} color="#1d9bf0" />
          <Text className="mt-4 text-lg font-bold text-neutral-900 dark:text-white">登录后查看私信</Text>
          <Pressable onPress={() => router.push('/login' as never)} className="mt-5 rounded-full bg-sky-500 px-6 py-3">
            <Text className="font-bold text-white">登录</Text>
          </Pressable>
        </View>
      ) : conversations.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#1d9bf0" />
          <Text className="mt-3 text-sm text-neutral-500">正在加载会话…</Text>
        </View>
      ) : conversations.isError ? (
        <View className="flex-1 items-center justify-center px-8">
          <Feather name="wifi-off" size={30} color="#9ca3af" />
          <Text className="mt-4 text-base font-semibold text-neutral-900 dark:text-white">暂时无法加载私信</Text>
          <Text className="mt-2 text-center text-sm text-neutral-500">请检查网络后重试。</Text>
          <Pressable onPress={() => conversations.refetch()} className="mt-4 rounded-full bg-sky-500 px-5 py-2.5">
            <Text className="font-bold text-white">重试</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={conversations.data?.items ?? []}
          keyExtractor={(item) => item.conversation_id}
          refreshing={conversations.isRefetching}
          onRefresh={() => conversations.refetch()}
          contentContainerStyle={{ flexGrow: 1 }}
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center px-8 py-20">
              <View className="h-16 w-16 items-center justify-center rounded-full bg-sky-50 dark:bg-sky-950/40">
                <Feather name="message-circle" size={30} color="#1d9bf0" />
              </View>
              <Text className="mt-5 text-lg font-bold text-neutral-900 dark:text-white">还没有私信</Text>
              <Text className="mt-2 text-center text-sm leading-6 text-neutral-500">从用户主页发起对话后，聊天记录会显示在这里。</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(('/messages/' + item.conversation_id) as never)}
              className="flex-row items-center border-b border-neutral-100 px-4 py-4 dark:border-neutral-800"
            >
              <View className="h-12 w-12 items-center justify-center rounded-full bg-sky-50 dark:bg-sky-950/40">
                <Feather name="user" size={22} color="#1d9bf0" />
              </View>
              <View className="ml-3 flex-1">
                <Text className="font-semibold text-neutral-900 dark:text-white" numberOfLines={1}>{item.participant_user_id}</Text>
                <Text className="mt-1 text-sm text-neutral-500" numberOfLines={1}>{item.last_message_body || '开始聊天'}</Text>
              </View>
              <Feather name="chevron-right" size={18} color="#9ca3af" />
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
