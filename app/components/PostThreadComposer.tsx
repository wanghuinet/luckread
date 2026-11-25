import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { apiRequest, createIdempotencyKey, type ApiRequestOptions } from '~/lib/api-client';
import { useAuthStore } from '~/store/auth-store';
import { apiFailureDiagnostic, uploadTextBody } from '~/lib/publish-api';

type ThreadDraft = {
  key: string;
  body: string;
  bodyRef?: string;
  contentId?: string;
  etag?: string;
  published?: boolean;
  linked?: boolean;
  createKey: string;
  stateKey: string;
  linkKey: string;
};

type ContentEnvelope = {
  data?: Record<string, unknown>;
  id?: string;
  etag?: string;
  state?: string;
};

const MAX_ITEMS = 5;
const MAX_TEXT = 500;
const PRIMARY = '#1769aa';

function unwrap(value: unknown): ContentEnvelope | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const root = value as ContentEnvelope;
  const nested = root.data && typeof root.data === 'object' ? root.data as ContentEnvelope : root;
  return typeof nested.id === 'string' ? nested : null;
}

function createItem(body = ''): ThreadDraft {
  return {
    key: createIdempotencyKey(),
    body,
    createKey: createIdempotencyKey(),
    stateKey: createIdempotencyKey(),
    linkKey: createIdempotencyKey(),
  };
}

export default function PostThreadComposer({
  visible,
  initialText,
  onClose,
  onComplete,
}: {
  visible: boolean;
  initialText: string;
  onClose: () => void;
  onComplete: (firstContentId: string) => void;
}) {
  const [items, setItems] = useState<ThreadDraft[]>(() => [createItem(initialText), createItem()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const viewerId = useAuthStore((state) => state.user?.id ?? null);
  const itemsRef = useRef(items);
  const startedRef = useRef(false);
  const previousViewerIdRef = useRef(viewerId);

  const updateItems = (next: ThreadDraft[]) => {
    itemsRef.current = next;
    setItems(next);
  };

  useEffect(() => {
    if (previousViewerIdRef.current === viewerId) return;
    previousViewerIdRef.current = viewerId;
    startedRef.current = false;
    updateItems([createItem(initialText), createItem()]);
    setBusy(false);
    setError('');
    setProgress('');
  }, [initialText, viewerId]);

  const updateBody = (index: number, body: string) => {
    updateItems(itemsRef.current.map((item, itemIndex) => itemIndex === index ? { ...item, body } : item));
    setError('');
  };

  const submit = async () => {
    if (!viewerId) {
      setError('请先登录后再发布线程。');
      return;
    }
    const assertCurrentViewer = () => {
      if (useAuthStore.getState().user?.id !== viewerId) {
        throw new Error('Your account changed. Reopen the composer and try again.');
      }
    };
    const requestAsViewer = async <T,>(path: string, options: ApiRequestOptions = {}) => {
      const result = await apiRequest<T>(path, { ...options, expectedAccountId: viewerId });
      assertCurrentViewer();
      return result;
    };
    const working = itemsRef.current.map(item => ({ ...item }));
    if (working.length < 2 || working.length > MAX_ITEMS ||
        working.some(item => !item.body.trim() || item.body.trim().length > MAX_TEXT)) {
      setError('线程需要 2–5 条非空帖子，每条最多 500 个字符。');
      return;
    }
    if (working.some(item => item.contentId) || startedRef.current) {
      // Once the first server mutation begins, freeze the payload and reuse every
      // idempotency key on retry. This prevents duplicate posts after uncertain results.
      startedRef.current = true;
    }
    setBusy(true);
    setError('');
    try {
      startedRef.current = true;
      for (let index = 0; index < working.length; index += 1) {
        const item = working[index];
        const body = item.body.trim();
        if (!item.bodyRef) {
          const uploaded = await uploadTextBody(body, item.key, viewerId);
          assertCurrentViewer();
          item.bodyRef = uploaded.url;
          updateItems(working);
        }
        if (!item.contentId) {
          const created = await requestAsViewer<unknown>('/contents', {
            method: 'POST',
            body: JSON.stringify({
              contentType: 'post',
              title: body,
              bodyRef: item.bodyRef,
              mediaRefs: [],
              coverRef: null,
            }),
            idempotencyKey: item.createKey,
          });
          if (!created.response.ok) throw new Error(apiFailureDiagnostic(created, '无法创建线程帖子。'));
          const record = unwrap(created.data);
          if (!record?.id) throw new Error('服务端未返回帖子 ID。请重试以安全完成同一条请求。');
          item.contentId = record.id;
          item.etag = record.etag || created.response.headers.get('ETag') || undefined;
          updateItems(working);
        }
        if (!item.published) {
          if (!item.etag || item.etag === '*') {
            const detail = await requestAsViewer<unknown>('/contents/' + encodeURIComponent(item.contentId), { method: 'GET' });
            if (detail.response.ok) {
              const record = unwrap(detail.data);
              item.etag = record?.etag || detail.response.headers.get('ETag') || undefined;
            }
          }
          if (!item.etag || item.etag === '*') throw new Error('帖子已创建，但缺少版本号。重试会继续使用原帖子，不会重复创建。');
          const transitioned = await requestAsViewer<unknown>(
            '/contents/' + encodeURIComponent(item.contentId) + '/state',
            {
              method: 'POST',
              headers: { 'If-Match': item.etag },
              body: JSON.stringify({
                to: 'PUBLISHED',
                preflight: {
                  contentType: 'post',
                  title: body,
                  body,
                  mediaRefs: [],
                  coverRef: null,
                },
              }),
              idempotencyKey: item.stateKey,
            },
          );
          if (!transitioned.response.ok) throw new Error(apiFailureDiagnostic(transitioned, '帖子已创建，但发布失败。点击重试继续完成。'));
          item.published = true;
          updateItems(working);
        }
        setProgress('已发布 ' + (index + 1) + '/' + working.length + ' 条帖子');
      }

      for (let index = 0; index < working.length - 1; index += 1) {
        const item = working[index];
        const next = working[index + 1];
        if (item.linked) continue;
        const linked = await requestAsViewer<unknown>(
          '/contents/' + encodeURIComponent(item.contentId as string) + '/thread',
          {
            method: 'POST',
            body: JSON.stringify({ nextContentId: next.contentId }),
            idempotencyKey: item.linkKey,
          },
        );
        if (!linked.response.ok) throw new Error(apiFailureDiagnostic(linked, '帖子已发布，但线程关系未全部保存。重试可继续串联，不会重新发布帖子。'));
        item.linked = true;
        updateItems(working);
      }

      onComplete(working[0].contentId as string);
    } catch (cause) {
      if (useAuthStore.getState().user?.id === viewerId) {
        setError(cause instanceof Error ? cause.message : '线程发布失败，请重试。');
      }
    } finally {
      if (useAuthStore.getState().user?.id === viewerId) setBusy(false);
    }
  };

  const canClose = !startedRef.current && !items.some(item => item.contentId);
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { if (canClose) onClose(); }}>
      <View style={{ flex: 1, backgroundColor: '#ffffff', paddingTop: 18 }}>
        <View style={{ paddingHorizontal: 18, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#e4e7ec' }}>
          <Pressable accessibilityRole="button" disabled={!canClose || busy} onPress={onClose} style={{ padding: 8, opacity: canClose ? 1 : 0.35 }}>
            <Feather name="x" size={22} color="#344054" />
          </Pressable>
          <Text style={{ fontSize: 17, fontWeight: '700', color: '#101828' }}>连续发布线程</Text>
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => { void submit(); }} style={{ backgroundColor: PRIMARY, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 9, opacity: busy ? 0.6 : 1 }}>
            {busy ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={{ color: '#ffffff', fontWeight: '700' }}>发布</Text>}
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 36 }} keyboardShouldPersistTaps="handled">
          <Text style={{ color: '#667085', fontSize: 13, lineHeight: 19, marginBottom: 14 }}>
            每条帖子独立发布，再按顺序连接成一个线程。首版支持纯文本和立即发布；每条最多 500 字。
          </Text>
          {items.map((item, index) => (
            <View key={item.key} style={{ borderWidth: 1, borderColor: '#e4e7ec', borderRadius: 14, padding: 12, marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text style={{ color: '#344054', fontWeight: '700' }}>第 {index + 1} 条</Text>
                <Text style={{ color: '#98a2b3', fontSize: 12 }}>{item.body.length}/{MAX_TEXT}</Text>
              </View>
              <TextInput
                accessibilityLabel={'Thread post ' + (index + 1)}
                multiline
                maxLength={MAX_TEXT}
                editable={!busy && !startedRef.current}
                value={item.body}
                onChangeText={value => updateBody(index, value)}
                placeholder="继续写下一条…"
                placeholderTextColor="#98a2b3"
                textAlignVertical="top"
                style={{ minHeight: 104, color: '#101828', fontSize: 16, lineHeight: 23 }}
              />
              {items.length > 2 && !startedRef.current ? (
                <Pressable accessibilityRole="button" onPress={() => updateItems(itemsRef.current.filter((_, itemIndex) => itemIndex !== index))} style={{ alignSelf: 'flex-end', padding: 6 }}>
                  <Text style={{ color: '#b42318', fontSize: 13 }}>删除</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
          {items.length < MAX_ITEMS && !startedRef.current ? (
            <Pressable accessibilityRole="button" onPress={() => updateItems([...itemsRef.current, createItem()])} style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: '#98a2b3', borderRadius: 12, padding: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
              <Feather name="plus" size={17} color={PRIMARY} />
              <Text style={{ color: PRIMARY, fontWeight: '600' }}>添加下一条</Text>
            </Pressable>
          ) : null}
          {progress ? <Text accessibilityLiveRegion="polite" style={{ color: '#027a48', marginTop: 14 }}>{progress}</Text> : null}
          {error ? <Text accessibilityLiveRegion="assertive" style={{ color: '#b42318', marginTop: 14, lineHeight: 20 }}>{error}</Text> : null}
          {startedRef.current ? <Text style={{ color: '#667085', fontSize: 12, marginTop: 12 }}>为防止重复发布，提交开始后内容和条目数量已锁定。遇到失败请点击发布重试。</Text> : null}
        </ScrollView>
      </View>
    </Modal>
  );
}
