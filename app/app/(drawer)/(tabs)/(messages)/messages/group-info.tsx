import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StatusBar, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addGroupMembers, fetchConversationMembers, leaveGroupConversation, removeGroupMember } from '~/lib/messaging-api';
import { useAuthStore } from '~/store/auth-store';
import { useColorScheme } from 'nativewind';

export default function GroupInfoScreen() {
  const params = useLocalSearchParams<{ conversationId: string; groupName?: string }>();
  const conversationId = Array.isArray(params.conversationId) ? params.conversationId[0] : params.conversationId;
  const router = useRouter();
  const queryClient = useQueryClient();
  const userId = useAuthStore(state => state.user?.id);
  const { colorScheme } = useColorScheme();
  const [ids, setIds] = useState('');
  const members = useQuery({
    queryKey: ['messaging', 'members', conversationId],
    queryFn: ({ signal }) => fetchConversationMembers(conversationId, signal),
    enabled: Boolean(conversationId),
  });
  const owner = members.data?.some(m => m.user_id === userId && m.member_role === 'owner') ?? false;
  const addMutation = useMutation({
    mutationFn: () => addGroupMembers(conversationId, ids.split(/[\\s,;]+/).map(v => v.trim()).filter(Boolean)),
    onSuccess: async () => { setIds(''); await members.refetch(); await queryClient.invalidateQueries({ queryKey: ['messaging', 'conversations'] }); },
    onError: e => Alert.alert('添加失败', e instanceof Error ? e.message : '请重试'),
  });
  const removeMutation = useMutation({
    mutationFn: (memberId: string) => removeGroupMember(conversationId, memberId),
    onSuccess: async () => { await members.refetch(); await queryClient.invalidateQueries({ queryKey: ['messaging', 'conversations'] }); },
    onError: e => Alert.alert('移除失败', e instanceof Error ? e.message : '请重试'),
  });
  const leaveMutation = useMutation({
    mutationFn: () => leaveGroupConversation(conversationId),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['messaging', 'conversations'] }); router.replace('/messages' as never); },
    onError: e => Alert.alert('退出失败', e instanceof Error ? e.message : '请重试'),
  });
  return <View className="flex-1 bg-white dark:bg-black">
    <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />
    <View className="flex-row items-center border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
      <Pressable onPress={() => router.back()} className="p-2"><Feather name="arrow-left" size={22} color={colorScheme === 'dark' ? '#fff' : '#111'} /></Pressable>
      <Text className="ml-2 flex-1 text-lg font-bold text-neutral-900 dark:text-white">群聊信息</Text>
    </View>
    <ScrollView className="flex-1 px-4 py-4">
      <Text className="text-xl font-bold text-neutral-900 dark:text-white">{params.groupName || '群聊'}</Text>
      <Text className="mt-1 text-sm text-neutral-500">{members.data?.length ?? 0}/50 位成员</Text>
      <Text className="mt-5 mb-2 font-semibold text-neutral-900 dark:text-white">成员</Text>
      {members.isLoading ? <ActivityIndicator color="#1d9bf0" /> : members.data?.map(member => <View key={member.user_id} className="flex-row items-center border-b border-neutral-100 py-3 dark:border-neutral-800">
        <View className="h-9 w-9 items-center justify-center rounded-full bg-sky-50 dark:bg-sky-950/40"><Feather name="user" size={18} color="#1d9bf0" /></View>
        <View className="ml-3 flex-1"><Text className="text-neutral-900 dark:text-white" numberOfLines={1}>{member.user_id}</Text><Text className="text-xs text-neutral-500">{member.member_role === 'owner' ? '群主' : '成员'}</Text></View>
        {owner && member.member_role !== 'owner' ? <Pressable disabled={removeMutation.isPending} onPress={() => Alert.alert('移除成员', '确定从群聊移除此成员？', [{text:'取消',style:'cancel'},{text:'移除',style:'destructive',onPress:()=>removeMutation.mutate(member.user_id)}])} className="p-2"><Feather name="user-minus" size={18} color="#dc2626" /></Pressable> : null}
      </View>)}
      {owner ? <View className="mt-5">
        <Text className="mb-2 text-sm text-neutral-500">添加成员 ID（逗号或空格分隔）</Text>
        <TextInput value={ids} onChangeText={setIds} multiline placeholder="粘贴成员用户 ID" placeholderTextColor="#9ca3af" className="min-h-20 rounded-xl border border-neutral-200 px-3 py-3 text-neutral-900 dark:border-neutral-800 dark:text-white" />
        <Pressable disabled={!ids.trim() || addMutation.isPending} onPress={() => addMutation.mutate()} className="mt-3 items-center rounded-full bg-sky-500 py-3 disabled:opacity-50">{addMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text className="font-semibold text-white">添加成员</Text>}</Pressable>
        <Text className="mt-2 text-xs text-neutral-500">仅群主可添加成员。新成员须与群主已建立私信联系，且不能违反群内屏蔽策略。</Text>
      </View> : null}
      {members.data?.some(m => m.user_id === userId && m.member_role === 'owner') ? <Text className="mt-6 text-sm text-neutral-500">群主暂不能退出群聊；需先移交群主功能完善后再支持。</Text> : <Pressable onPress={() => Alert.alert('退出群聊', '退出后将不再接收群聊消息。确定退出？', [{text:'取消',style:'cancel'},{text:'退出',style:'destructive',onPress:()=>leaveMutation.mutate()}])} className="mt-8 items-center rounded-full border border-red-300 py-3"><Text className="font-semibold text-red-500">退出群聊</Text></Pressable>}
    </ScrollView>
  </View>;
}
