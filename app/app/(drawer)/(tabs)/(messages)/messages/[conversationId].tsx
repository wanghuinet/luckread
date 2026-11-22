import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, type AppStateStatus, ActivityIndicator, Modal, Pressable, StatusBar, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { Chat, type IMessage } from '@kesha-antonov/react-native-chat';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  editDirectMessage, fetchConversationMembers, fetchMessages, fetchMessagesAfterBatch, getMessageAttachmentUrl, markConversationRead, recallDirectMessage, sendDirectMessage, uploadMessageAttachment,
  type MessagingAttachment,
  type MessagingMessage,
} from '~/lib/messaging-api';
import type { LocalMediaFile } from '~/lib/publish-api';
import { connectMessagingRealtime, setMessagingRealtimeTyping } from '~/lib/messaging-realtime';
import { createIdempotencyKey, getApiAuthHeaders } from '~/lib/api-client';
import { useAuthStore } from '~/store/auth-store';
import { resolvePublicProfileById } from '~/lib/content-adapter';

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

// Keep realtime/incremental inserts from growing the newest history page indefinitely.
const MAX_LIVE_CACHE_PAGE_ITEMS = 100;

export default function ConversationScreen() {
  const params = useLocalSearchParams<{ conversationId: string; participantName?: string; conversationType?: string; groupName?: string }>();
  const conversationId = Array.isArray(params.conversationId) ? params.conversationId[0] : params.conversationId;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const user = useAuthStore((state) => state.user);
  const userId = user?.id;
  const [draft, setDraft] = useState('');
  const [senderProfiles, setSenderProfiles] = useState<Record<string, { displayName?: string | null; username?: string }>>({});
  const senderProfileAttempted = useRef(new Set<string>());
  const [editTarget, setEditTarget] = useState<{ messageId: string; body: string } | null>(null);
  const [editDraft, setEditDraft] = useState('');
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
  useEffect(() => {
    if (!conversationId || !isFocused || appState !== 'active') return;
    return connectMessagingRealtime({
      conversationId,
      onState: (state) => {
        if (state === 'revoked') {
          void queryClient.invalidateQueries({ queryKey: ['messaging', 'members', conversationId] });
          void queryClient.invalidateQueries({ queryKey: ['messaging', 'conversations'] });
          router.back();
          return;
        }
        if (state !== 'connected') return;
        void queryClient.invalidateQueries({ queryKey: ['messaging', 'messages', conversationId] });
        void queryClient.invalidateQueries({ queryKey: ['messaging', 'messages-after', conversationId] });
        void queryClient.invalidateQueries({ queryKey: ['messaging', 'members', conversationId] });
        void queryClient.invalidateQueries({ queryKey: ['messaging', 'conversations'] });
      },
      onEvent: (event) => {
        if (!event || typeof event !== 'object') return;
        const realtimeEvent = event as { type?: unknown; payload?: unknown };
        if (realtimeEvent.type === 'typing.changed' && realtimeEvent.payload &&
          typeof realtimeEvent.payload === 'object' &&
          Array.isArray((realtimeEvent.payload as { activeUserIds?: unknown }).activeUserIds)) {
          queryClient.setQueryData(['messaging', 'typing', conversationId], {
            activeUserIds: (realtimeEvent.payload as { activeUserIds: unknown[] }).activeUserIds.filter((id): id is string => typeof id === 'string'),
          });
          return;
        }
        if (typeof realtimeEvent.type === 'string' && realtimeEvent.type.startsWith('message.') &&
          realtimeEvent.payload && typeof realtimeEvent.payload === 'object') {
          const message = realtimeEvent.payload as Record<string, unknown>;
          if (typeof message.message_id === 'string' && typeof message.sequence === 'string' &&
            typeof message.conversation_id === 'string' && typeof message.sender_user_id === 'string' &&
            typeof message.body === 'string' && typeof message.created_at === 'string') {
            if (realtimeEvent.type === 'message.created') {
              const cached = queryClient.getQueryData<typeof messagesQuery.data>(['messaging', 'messages', conversationId]);
              if (!cached?.pages.length) {
                // An event can race the first history request before its cache exists.
                // Force a fresh read so the in-flight snapshot cannot hide this message.
                void queryClient.invalidateQueries({ queryKey: ['messaging', 'messages', conversationId] });
                void queryClient.invalidateQueries({ queryKey: ['messaging', 'messages-after', conversationId] });
                void queryClient.invalidateQueries({ queryKey: ['messaging', 'conversations'] });
                return;
              }
              const knownMessages = cached.pages.flatMap((page) => page.items);
              const knownCursor = knownMessages.reduce((latest, item) => compareSequence(item.sequence, latest) > 0 ? item.sequence : latest, '0');
              const knownIds = new Set(knownMessages.map((item) => item.message_id));
              if (!knownIds.has(message.message_id) &&
                cached.pages[0] && cached.pages[0].items.length >= MAX_LIVE_CACHE_PAGE_ITEMS) {
                // Let the persisted history query rebuild a bounded page instead of
                // retaining every live event in the first infinite-query page.
                void queryClient.invalidateQueries({ queryKey: ['messaging', 'messages', conversationId] });
                void queryClient.invalidateQueries({ queryKey: ['messaging', 'conversations'] });
                return;
              }
              if (!knownIds.has(message.message_id) && /^\d+$/.test(message.sequence) && /^\d+$/.test(knownCursor) && knownCursor !== '0') {
                const eventSequence = BigInt(message.sequence);
                const cursorSequence = BigInt(knownCursor);
                if (eventSequence > cursorSequence + 1n) {
                  // A forward gap: recover from the existing cursor without prematurely inserting the event.
                  void queryClient.invalidateQueries({ queryKey: ['messaging', 'messages-after', conversationId] });
                  void queryClient.invalidateQueries({ queryKey: ['messaging', 'conversations'] });
                  return;
                }
                if (eventSequence <= cursorSequence) {
                  // Late delivery of a missing older event: refresh loaded history pages, not the advanced cursor.
                  void queryClient.invalidateQueries({ queryKey: ['messaging', 'messages', conversationId] });
                  void queryClient.invalidateQueries({ queryKey: ['messaging', 'conversations'] });
                  return;
                }
              }
            }
            queryClient.setQueryData<typeof messagesQuery.data>(
              ['messaging', 'messages', conversationId],
              (current) => {
                if (!current?.pages.length) return current;
                let found = false;
                const pages = current.pages.map((page) => ({
                  ...page,
                  items: page.items.map((item) => {
                    if (item.message_id !== message.message_id) return item;
                    found = true;
                    return { ...item, ...message } as typeof item;
                  }),
                }));
                if (!found && realtimeEvent.type === 'message.created') {
                  const firstPage = pages[0];
                  if (firstPage) {
                    pages[0] = {
                      ...firstPage,
                      items: [...firstPage.items, message as unknown as (typeof firstPage.items)[number]]
                        .sort((left, right) => compareSequence(right.sequence, left.sequence)),
                    };
                  }
                }
                return { ...current, pages };
              },
            );
            void queryClient.invalidateQueries({ queryKey: ['messaging', 'conversations'] });
            return;
          }
        }
        if (realtimeEvent.type === 'conversation.read' ||
          (typeof realtimeEvent.type === 'string' && realtimeEvent.type.startsWith('group.member.'))) {
          void queryClient.invalidateQueries({ queryKey: ['messaging', 'members', conversationId] });
          void queryClient.invalidateQueries({ queryKey: ['messaging', 'conversations'] });
          return;
        }
        void queryClient.invalidateQueries({ queryKey: ['messaging', 'messages', conversationId] });
        void queryClient.invalidateQueries({ queryKey: ['messaging', 'messages-after', conversationId] });
        void queryClient.invalidateQueries({ queryKey: ['messaging', 'conversations'] });
        void queryClient.invalidateQueries({ queryKey: ['messaging', 'members', conversationId] });
      },
    });
  }, [conversationId, isFocused, appState, queryClient, router]);
  const pendingSend = useRef<{ fingerprint: string; key: string } | null>(null);
  const sendMutationPendingRef = useRef(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingRefreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const typingActiveRef = useRef(false);
  const stopTyping = useCallback(() => {
    if (typingTimer.current) clearTimeout(typingTimer.current);
    if (typingRefreshTimer.current) clearInterval(typingRefreshTimer.current);
    typingTimer.current = null;
    typingRefreshTimer.current = null;
    if (!typingActiveRef.current) return;
    typingActiveRef.current = false;
    setMessagingRealtimeTyping(conversationId, false);
  }, [conversationId]);
  const handleDraftChange = useCallback((value: string) => {
    setDraft(value);
    if (!value.trim()) { stopTyping(); return; }
    if (!typingActiveRef.current) {
      typingActiveRef.current = true;
      setMessagingRealtimeTyping(conversationId, true);
      typingRefreshTimer.current = setInterval(() => {
        if (typingActiveRef.current) setMessagingRealtimeTyping(conversationId, true);
      }, 3_000);
    }
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(stopTyping, 1800);
  }, [conversationId, stopTyping]);
  useEffect(() => () => stopTyping(), [stopTyping]);
  const messagesQuery = useInfiniteQuery({
    queryKey: ['messaging', 'messages', conversationId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => fetchMessages(conversationId, pageParam, signal),
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextCursor ?? undefined : undefined,
    enabled: Boolean(conversationId),
    staleTime: 15_000,
  });
  const messages = useMemo(() => messagesQuery.data?.pages.flatMap((page) => page.items) ?? [], [messagesQuery.data?.pages]);
  const membersQuery = useQuery({ queryKey: ['messaging', 'members', conversationId], queryFn: ({ signal }) => fetchConversationMembers(conversationId, signal), enabled: Boolean(conversationId) && params.conversationType !== 'group', staleTime: 60_000 });
  // The authenticated WebSocket sends the initial typing snapshot and subsequent changes.
  const typingQuery = useQuery({
    queryKey: ['messaging', 'typing', conversationId],
    queryFn: async () => ({ activeUserIds: [] as string[] }),
    enabled: false,
    initialData: { activeUserIds: [] as string[] },
    staleTime: Infinity,
  });
  const peerTyping = typingQuery.data?.activeUserIds.some(id => id !== userId) ?? false;
  const latestOwnMessage = messages.filter(message => message.sender_user_id === userId && !message.recalled_at).reduce((latest, message) => compareSequence(message.sequence, latest) > 0 ? message.sequence : latest, '0');
  const peerReadSequence = membersQuery.data?.find(member => member.user_id !== userId)?.last_read_sequence ?? '0';
  const lastOwnMessageIsRead = latestOwnMessage !== '0' && compareSequence(peerReadSequence, latestOwnMessage) >= 0;
  useEffect(() => {
    if (params.conversationType !== 'group') return;
    const senderIds = Array.from(new Set(messages.map(message => message.sender_user_id)
      .filter(id => id && id !== userId && !senderProfileAttempted.current.has(id))));
    if (!senderIds.length) return;
    let active = true;
    const controller = new AbortController();
    senderIds.forEach(id => senderProfileAttempted.current.add(id));
    void Promise.all(senderIds.map(async id => [id, await resolvePublicProfileById(id, controller.signal)] as const)).then(results => {
      if (!active) return;
      setSenderProfiles(current => {
        const next = { ...current };
        for (const [id, profile] of results) if (profile) next[id] = profile;
        return next;
      });
    });
    return () => { active = false; controller.abort(); };
  }, [messages, params.conversationType, userId]);
  const chatMessages = useMemo<IMessage[]>(() => messages.map((message) => {
    const attachments = message.attachments ?? [];
    const imageUrls = attachments
      .filter((attachment) => attachment.mimeType.startsWith('image/'))
      .map((attachment) => getMessageAttachmentUrl(message.conversation_id, attachment.mediaId));
    return {
      _id: message.message_id,
      text: message.recalled_at
        ? (message.sender_user_id === userId ? '你撤回了一条消息' : '对方撤回了一条消息')
        : [
            message.body,
            ...attachments.filter((attachment) => !attachment.mimeType.startsWith('image/'))
              .map((attachment) => '📎 ' + attachment.filename),
          ].filter(Boolean).join(' ') + (message.edited_at ? '  （已编辑）' : ''),
      ...(!message.recalled_at && imageUrls.length ? { image: JSON.stringify(imageUrls) } : {}),
      createdAt: new Date(message.created_at),
      user: {
        _id: message.sender_user_id,
        name: message.sender_user_id === userId ? (user?.name || '我') : (senderProfiles[message.sender_user_id]?.displayName?.trim() || (senderProfiles[message.sender_user_id]?.username ? '@' + senderProfiles[message.sender_user_id]?.username : params.participantName || '群成员')),
      },
      sent: message.sender_user_id === userId,
    };
  }), [messages, params.participantName, senderProfiles, user?.name, userId]);
  const latestSequence = messages.reduce((latest, message) =>
    compareSequence(message.sequence, latest) > 0 ? message.sequence : latest, '0');
  const incrementalQuery = useQuery({
    queryKey: ['messaging', 'messages-after', conversationId, latestSequence],
    queryFn: ({ signal }) => fetchMessagesAfterBatch(conversationId, latestSequence, signal),
    enabled: Boolean(conversationId) && messagesQuery.isSuccess && isFocused && appState === 'active',
    staleTime: Infinity,
  });
  // Continue bounded drains from the returned cursor rather than silently stopping at the 500-message budget.
  const continuationCursor = incrementalQuery.data?.hasMore ? incrementalQuery.data.nextCursor : null;
  const continuationQuery = useQuery({
    queryKey: ['messaging', 'messages-after-continuation', conversationId, continuationCursor],
    queryFn: async ({ signal }) => {
      // Each batch is capped at 10 pages. Continue for at most four additional batches
      // (2,000 messages) in this query cycle to avoid an unbounded request burst.
      const items: MessagingMessage[] = [];
      let cursor = continuationCursor!;
      let hasMore = true;
      for (let batch = 0; batch < 4 && hasMore; batch++) {
        const page = await fetchMessagesAfterBatch(conversationId, cursor, signal);
        items.push(...page.items);
        hasMore = page.hasMore;
        if (page.nextCursor) cursor = page.nextCursor;
        if (!page.items.length) break;
      }
      return { items, nextCursor: hasMore ? cursor : null, hasMore };
    },
    enabled: Boolean(conversationId) && Boolean(continuationCursor) && isFocused && appState === 'active',
    staleTime: Infinity,
  });
  useEffect(() => {
    const incoming = [
      ...(incrementalQuery.data?.items ?? []),
      ...(continuationQuery.data?.items ?? []),
    ];
    if (!incoming.length) return;
    let cachePageOverflow = false;
    queryClient.setQueryData<typeof messagesQuery.data>(
      ['messaging', 'messages', conversationId],
      (current) => {
        if (!current?.pages.length) return current;
        const known = new Set(current.pages.flatMap((page) => page.items.map((item) => item.message_id)));
        const additions = incoming.filter((item) => !known.has(item.message_id));
        if (!additions.length) return current;
        const pages = [...current.pages];
        const firstPage = pages[0];
        if (firstPage && firstPage.items.length + additions.length > MAX_LIVE_CACHE_PAGE_ITEMS) {
          cachePageOverflow = true;
          return current;
        }
        if (firstPage) {
          pages[0] = { ...firstPage, items: [...firstPage.items, ...additions].sort((left, right) =>
            compareSequence(right.sequence, left.sequence)) };
        }
        return { ...current, pages };
      },
    );
    if (cachePageOverflow) {
      // Neon is authoritative; rebuild bounded history pages rather than growing
      // one cache page by thousands of messages after a long offline interval.
      void queryClient.invalidateQueries({ queryKey: ['messaging', 'messages', conversationId] });
      void queryClient.invalidateQueries({ queryKey: ['messaging', 'conversations'] });
    }
  }, [incrementalQuery.data, continuationQuery.data, conversationId, queryClient]);



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
      stopTyping();
      setPendingAttachments([]);
      let cachePageOverflow = false;
      queryClient.setQueryData<typeof messagesQuery.data>(
        ['messaging', 'messages', conversationId],
        (current) => {
          if (!current?.pages.length || current.pages.some((page) => page.items.some((item) => item.message_id === sentMessage.message_id))) return current;
          const pages = [...current.pages];
          const firstPage = pages[0];
          if (firstPage && firstPage.items.length >= MAX_LIVE_CACHE_PAGE_ITEMS) {
            cachePageOverflow = true;
            return current;
          }
          if (firstPage) pages[0] = { ...firstPage, items: [...firstPage.items, sentMessage].sort((left, right) =>
            compareSequence(right.sequence, left.sequence)) };
          return { ...current, pages };
        },
      );
      if (cachePageOverflow) {
        // Local send success must obey the same bounded cache policy as WebSocket
        // and incremental sync; the persisted history query will restore the page.
        void queryClient.invalidateQueries({ queryKey: ['messaging', 'messages', conversationId] });
      }
      await queryClient.invalidateQueries({ queryKey: ['messaging', 'conversations'] });
    },
    onError: (_error, variables) => {
      sendMutationPendingRef.current = false;
      setDraft(variables.body);
    },
  });

  const applyMessageUpdate = useCallback((updated: import('~/lib/messaging-api').MessagingMessage) => {
    queryClient.setQueryData<typeof messagesQuery.data>(
      ['messaging', 'messages', conversationId],
      (current) => {
        if (!current?.pages.length) return current;
        return {
          ...current,
          pages: current.pages.map((page) => ({
            ...page,
            items: page.items.map((item) => item.message_id === updated.message_id ? updated : item),
          })),
        };
      },
    );
    void queryClient.invalidateQueries({ queryKey: ['messaging', 'conversations'] });
  }, [conversationId, queryClient]);

  const editMutation = useMutation({
    mutationFn: () => {
      if (!editTarget) throw new Error('请选择要编辑的消息。');
      return editDirectMessage(conversationId, editTarget.messageId, editDraft);
    },
    onSuccess: (updated) => {
      applyMessageUpdate(updated);
      setEditTarget(null);
      setEditDraft('');
    },
  });
  const recallMutation = useMutation({
    mutationFn: (messageId: string) => recallDirectMessage(conversationId, messageId),
    onSuccess: applyMessageUpdate,
  });

  const handleLongPressMessage = useCallback((_context: unknown, selected: IMessage) => {
    const original = messages.find((message) => message.message_id === String(selected._id));
    if (!original || original.sender_user_id !== userId || original.recalled_at) return;
    Alert.alert('消息操作', '选择对这条消息执行的操作。', [
      { text: '编辑', onPress: () => { setEditTarget({ messageId: original.message_id, body: original.body }); setEditDraft(original.body); } },
      { text: '撤回', style: 'destructive', onPress: () => Alert.alert('撤回这条消息？', '撤回后，双方都无法再查看消息内容和附件。', [
        { text: '取消', style: 'cancel' },
        { text: '确认撤回', style: 'destructive', onPress: () => recallMutation.mutate(original.message_id) },
      ]) },
      { text: '取消', style: 'cancel' },
    ]);
  }, [messages, recallMutation, userId]);

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

  const [readAckCycle, setReadAckCycle] = useState(0);
  const readAckStateRef = useRef({ conversationId, acknowledged: '0', inFlight: false, retryPending: false });
  // Route params can change without remounting this screen. Give each conversation
  // an isolated acknowledgement state so a stale request cannot affect the next chat.
  if (readAckStateRef.current.conversationId !== conversationId) {
    readAckStateRef.current = { conversationId, acknowledged: '0', inFlight: false, retryPending: false };
  }
  useEffect(() => {
    if (!isFocused || appState !== 'active') return;
    const state = readAckStateRef.current;
    const latest = messagesQuery.data?.pages?.[0]?.items?.[0];
    if (!latest?.sequence || compareSequence(latest.sequence, state.acknowledged) <= 0) return;
    // A focus/resume or newer-message update can arrive while the previous request
    // is settling. Remember one retry so that event is not lost behind single-flight.
    if (state.inFlight) {
      state.retryPending = true;
      return;
    }
    state.inFlight = true;
    const targetSequence = latest.sequence;
    void markConversationRead(conversationId, targetSequence)
      .then(() => {
        if (readAckStateRef.current !== state) return;
        if (compareSequence(targetSequence, state.acknowledged) > 0) {
          state.acknowledged = targetSequence;
        }
        setReadAckCycle((cycle) => cycle + 1);
        return queryClient.invalidateQueries({ queryKey: ['messaging', 'conversations'] });
      })
      .catch(() => undefined)
      .finally(() => {
        if (readAckStateRef.current !== state) return;
        state.inFlight = false;
        if (state.retryPending) {
          state.retryPending = false;
          setReadAckCycle((cycle) => cycle + 1);
        }
      });
  }, [conversationId, messagesQuery.data?.pages?.[0]?.items?.[0]?.sequence, queryClient, readAckCycle, isFocused, appState]);

  return (
    <View className="flex-1 bg-white dark:bg-black">
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <View className="flex-row items-center border-b border-neutral-100 px-3 py-3 dark:border-neutral-800">
        <Pressable accessibilityRole="button" accessibilityLabel="返回私信列表" onPress={() => router.back()} className="p-2">
          <Feather name="chevron-left" size={24} color={isDark ? '#fff' : '#111827'} />
        </Pressable>
        <Text className="ml-2 flex-1 text-lg font-bold text-neutral-900 dark:text-white" numberOfLines={1}>{params.participantName || '对话'}</Text>
        {params.conversationType === 'group' ? <Pressable accessibilityRole="button" accessibilityLabel="群聊信息" onPress={() => router.push({ pathname: '/messages/group-info', params: { conversationId, groupName: params.groupName || params.participantName || '群聊' } } as never)} className="p-2"><Feather name="users" size={19} color="#1d9bf0" /></Pressable> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="刷新消息" onPress={() => messagesQuery.refetch()} className="p-2">
          <Feather name="refresh-cw" size={18} color="#1d9bf0" />
        </Pressable>
      </View>
      {peerTyping ? <Text className="px-4 py-1 text-xs text-sky-500">{params.conversationType === 'group' ? '有人正在输入…' : '对方正在输入…'}</Text> : null}
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
              onDraftChange={handleDraftChange}
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
              onLongPressMessage={handleLongPressMessage}
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
          {params.conversationType !== 'group' && latestOwnMessage !== '0' ? <Text className="px-4 pb-1 text-right text-xs text-neutral-500 dark:text-neutral-400">{lastOwnMessageIsRead ? '已读' : '已发送'}</Text> : null}
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
      {recallMutation.isError ? <Text className="px-4 py-2 text-sm text-red-500">撤回失败，请重试。</Text> : null}
      <Modal visible={Boolean(editTarget)} transparent animationType="fade" onRequestClose={() => setEditTarget(null)}>
        <View className="flex-1 justify-center bg-black/50 px-6">
          <View className="rounded-2xl bg-white p-4 dark:bg-neutral-900">
            <Text className="mb-3 text-lg font-bold text-neutral-900 dark:text-white">编辑消息</Text>
            <TextInput
              value={editDraft}
              onChangeText={setEditDraft}
              multiline
              maxLength={10000}
              autoFocus
              placeholder="编辑消息内容"
              placeholderTextColor="#9ca3af"
              className="min-h-28 rounded-xl border border-neutral-200 p-3 text-base text-neutral-900 dark:border-neutral-700 dark:text-white"
              style={{ textAlignVertical: 'top' }}
            />
            {editMutation.isError ? <Text className="mt-2 text-sm text-red-500">保存失败，请检查网络后重试。</Text> : null}
            <View className="mt-4 flex-row justify-end gap-3">
              <Pressable onPress={() => { setEditTarget(null); setEditDraft(''); }} className="rounded-full px-4 py-2"><Text className="font-semibold text-neutral-600 dark:text-neutral-300">取消</Text></Pressable>
              <Pressable disabled={editMutation.isPending || !editDraft.trim() || editDraft.trim() === editTarget?.body} onPress={() => editMutation.mutate()} className="rounded-full bg-sky-500 px-5 py-2 disabled:opacity-50">
                {editMutation.isPending ? <ActivityIndicator size="small" color="#fff" /> : <Text className="font-semibold text-white">保存</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
