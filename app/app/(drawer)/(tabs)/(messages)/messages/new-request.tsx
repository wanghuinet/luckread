import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StatusBar, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createMessageRequest } from '~/lib/messaging-api';
import { useColorScheme } from 'nativewind';
import { useAuthStore } from '~/store/auth-store';

export default function NewMessageRequestScreen() {
  const params = useLocalSearchParams<{ recipientUserId: string; participantName?: string }>();
  const recipientUserId = Array.isArray(params.recipientUserId) ? params.recipientUserId[0] : params.recipientUserId;
  const participantName = Array.isArray(params.participantName) ? params.participantName[0] : params.participantName;
  const [body, setBody] = useState('');
  const router = useRouter();
  const queryClient = useQueryClient();
  const userId = useAuthStore(state => state.user?.id);
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const mutation = useMutation({
    mutationFn: () => createMessageRequest(recipientUserId ?? '', body, undefined, userId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['messaging', userId, 'requests', 'outgoing'] });
      router.back();
    },
  });
  const canSend = Boolean(recipientUserId && body.trim() && !mutation.isPending);
  const errorCode = mutation.error instanceof Error ? mutation.error.message : '';
  const errorMessage = errorCode === 'RATE_LIMITED'
    ? '今天发起的私信请求已达到上限，请明天再试。'
    : errorCode === 'REQUEST_ALREADY_PENDING'
      ? '你们之间已有一条待处理请求，请在“发出的请求”中查看。'
      : errorCode === 'PERMISSION_DENIED'
        ? '你无法向该用户发送请求。'
        : errorCode === 'CONTACT_POLICY_ALREADY_OPEN'
          ? '你们已互相关注，可以直接开始聊天。'
          : errorCode || '发送失败，请稍后重试。';
  return (
    <View className="flex-1 bg-white dark:bg-black">
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <View className="flex-row items-center justify-between border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={() => router.back()} className="p-2"><Feather name="arrow-left" size={22} color={isDark ? '#fff' : '#111'} /></Pressable>
        <Text className="text-lg font-bold text-neutral-900 dark:text-white">发送私信请求</Text>
        <Pressable disabled={!canSend} onPress={() => mutation.mutate()} className={`rounded-full px-4 py-2 ${canSend ? 'bg-sky-500' : 'bg-neutral-300 dark:bg-neutral-700'}`}>
          {mutation.isPending ? <ActivityIndicator color="#fff" size="small" /> : <Text className="font-semibold text-white">发送</Text>}
        </Pressable>
      </View>
      <View className="px-4 py-5">
        <Text className="text-sm text-neutral-500">发送给 {participantName || '这位用户'}</Text>
        <Text className="mt-3 text-base leading-6 text-neutral-800 dark:text-neutral-200">你们还不是互相关注关系。对方接受请求后，才能继续聊天。</Text>
        <TextInput
          value={body}
          onChangeText={setBody}
          accessibilityLabel="私信请求内容"
          editable={!mutation.isPending}
          multiline
          maxLength={1000}
          autoFocus
          placeholder="简单介绍一下你想聊什么…"
          placeholderTextColor="#9ca3af"
          textAlignVertical="top"
          className="mt-5 min-h-36 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-base text-neutral-900 dark:border-neutral-800 dark:bg-neutral-950 dark:text-white"
        />
        <Text className="mt-2 text-right text-xs text-neutral-400">{body.length}/1000</Text>
        {mutation.isError ? <Text className="mt-3 text-sm text-red-500">{errorMessage}</Text> : null}
        <Text className="mt-5 text-xs leading-5 text-neutral-500">为减少骚扰，每位用户每天最多发起 10 条私信请求。请求只能发送一条开场消息，且对方可以拒绝或屏蔽你。</Text>
      </View>
    </View>
  );
}
