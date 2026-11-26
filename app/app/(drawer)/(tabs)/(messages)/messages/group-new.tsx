import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StatusBar, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createGroupConversation } from '~/lib/messaging-api';
import { parseGroupMemberIds } from '~/lib/group-member-input';
import { useColorScheme } from 'nativewind';
import { useAuthStore } from '~/store/auth-store';

export default function NewGroupScreen() {
  const [name, setName] = useState('');
  const [members, setMembers] = useState('');
  const router = useRouter();
  const queryClient = useQueryClient();
  const userId = useAuthStore(state => state.user?.id);
  const { colorScheme } = useColorScheme();
  const mutation = useMutation({
    mutationFn: () => createGroupConversation(name.trim(), parseGroupMemberIds(members), userId),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['messaging', userId, 'conversations'] });
      router.replace({ pathname: '/messages/[conversationId]', params: {
        conversationId: result.conversationId, participantName: name.trim(), conversationType: 'group', groupName: name.trim(),
      } } as never);
    },
    onError: (error) => Alert.alert('群聊创建失败', error instanceof Error ? error.message : '请稍后重试'),
  });
  const ids = parseGroupMemberIds(members);
  const canCreate = name.trim().length > 0 && ids.length >= 2 && ids.length <= 49 && !mutation.isPending;
  return <View className="flex-1 bg-white dark:bg-black">
    <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />
    <View className="flex-row items-center justify-between border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
      <Pressable accessibilityLabel="返回" onPress={() => router.back()} className="p-2"><Feather name="arrow-left" size={22} color={colorScheme === 'dark' ? '#fff' : '#111'} /></Pressable>
      <Text className="text-lg font-bold text-neutral-900 dark:text-white">创建群聊</Text>
      <Pressable disabled={!canCreate} onPress={() => mutation.mutate()} className={`rounded-full px-4 py-2 ${canCreate ? 'bg-sky-500' : 'bg-neutral-300 dark:bg-neutral-700'}`}>
        {mutation.isPending ? <ActivityIndicator color="#fff" size="small" /> : <Text className="font-semibold text-white">创建</Text>}
      </Pressable>
    </View>
    <View className="px-4 py-5">
      <Text className="mb-2 text-sm text-neutral-500">群聊名称（最多 80 字）</Text>
      <TextInput value={name} onChangeText={setName} maxLength={80} placeholder="群聊名称" placeholderTextColor="#9ca3af" className="rounded-xl border border-neutral-200 px-4 py-3 text-neutral-900 dark:border-neutral-800 dark:text-white" />
      <Text className="mb-2 mt-5 text-sm text-neutral-500">成员 ID（2–49 个，逗号或空格分隔）</Text>
      <TextInput value={members} onChangeText={setMembers} multiline placeholder="粘贴成员用户 ID" placeholderTextColor="#9ca3af" textAlignVertical="top" className="min-h-28 rounded-xl border border-neutral-200 px-4 py-3 text-neutral-900 dark:border-neutral-800 dark:text-white" />
      <Text className="mt-2 text-xs leading-5 text-neutral-500">创建者之外至少添加 2 位成员，所有成员须已建立互相关注的私信关系。最多 50 人。群主负责添加成员，普通成员可退出群聊。</Text>
      {ids.length > 49 ? <Text className="mt-2 text-sm text-red-500">成员数量超出限制。</Text> : null}
    </View>
  </View>;
}
