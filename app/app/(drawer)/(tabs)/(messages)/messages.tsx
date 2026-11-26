import React from 'react';
import { ActivityIndicator, FlatList, Pressable, StatusBar, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore } from '~/store/auth-store';
import { useColorScheme } from 'nativewind';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchConversations, fetchMessageRequests, respondToMessageRequest, type MessageRequest, type MessagingConversation } from '~/lib/messaging-api';
import { resolvePublicProfileById } from '~/lib/content-adapter';


function ConversationRow({ item }: { item: MessagingConversation }) {
  const router = useRouter();
  const isGroup = item.conversation_type === 'group';
  const profile = useQuery({
    queryKey: ['public-profile', item.participant_user_id],
    queryFn: ({ signal }) => resolvePublicProfileById(item.participant_user_id!, signal),
    enabled: !isGroup && Boolean(item.participant_user_id),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const displayName = isGroup
    ? (item.group_name || '群聊') + ' · ' + item.member_count + '人'
    : profile.data?.displayName?.trim() ||
      (profile.data?.username ? '@' + profile.data.username : 'LuckRead 用户');

  return (
    <Pressable onPress={() => router.push({ pathname: '/messages/[conversationId]', params: {
      conversationId: item.conversation_id, participantName: displayName,
      conversationType: item.conversation_type, groupName: item.group_name || '',
    } } as never)} className="flex-row items-center border-b border-neutral-100 px-4 py-4 dark:border-neutral-800">
      <View className="h-12 w-12 items-center justify-center rounded-full bg-sky-50 dark:bg-sky-950/40">
        <Feather name={isGroup ? 'users' : 'user'} size={22} color="#1d9bf0" />
      </View>
      <View className="ml-3 flex-1">
        <Text className="font-semibold text-neutral-900 dark:text-white" numberOfLines={1}>{displayName}</Text>
        <Text className="mt-1 text-sm text-neutral-500" numberOfLines={1}>{item.last_message_body || (isGroup ? '群聊已创建，开始聊天' : '开始聊天')}</Text>
      </View>
      {item.unread_count > 0 ? (
        <View className="mr-2 min-w-5 items-center justify-center rounded-full bg-sky-500 px-1.5 py-0.5">
          <Text className="text-xs font-bold text-white">{item.unread_count > 99 ? '99+' : item.unread_count}</Text>
        </View>
      ) : null}
      <Feather name="chevron-right" size={18} color="#9ca3af" />
    </Pressable>
  );
}


function MessageRequestRow({ item, direction, busy, onAction }: {
  item: MessageRequest; direction: 'incoming' | 'outgoing'; busy: boolean;
  onAction: (requestId: string, action: 'accept' | 'decline' | 'cancel') => void;
}) {
  const peerId = direction === 'incoming' ? item.sender_user_id : item.recipient_user_id;
  const profile = useQuery({
    queryKey: ['public-profile', peerId],
    queryFn: ({ signal }) => resolvePublicProfileById(peerId, signal),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const displayName = profile.data?.displayName?.trim() ||
    (profile.data?.username ? '@' + profile.data.username : 'LuckRead 用户');
  return (
    <View className="border-b border-neutral-100 px-4 py-4 dark:border-neutral-800">
      <View className="flex-row items-center">
        <View className="h-10 w-10 items-center justify-center rounded-full bg-sky-50 dark:bg-sky-950/40">
          <Feather name="user" size={20} color="#1d9bf0" />
        </View>
        <View className="ml-3 flex-1">
          <Text className="font-semibold text-neutral-900 dark:text-white" numberOfLines={1}>{displayName}</Text>
          <Text className="mt-1 text-sm text-neutral-500">{direction === 'incoming' ? '向你发送了私信请求' : '等待对方接受'}</Text>
        </View>
      </View>
      <Text className="mt-3 rounded-2xl bg-neutral-100 px-3 py-3 text-sm leading-5 text-neutral-800 dark:bg-neutral-900 dark:text-neutral-200">{item.initial_message}</Text>
      <View className="mt-3 flex-row justify-end gap-2">
        {direction === 'incoming' ? (
          <>
            <Pressable disabled={busy} onPress={() => onAction(item.request_id, 'decline')} className="rounded-full border border-neutral-300 px-4 py-2 dark:border-neutral-700">
              <Text className="text-sm font-semibold text-neutral-700 dark:text-neutral-200">拒绝</Text>
            </Pressable>
            <Pressable disabled={busy} onPress={() => onAction(item.request_id, 'accept')} className="rounded-full bg-sky-500 px-4 py-2">
              <Text className="text-sm font-semibold text-white">接受</Text>
            </Pressable>
          </>
        ) : (
          <Pressable disabled={busy} onPress={() => onAction(item.request_id, 'cancel')} className="rounded-full border border-neutral-300 px-4 py-2 dark:border-neutral-700">
            <Text className="text-sm font-semibold text-neutral-700 dark:text-neutral-200">撤回请求</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

export default function Messages() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const router = useRouter();
  const authStatus = useAuthStore((state) => state.status);
  const userId = useAuthStore((state) => state.user?.id);
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = React.useState<'chats' | 'incoming' | 'outgoing'>('chats');
  const conversations = useInfiniteQuery({
    queryKey: ['messaging', userId, 'conversations'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => fetchConversations(pageParam, signal, userId),
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextCursor ?? undefined : undefined,
    enabled: authStatus === 'authenticated',
    staleTime: 30_000,
  });
  const conversationItems = conversations.data?.pages.flatMap((page) => page.items) ?? [];
  const direction = activeTab === 'outgoing' ? 'outgoing' : 'incoming';
  const requests = useInfiniteQuery({
    queryKey: ['messaging', userId, 'requests', direction],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => fetchMessageRequests(direction, pageParam, signal, userId),
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextCursor ?? undefined : undefined,
    enabled: authStatus === 'authenticated' && activeTab !== 'chats',
    staleTime: 15_000,
  });
  const requestItems = requests.data?.pages.flatMap((page) => page.items) ?? [];
  const requestAction = useMutation({
    mutationFn: ({ requestId, action }: { requestId: string; action: 'accept' | 'decline' | 'cancel' }) => respondToMessageRequest(requestId, action, userId),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['messaging', userId, 'requests'] }),
        queryClient.invalidateQueries({ queryKey: ['messaging', userId, 'conversations'] }),
      ]);
      if (result.conversationId) router.push({ pathname: '/messages/[conversationId]', params: { conversationId: result.conversationId } } as never);
    },
  });
  const loadMore = () => {
    if (conversations.hasNextPage && !conversations.isFetchingNextPage && !conversations.isFetching) {
      void conversations.fetchNextPage();
    }
  };

  return (
    <View className="flex-1 bg-white dark:bg-black">
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <View className="flex-row items-center justify-between border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <Text className="text-xl font-bold text-neutral-900 dark:text-white">私信</Text>
        <View className="flex-row items-center">
          <Pressable accessibilityRole="button" accessibilityLabel="创建群聊" onPress={() => router.push('/messages/group-new' as never)} className="p-2">
            <Feather name="users" size={20} color="#1d9bf0" />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="刷新私信" onPress={() => conversations.refetch()} className="p-2">
            <Feather name="refresh-cw" size={20} color="#1d9bf0" />
          </Pressable>
        </View>
      </View>
      {authStatus === 'authenticated' ? (
        <View className="flex-row border-b border-neutral-100 px-3 py-2 dark:border-neutral-800">
          {([
            ['chats', '会话'],
            ['incoming', '收到的请求'],
            ['outgoing', '发出的请求'],
          ] as const).map(([key, label]) => (
            <Pressable key={key} onPress={() => setActiveTab(key)} className={`mr-2 rounded-full px-3 py-2 ${activeTab === key ? 'bg-sky-500' : 'bg-neutral-100 dark:bg-neutral-900'}`}>
              <Text className={`text-sm font-semibold ${activeTab === key ? 'text-white' : 'text-neutral-600 dark:text-neutral-300'}`}>{label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {authStatus !== 'authenticated' ? (
        <View className="flex-1 items-center justify-center px-8">
          <Feather name="lock" size={30} color="#1d9bf0" />
          <Text className="mt-4 text-lg font-bold text-neutral-900 dark:text-white">登录后查看私信</Text>
          <Pressable onPress={() => router.push('/login' as never)} className="mt-5 rounded-full bg-sky-500 px-6 py-3">
            <Text className="font-bold text-white">登录</Text>
          </Pressable>
        </View>
      ) : activeTab !== 'chats' ? (
        requests.isLoading ? (
          <View className="flex-1 items-center justify-center"><ActivityIndicator color="#1d9bf0" /></View>
        ) : requests.isError ? (
          <View className="flex-1 items-center justify-center px-8">
            <Text className="text-sm text-neutral-500">暂时无法加载私信请求</Text>
            <Pressable onPress={() => requests.refetch()} className="mt-3 rounded-full bg-sky-500 px-5 py-2.5"><Text className="font-bold text-white">重试</Text></Pressable>
          </View>
        ) : (
          <FlatList
            data={requestItems}
            keyExtractor={(item) => item.request_id}
            refreshing={requests.isRefetching}
            onRefresh={() => requests.refetch()}
            onEndReached={() => { if (requests.hasNextPage && !requests.isFetchingNextPage) void requests.fetchNextPage(); }}
            onEndReachedThreshold={0.4}
            ListHeaderComponent={requestAction.isError ? (
              <View className="mx-4 mt-3 rounded-xl bg-red-50 px-3 py-2 dark:bg-red-950/30">
                <Text className="text-sm text-red-600 dark:text-red-300">{requestAction.error instanceof Error ? requestAction.error.message : '操作失败，请稍后重试。'}</Text>
              </View>
            ) : undefined}
            ListEmptyComponent={<View className="flex-1 items-center justify-center px-8 py-20"><Feather name="mail" size={30} color="#9ca3af" /><Text className="mt-4 text-base font-semibold text-neutral-900 dark:text-white">暂无私信请求</Text><Text className="mt-2 text-center text-sm text-neutral-500">陌生人的私信会先出现在这里，由你决定是否接受。</Text></View>}
            renderItem={({ item }) => <MessageRequestRow item={item} direction={direction} busy={requestAction.isPending} onAction={(requestId, action) => requestAction.mutate({ requestId, action })} />}
            ListFooterComponent={requests.isFetchingNextPage ? <View className="py-4"><ActivityIndicator color="#1d9bf0" /></View> : undefined}
          />
        )
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
          data={conversationItems}
          keyExtractor={(item) => item.conversation_id}
          refreshing={conversations.isRefetching}
          onRefresh={() => conversations.refetch()}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          contentContainerStyle={{ flexGrow: 1 }}
          ListFooterComponent={conversations.isFetchingNextPage ? <View className="py-4"><ActivityIndicator color="#1d9bf0" /></View> : undefined}
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
            <ConversationRow item={item} />
          )}
        />
      )}
    </View>
  );
}
