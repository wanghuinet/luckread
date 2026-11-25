import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StatusBar, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addGroupMembers, fetchConversationMembers, leaveGroupConversation, removeGroupMember, transferGroupOwnership } from '~/lib/messaging-api';
import { fetchUserRelationshipsPage } from '~/lib/social-screen-api';
import { resolvePublicProfileById, unwrapApiData, type ApiPublicProfile } from '~/lib/content-adapter';
import { useAuthStore } from '~/store/auth-store';
import { useColorScheme } from 'nativewind';

type Candidate = ApiPublicProfile;
function extractIds(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const rawItems = Array.isArray(record.items) ? record.items : Array.isArray(record.users) ? record.users : [];
  return rawItems.map(item => {
    if (!item || typeof item !== 'object') return '';
    const row = item as Record<string, unknown>;
    const user = row.user && typeof row.user === 'object' ? row.user as Record<string, unknown> : row;
    return String(user.user_id ?? user.userId ?? user.id ?? '');
  }).filter(Boolean);
}
export default function GroupInfoScreen() {
  const params = useLocalSearchParams<{ conversationId: string; groupName?: string }>();
  const conversationId = Array.isArray(params.conversationId) ? params.conversationId[0] : params.conversationId;
  const router = useRouter();
  const queryClient = useQueryClient();
  const userId = useAuthStore(state => state.user?.id);
  const { colorScheme } = useColorScheme();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const members = useQuery({
    queryKey: ['messaging', 'members', conversationId],
    queryFn: ({ signal }) => fetchConversationMembers(conversationId, signal),
    enabled: Boolean(conversationId),
  });
  const owner = members.data?.some(m => m.user_id === userId && m.member_role === 'owner') ?? false;
  const memberProfiles = useQuery({
    queryKey: ['messaging', 'member-profiles', members.data?.map(m => m.user_id)],
    queryFn: async ({ signal }) => Promise.all((members.data ?? []).map(async member => ({
      userId: member.user_id, profile: await resolvePublicProfileById(member.user_id, signal),
    }))),
    enabled: Boolean(members.data?.length),
  });
  const profileById = new Map((memberProfiles.data ?? []).map(item => [item.userId, item.profile]));
  const following = useQuery({
    queryKey: ['messaging', 'member-picker-following', userId],
    queryFn: async ({ signal }) => {
      if (!userId) return [];
      const result = await fetchUserRelationshipsPage(userId, 'following', { limit: 100, signal });
      if (!result.response.ok) throw new Error('无法加载关注列表');
      const page = unwrapApiData<unknown>(result.data);
      return extractIds(page);
    },
    enabled: owner && Boolean(userId),
  });
  const candidates = useQuery({
    queryKey: ['messaging', 'member-picker-profiles', following.data],
    queryFn: async ({ signal }) => {
      const ids = following.data ?? [];
      const profiles = await Promise.all(ids.map(id => resolvePublicProfileById(id, signal)));
      return profiles.filter((p): p is ApiPublicProfile => Boolean(p));
    },
    enabled: owner && following.isSuccess,
  });
  const currentIds = new Set(members.data?.map(m => m.user_id) ?? []);
  const filteredCandidates = useMemo(() => (candidates.data ?? []).filter(p => {
    if (!p.id || currentIds.has(p.id)) return false;
    const term = search.trim().replace(/^@/, '').toLowerCase();
    if (!term) return true;
    return (p.username ?? '').toLowerCase().includes(term) || (p.displayName ?? '').toLowerCase().includes(term);
  }), [candidates.data, members.data, search, selected]);
  const addMutation = useMutation({
    mutationFn: () => addGroupMembers(conversationId, selected),
    onSuccess: async () => { setSelected([]); await members.refetch(); await queryClient.invalidateQueries({ queryKey: ['messaging', 'conversations'] }); },
    onError: e => Alert.alert('添加失败', e instanceof Error ? e.message : '请重试'),
  });
  const removeMutation = useMutation({
    mutationFn: (memberId: string) => removeGroupMember(conversationId, memberId),
    onSuccess: async () => { await members.refetch(); await queryClient.invalidateQueries({ queryKey: ['messaging', 'conversations'] }); },
    onError: e => Alert.alert('移除失败', e instanceof Error ? e.message : '请重试'),
  });
  const transferMutation = useMutation({
    mutationFn: (targetId: string) => transferGroupOwnership(conversationId, targetId),
    onSuccess: async () => { await members.refetch(); await queryClient.invalidateQueries({ queryKey: ['messaging', 'conversations'] }); Alert.alert('已移交群主', '群主身份已成功移交。'); },
    onError: e => Alert.alert('移交失败', e instanceof Error ? e.message : '请重试'),
  });
  const leaveMutation = useMutation({
    mutationFn: () => leaveGroupConversation(conversationId),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['messaging', 'conversations'] }); router.replace('/messages' as never); },
    onError: e => Alert.alert('退出失败', e instanceof Error ? e.message : '请重试'),
  });
  const toggle = (id: string) => setSelected(current => current.includes(id) ? current.filter(v => v !== id) : current.length + (members.data?.length ?? 0) >= 50 ? current : [...current, id]);
  const display = (profile?: ApiPublicProfile | null, fallback?: string) => profile?.displayName?.trim() || (profile?.username ? '@' + profile.username : fallback || 'LuckRead 用户');
  return <View className="flex-1 bg-white dark:bg-black">
    <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />
    <View className="flex-row items-center border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
      <Pressable onPress={() => router.back()} className="p-2"><Feather name="arrow-left" size={22} color={colorScheme === 'dark' ? '#fff' : '#111'} /></Pressable>
      <Text className="ml-2 flex-1 text-lg font-bold text-neutral-900 dark:text-white">群聊信息</Text>
    </View>
    <ScrollView className="flex-1 px-4 py-4" keyboardShouldPersistTaps="handled">
      <Text className="text-xl font-bold text-neutral-900 dark:text-white">{params.groupName || '群聊'}</Text>
      <Text className="mt-1 text-sm text-neutral-500">{members.data?.length ?? 0}/50 位成员</Text>
      <Text className="mt-5 mb-2 font-semibold text-neutral-900 dark:text-white">成员</Text>
      {members.isLoading ? <ActivityIndicator color="#1d9bf0" /> : members.isError ? (
        <View className="items-center rounded-xl bg-red-50 px-4 py-4 dark:bg-red-950/30">
          <Text className="text-sm text-red-600 dark:text-red-300">无法加载群聊成员，请检查网络后重试。</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="重试加载群聊成员" onPress={() => void members.refetch()} className="mt-3 rounded-full bg-sky-500 px-5 py-2">
            <Text className="font-semibold text-white">重试</Text>
          </Pressable>
        </View>
      ) : members.data?.map(member => <View key={member.user_id} className="flex-row items-center border-b border-neutral-100 py-3 dark:border-neutral-800">
        <View className="h-9 w-9 items-center justify-center rounded-full bg-sky-50 dark:bg-sky-950/40">{profileById.get(member.user_id)?.avatar ? <Image source={{ uri: profileById.get(member.user_id)?.avatar as string }} className="h-9 w-9 rounded-full" /> : <Feather name="user" size={18} color="#1d9bf0" />}</View>
        <View className="ml-3 flex-1"><Text className="text-neutral-900 dark:text-white" numberOfLines={1}>{display(profileById.get(member.user_id), member.user_id)}</Text><Text className="text-xs text-neutral-500">{member.member_role === 'owner' ? '群主' : '成员'} · @{profileById.get(member.user_id)?.username || member.user_id}</Text></View>
        {owner && member.member_role !== 'owner' ? <View className="flex-row"><Pressable disabled={transferMutation.isPending} onPress={() => Alert.alert('移交群主', '确定将群主身份移交给此成员？移交后你将成为普通成员。', [{text:'取消',style:'cancel'},{text:'移交',onPress:()=>transferMutation.mutate(member.user_id)}])} className="p-2"><Feather name="award" size={18} color="#1d9bf0" /></Pressable><Pressable disabled={removeMutation.isPending} onPress={() => Alert.alert('移除成员', '确定从群聊移除此成员？', [{text:'取消',style:'cancel'},{text:'移除',style:'destructive',onPress:()=>removeMutation.mutate(member.user_id)}])} className="p-2"><Feather name="user-minus" size={18} color="#dc2626" /></Pressable></View> : null}
      </View>)}
      {owner ? <View className="mt-5">
        <Text className="mb-2 font-semibold text-neutral-900 dark:text-white">添加关注的人</Text>
        <TextInput value={search} onChangeText={setSearch} placeholder="搜索姓名或用户名" placeholderTextColor="#9ca3af" className="rounded-full border border-neutral-200 px-4 py-3 text-neutral-900 dark:border-neutral-800 dark:text-white" />
        {following.isLoading || candidates.isLoading ? <ActivityIndicator className="py-4" color="#1d9bf0" /> : null}
        {following.isError || candidates.isError ? (
          <View className="py-3">
            <Text className="text-sm text-red-500">关注列表暂时不可用，请稍后重试。</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="重试加载关注列表" onPress={() => {
              if (following.isError) void following.refetch();
              if (candidates.isError) void candidates.refetch();
            }} className="mt-2 self-start rounded-full bg-sky-500 px-4 py-2">
              <Text className="font-semibold text-white">重试</Text>
            </Pressable>
          </View>
        ) : null}
        {filteredCandidates.map(profile => <Pressable key={profile.id} onPress={() => toggle(profile.id)} className="flex-row items-center border-b border-neutral-100 py-3 dark:border-neutral-800">
          {profile.avatar ? <Image source={{ uri: profile.avatar }} className="h-10 w-10 rounded-full" /> : <View className="h-10 w-10 items-center justify-center rounded-full bg-neutral-200 dark:bg-neutral-700"><Feather name="user" size={18} color="#6b7280" /></View>}
          <View className="ml-3 flex-1"><Text className="font-semibold text-neutral-900 dark:text-white">{display(profile)}</Text><Text className="text-xs text-neutral-500">@{profile.username || profile.id}</Text></View>
          <Feather name={selected.includes(profile.id) ? 'check-circle' : 'circle'} size={22} color={selected.includes(profile.id) ? '#1d9bf0' : '#9ca3af'} />
        </Pressable>)}
        {selected.length > 0 ? <View className="mt-3 flex-row flex-wrap items-center"><Text className="text-sm text-sky-600">已选 {selected.length} 人</Text>{selected.map(id => { const profile = candidates.data?.find(p => p.id === id); return <Pressable key={id} onPress={() => toggle(id)} className="ml-2 mt-1 rounded-full border border-sky-200 px-3 py-1 dark:border-sky-900"><Text className="text-xs text-sky-600">{display(profile, id)} ×</Text></Pressable>; })}<Pressable onPress={() => setSelected([])} className="ml-3"><Text className="text-sm text-neutral-500">清空</Text></Pressable></View> : null}
        <Pressable disabled={!selected.length || addMutation.isPending} onPress={() => addMutation.mutate()} className="mt-3 items-center rounded-full bg-sky-500 py-3 disabled:opacity-50">{addMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text className="font-semibold text-white">添加所选成员</Text>}</Pressable>
        <Text className="mt-2 text-xs text-neutral-500">从关注列表选择。仅群主可添加；服务器仍会校验私信联系关系、群屏蔽策略和人数上限。</Text>
      </View> : null}
      {owner ? <Text className="mt-6 text-sm text-neutral-500">请先移交群主身份，之后即可退出群聊。</Text> : <Pressable disabled={leaveMutation.isPending} onPress={() => Alert.alert('退出群聊', '退出后将不再接收群聊消息。确定退出？', [{text:'取消',style:'cancel'},{text:'退出',style:'destructive',onPress:()=>leaveMutation.mutate()}])} className="mt-8 items-center rounded-full border border-red-300 py-3"><Text className="font-semibold text-red-500">退出群聊</Text></Pressable>}
    </ScrollView>
  </View>;
}
