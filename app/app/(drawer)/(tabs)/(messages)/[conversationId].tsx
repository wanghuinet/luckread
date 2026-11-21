import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StatusBar, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchMessages, markConversationRead, sendDirectMessage, type MessagingMessage } from '~/lib/messaging-api';
import { createIdempotencyKey } from '~/lib/api-client';
import { useAuthStore } from '~/store/auth-store';

export default function ConversationScreen() {
  const params = useLocalSearchParams<{ conversationId: string; participantName?: string }>();
  const conversationId = Array.isArray(params.conversationId) ? params.conversationId[0] : params.conversationId;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const userId = useAuthStore((state) => state.user?.id);
  const [draft, setDraft] = useState('');
  const pendingSend = useRef<{ body: string; key: string } | null>(null);
  const messagesQuery = useInfiniteQuery({
    queryKey: ['messaging', 'messages', conversationId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => fetchMessages(conversationId, pageParam, signal),
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextCursor ?? undefined : undefined,
    enabled: Boolean(conversationId),
    staleTime: 15_000,
  });
  // The API returns newest-first pages; an inverted list keeps the newest message at the bottom.
  const messages = useMemo(() => messagesQuery.data?.pages.flatMap((page) => page.items) ?? [], [messagesQuery.data?.pages]);
  const loadOlder = () => {
    if (messagesQuery.hasNextPage && !messagesQuery.isFetchingNextPage && !messagesQuery.isFetching) {
      void messagesQuery.fetchNextPage();
    }
  };
  const sendMutation = useMutation({
    mutationFn: (body: string) => {
      if (!pendingSend.current || pendingSend.current.body !== body) {
        pendingSend.current = { body, key: createIdempotencyKey() };
      }
      return sendDirectMessage(conversationId, body, pendingSend.current.key);
    },
    onSuccess: async (_message, sentBody) => {
      if (pendingSend.current?.body === sentBody) pendingSend.current = null;
      setDraft((current) => current.trim() === sentBody ? '' : current);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['messaging', 'messages', conversationId] }),
        queryClient.invalidateQueries({ queryKey: ['messaging', 'conversations'] }),
      ]);
    },
  });
  useEffect(() => {
    const latest = messagesQuery.data?.pages?.[0]?.items?.[0];
    if (latest?.sequence) void markConversationRead(conversationId, latest.sequence).catch(() => undefined);
  }, [conversationId, messagesQuery.data?.pages?.[0]?.items?.[0]?.sequence]);

  const send = () => {
    const value = draft.trim();
    if (!value || sendMutation.isPending) return;
    sendMutation.mutate(value);
  };

  return (
    <KeyboardAvoidingView className="flex-1 bg-white dark:bg-black" behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <View className="flex-row items-center border-b border-neutral-100 px-3 py-3 dark:border-neutral-800">
        <Pressable accessibilityRole="button" accessibilityLabel="返回私信列表" onPress={() => router.back()} className="p-2">
          <Feather name="chevron-left" size={24} color={isDark ? '#fff' : '#111827'} />
        </Pressable>
        <Text className="ml-2 flex-1 text-lg font-bold text-neutral-900 dark:text-white" numberOfLines={1}>{params.participantName || '对话'}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="刷新消息" onPress={() => messagesQuery.refetch()} className="p-2">
          <Feather name="refresh-cw" size={18} color="#1d9bf0" />
        </Pressable>
      </View>
      {messagesQuery.isLoading ? (
        <View className="flex-1 items-center justify-center"><ActivityIndicator color="#1d9bf0" /></View>
      ) : messagesQuery.isError ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-base font-semibold text-neutral-900 dark:text-white">无法加载消息</Text>
          <Pressable onPress={() => messagesQuery.refetch()} className="mt-4 rounded-full bg-sky-500 px-5 py-2.5"><Text className="font-bold text-white">重试</Text></Pressable>
        </View>
      ) : (
        <FlatList
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 16, flexGrow: 1 }}
          data={messages}
          inverted
          onEndReached={loadOlder}
          onEndReachedThreshold={0.3}
          ListFooterComponent={messagesQuery.isFetchingNextPage ? <View className="py-4"><ActivityIndicator color="#1d9bf0" /></View> : undefined}
          keyExtractor={(item) => item.message_id}
          renderItem={({ item }: { item: MessagingMessage }) => {
            const own = Boolean(userId && item.sender_user_id === userId);
            return (
              <View className={'mb-3 max-w-[84%] rounded-2xl px-4 py-3 ' + (own ? 'self-end bg-sky-500' : 'self-start bg-neutral-100 dark:bg-neutral-800')}>
                <Text className={own ? 'text-white' : 'text-neutral-900 dark:text-white'}>{item.body}</Text>
              </View>
            );
          }}
          ListEmptyComponent={<View className="flex-1 items-center justify-center"><Text className="text-sm text-neutral-500">发送第一条消息，开始对话</Text></View>}
        />
      )}
      {sendMutation.isError ? <Text className="px-4 pb-2 text-sm text-red-500">发送失败，请检查网络后重试。</Text> : null}
      <View className="flex-row items-end border-t border-neutral-100 px-3 py-3 dark:border-neutral-800">
        <TextInput
          value={draft}
          onChangeText={setDraft}
          editable={!sendMutation.isPending}
          placeholder="发送消息…"
          placeholderTextColor="#9ca3af"
          multiline
          maxLength={10000}
          className="max-h-28 min-h-11 flex-1 rounded-2xl bg-neutral-100 px-4 py-3 text-base text-neutral-900 dark:bg-neutral-900 dark:text-white"
        />
        <Pressable accessibilityRole="button" accessibilityLabel="发送消息" disabled={!draft.trim() || sendMutation.isPending} onPress={send} className="ml-2 h-11 w-11 items-center justify-center rounded-full bg-sky-500 disabled:opacity-40">
          {sendMutation.isPending ? <ActivityIndicator color="#fff" size="small" /> : <Feather name="send" size={18} color="#fff" />}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
