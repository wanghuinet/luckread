import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, type AppStateStatus, ActivityIndicator, Pressable, StatusBar, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { Chat, type IMessage } from '@kesha-antonov/react-native-chat';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchMessages, fetchMessagesAfter, getMessageAttachmentUrl, markConversationRead, sendDirectMessage, uploadMessageAttachment,
  type MessagingAttachment,
} from '~/lib/messaging-api';
import type { LocalMediaFile } from '~/lib/publish-api';
import { createIdempotencyKey, getApiAuthHeaders } from '~/lib/api-client';
import { useAuthStore } from '~/store/auth-store';

type PendingAttachment = {
  localId: string;
  file: LocalMediaFile;
  status: 'uploading' | 'ready' | 'failed';
  attachment?: MessagingAttachment;
  error?: string;
};
type SendVariables = { body: string; attachments: MessagingAttachment[] };

function PrivateMessageImages({ currentMessage }: { currentMessage: IMessage }) {
  const [headers, setHeaders] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    void getApiAuthHeaders().then((value) => {
      if (active) setHeaders(value);
    });
    return () => { active = false; };
  }, []);
  const imageUrls = useMemo(() => {
    if (!currentMessage.image) return [];
    try {
      const parsed: unknown = JSON.parse(currentMessage.image);
      return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
    } catch {
      return [currentMessage.image];
    }
  }, [currentMessage.image]);
  if (!imageUrls.length) return null;
  return (
    <View className="flex-row flex-wrap gap-1.5 px-1 pb-1">
      {imageUrls.map((uri) => (
        <Image
          key={uri}
          source={{ uri, headers }}
          contentFit="cover"
          cachePolicy="none"
          style={{ width: imageUrls.length === 1 ? 224 : 108, height: 132, borderRadius: 10 }}
          accessibilityLabel="私信图片附件"
        />
      ))}
    </View>
  );
}

const compareSequence = (left: string, right: string) =>
  left.length === right.length ? left.localeCompare(right) : left.length - right.length;

export default function ConversationScreen() {
  const params = useLocalSearchParams<{ conversationId: string; participantName?: string }>();
  const conversationId = Array.isArray(params.conversationId) ? params.conversationId[0] : params.conversationId;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const user = useAuthStore((state) => state.user);
  const userId = user?.id;
  const [draft, setDraft] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [isPicking, setIsPicking] = useState(false);
  const [isFocused, setIsFocused] = useState(true);
  const [appState, setAppState] = useState<AppStateStatus>(() => (AppState.currentState ?? 'active') as AppStateStatus);
  useFocusEffect(useCallback(() => {
    setIsFocused(true);
    return () => setIsFocused(false);
  }, []));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);
  const pendingSend = useRef<{ fingerprint: string; key: string } | null>(null);
  const sendMutationPendingRef = useRef(false);
  const messagesQuery = useInfiniteQuery({
    queryKey: ['messaging', 'messages', conversationId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => fetchMessages(conversationId, pageParam, signal),
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextCursor ?? undefined : undefined,
    enabled: Boolean(conversationId),
    staleTime: 15_000,
  });
  const messages = useMemo(() => messagesQuery.data?.pages.flatMap((page) => page.items) ?? [], [messagesQuery.data?.pages]);
  const chatMessages = useMemo<IMessage[]>(() => messages.map((message) => {
    const attachments = message.attachments ?? [];
    const imageUrls = attachments
      .filter((attachment) => attachment.mimeType.startsWith('image/'))
      .map((attachment) => getMessageAttachmentUrl(message.conversation_id, attachment.mediaId));
    return {
      _id: message.message_id,
      text: [
        message.body,
        ...attachments.filter((attachment) => !attachment.mimeType.startsWith('image/'))
          .map((attachment) => '📎 ' + attachment.filename),
      ].filter(Boolean).join('\n'),
      ...(imageUrls.length ? { image: JSON.stringify(imageUrls) } : {}),
      createdAt: new Date(message.created_at),
      user: {
        _id: message.sender_user_id,
        name: message.sender_user_id === userId ? (user?.name || '我') : (params.participantName || '对方'),
      },
      sent: message.sender_user_id === userId,
    };
  }), [messages, params.participantName, user?.name, userId]);
  const latestSequence = messages.reduce((latest, message) =>
    compareSequence(message.sequence, latest) > 0 ? message.sequence : latest, '0');
  const incrementalQuery = useQuery({
    queryKey: ['messaging', 'messages-after', conversationId, latestSequence],
    queryFn: ({ signal }) => fetchMessagesAfter(conversationId, latestSequence, signal),
    enabled: Boolean(conversationId) && messagesQuery.isSuccess && isFocused && appState === 'active',
    refetchInterval: isFocused && appState === 'active' ? 4_000 : false,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
  useEffect(() => {
    const incoming = incrementalQuery.data?.items ?? [];
    if (!incoming.length) return;
    queryClient.setQueryData<typeof messagesQuery.data>(
      ['messaging', 'messages', conversationId],
      (current) => {
        if (!current?.pages.length) return current;
        const known = new Set(current.pages.flatMap((page) => page.items.map((item) => item.message_id)));
        const additions = incoming.filter((item) => !known.has(item.message_id));
        if (!additions.length) return current;
        const pages = [...current.pages];
        const firstPage = pages[0];
        if (firstPage) {
          pages[0] = { ...firstPage, items: [...firstPage.items, ...additions].sort((left, right) =>
            compareSequence(right.sequence, left.sequence)) };
        }
        return { ...current, pages };
      },
    );
  }, [incrementalQuery.data, conversationId, queryClient]);

  const uploadOne = useCallback(async (localId: string, file: LocalMediaFile) => {
    setPendingAttachments((current) => current.map((item) => item.localId === localId
      ? { ...item, status: 'uploading', error: undefined } : item));
    try {
      const attachment = await uploadMessageAttachment(file, localId);
      setPendingAttachments((current) => current.map((item) => item.localId === localId
        ? { ...item, status: 'ready', attachment, error: undefined } : item));
    } catch (error) {
      setPendingAttachments((current) => current.map((item) => item.localId === localId
        ? { ...item, status: 'failed', error: error instanceof Error ? error.message : '上传失败' } : item));
    }
  }, []);

  const pickAttachments = useCallback(async () => {
    if (isPicking || sendMutationPendingRef.current) return;
    const available = 4 - pendingAttachments.length;
    if (available <= 0) {
      Alert.alert('附件数量已达上限', '一条私信最多添加 4 个附件。');
      return;
    }
    setIsPicking(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('需要照片访问权限', '允许 LuckRead 访问照片后才能添加私信图片。');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        selectionLimit: available,
        allowsEditing: false,
        quality: 1,
      });
      if (result.canceled || !result.assets?.length) return;
      const selected: PendingAttachment[] = result.assets.slice(0, available).map((asset) => {
        const localId = createIdempotencyKey();
        const file: LocalMediaFile = {
          uri: asset.uri,
          name: asset.fileName || 'luckread-image-' + localId + '.jpg',
          mimeType: asset.mimeType || 'image/jpeg',
          size: asset.fileSize,
          width: asset.width,
          height: asset.height,
        };
        return { localId, file, status: 'uploading' };
      });
      setPendingAttachments((current) => [...current, ...selected]);
      for (const item of selected) await uploadOne(item.localId, item.file);
    } catch (error) {
      Alert.alert('无法添加附件', error instanceof Error ? error.message : '请稍后重试。');
    } finally {
      setIsPicking(false);
    }
  }, [isPicking, pendingAttachments.length, uploadOne]);

  const sendMutation = useMutation({
    mutationFn: (variables: SendVariables) => {
      const fingerprint = JSON.stringify([variables.body, variables.attachments.map((item) => item.mediaId)]);
      if (!pendingSend.current || pendingSend.current.fingerprint !== fingerprint) {
        pendingSend.current = { fingerprint, key: createIdempotencyKey() };
      }
      return sendDirectMessage(conversationId, variables.body, pendingSend.current.key, variables.attachments);
    },
    onMutate: () => { sendMutationPendingRef.current = true; },
    onSuccess: async (sentMessage, variables) => {
      sendMutationPendingRef.current = false;
      pendingSend.current = null;
      setDraft((current) => current.trim() === variables.body ? '' : current);
      setPendingAttachments([]);
      queryClient.setQueryData<typeof messagesQuery.data>(
        ['messaging', 'messages', conversationId],
        (current) => {
          if (!current?.pages.length || current.pages.some((page) => page.items.some((item) => item.message_id === sentMessage.message_id))) return current;
          const pages = [...current.pages];
          const firstPage = pages[0];
          if (firstPage) pages[0] = { ...firstPage, items: [...firstPage.items, sentMessage].sort((left, right) =>
            compareSequence(right.sequence, left.sequence)) };
          return { ...current, pages };
        },
      );
      await queryClient.invalidateQueries({ queryKey: ['messaging', 'conversations'] });
    },
    onError: (_error, variables) => {
      sendMutationPendingRef.current = false;
      setDraft(variables.body);
    },
  });

  const readyAttachments = pendingAttachments
    .filter((item) => item.status === 'ready' && item.attachment)
    .map((item) => item.attachment!);
  const sendCurrent = useCallback((bodyValue: string) => {
    const body = bodyValue.trim();
    if (sendMutation.isPending || pendingAttachments.some((item) => item.status !== 'ready')) return;
    if (!body && readyAttachments.length === 0) return;
    sendMutation.mutate({ body, attachments: readyAttachments });
  }, [pendingAttachments, readyAttachments, sendMutation]);
  const handleChatSend = useCallback((newMessages: IMessage[]) => {
    sendCurrent(newMessages[0]?.text ?? draft);
  }, [draft, sendCurrent]);

  useEffect(() => {
    const latest = messagesQuery.data?.pages?.[0]?.items?.[0];
    if (latest?.sequence) {
      void markConversationRead(conversationId, latest.sequence)
        .then(() => queryClient.invalidateQueries({ queryKey: ['messaging', 'conversations'] }))
        .catch(() => undefined);
    }
  }, [conversationId, messagesQuery.data?.pages?.[0]?.items?.[0]?.sequence]);

  return (
    <View className="flex-1 bg-white dark:bg-black">
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
      {pendingAttachments.length > 0 ? (
        <View className="border-b border-neutral-100 px-3 py-2 dark:border-neutral-800">
          {pendingAttachments.map((item) => (
            <View key={item.localId} className="mb-2 flex-row items-center">
              <Feather name={item.status === 'ready' ? 'paperclip' : item.status === 'failed' ? 'alert-circle' : 'upload-cloud'} size={16} color={item.status === 'failed' ? '#dc2626' : '#1d9bf0'} />
              <Text className="ml-2 flex-1 text-sm text-neutral-700 dark:text-neutral-200" numberOfLines={1}>
                {item.file.name} · {item.status === 'ready' ? '已就绪' : item.status === 'uploading' ? '上传中…' : '上传失败'}
              </Text>
              {item.status === 'failed' ? (
                <Pressable onPress={() => void uploadOne(item.localId, item.file)} className="px-2 py-1"><Text className="text-sm font-semibold text-sky-500">重试</Text></Pressable>
              ) : null}
              <Pressable accessibilityLabel="移除附件" onPress={() => setPendingAttachments((current) => current.filter((candidate) => candidate.localId !== item.localId))} className="p-1">
                <Feather name="x" size={16} color={isDark ? '#9ca3af' : '#6b7280'} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      {messagesQuery.isLoading ? (
        <View className="flex-1 items-center justify-center"><ActivityIndicator color="#1d9bf0" /></View>
      ) : messagesQuery.isError ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-base font-semibold text-neutral-900 dark:text-white">无法加载消息</Text>
          <Pressable onPress={() => messagesQuery.refetch()} className="mt-4 rounded-full bg-sky-500 px-5 py-2.5"><Text className="font-bold text-white">重试</Text></Pressable>
        </View>
      ) : (
        <>
          <View className="flex-1">
            <Chat
              messages={chatMessages}
              user={{ _id: userId || 'anonymous', name: user?.name || '我' }}
              onSend={handleChatSend}
              text={draft}
              onDraftChange={setDraft}
              isLoading={messagesQuery.isFetching && !messagesQuery.data}
              loadEarlierMessagesProps={{
                isAvailable: Boolean(messagesQuery.hasNextPage),
                isLoading: messagesQuery.isFetchingNextPage,
                isInfiniteScrollEnabled: true,
                onPress: () => {
                  if (messagesQuery.hasNextPage && !messagesQuery.isFetchingNextPage && !messagesQuery.isFetching) void messagesQuery.fetchNextPage();
                },
                label: '加载更早消息',
              }}
              locale="zh"
              colorScheme={isDark ? 'dark' : 'light'}
              appearance="plain"
              enableGestureHandlerRootView={false}
              attachments={false}
              renderMessageImage={(props) => <PrivateMessageImages currentMessage={props.currentMessage} />}
              audioRecording={false}
              videoRecording={false}
              reply={{ isEnabled: false }}
              defaultMessageActions={false}
              emptyChatGreeting={null}
              textInputProps={{
                placeholder: '发送消息…',
                placeholderTextColor: '#9ca3af',
                maxLength: 10000,
                editable: !sendMutation.isPending,
              }}
              isSendButtonAlwaysVisible
            />
          </View>
          <View className="flex-row items-center border-t border-neutral-100 px-4 py-2 dark:border-neutral-800">
            <Pressable accessibilityRole="button" accessibilityLabel="添加图片附件" disabled={isPicking || sendMutation.isPending || pendingAttachments.length >= 4} onPress={() => void pickAttachments()} className="mr-3 rounded-full p-2">
              {isPicking ? <ActivityIndicator size="small" color="#1d9bf0" /> : <Feather name="paperclip" size={21} color="#1d9bf0" />}
            </Pressable>
            <Text className="flex-1 text-xs text-neutral-500 dark:text-neutral-400">
              {pendingAttachments.length}/4 个附件 · 支持 JPG、PNG、WebP、GIF
            </Text>
            {!draft.trim() && readyAttachments.length > 0 ? (
              <Pressable disabled={sendMutation.isPending || readyAttachments.length !== pendingAttachments.length} onPress={() => sendCurrent('')} className="rounded-full bg-sky-500 px-4 py-2">
                <Text className="font-semibold text-white">发送附件</Text>
              </Pressable>
            ) : null}
          </View>
        </>
      )}
      {sendMutation.isError ? <Text className="px-4 py-2 text-sm text-red-500">发送失败，草稿已保留，请检查网络后重试。</Text> : null}
    </View>
  );
}
