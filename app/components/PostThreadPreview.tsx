import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { apiRequest } from '~/lib/api-client';
import { readContentBody, unwrapApiData, type ApiContentRecord } from '~/lib/content-adapter';
import { useAuthStore } from '~/store/auth-store';

type ThreadItem = {
  id: string;
  position: number;
  state: 'DRAFT' | 'PUBLISHED';
  accessMode: 'PUBLIC';
  title: string;
  bodyRef: string;
  mediaRefs: string[];
  coverRef: string | null;
  createdAt: string;
};

type ThreadPayload = {
  rootContentId?: unknown;
  items?: ThreadItem[];
};

type ThreadPreviewState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'error' }
  | { status: 'ready'; rootContentId: string; items: Array<ThreadItem & { body: string }>; hiddenBefore: number; hiddenAfter: number };

const VISIBLE_THREAD_ITEMS = 5;

export default function PostThreadPreview({ contentId }: { contentId: string }) {
  const router = useRouter();
  const viewerId = useAuthStore((state) => state.user?.id ?? null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [state, setState] = useState<ThreadPreviewState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setState({ status: 'loading' });

    void (async () => {
      const result = await apiRequest<unknown>(
        '/contents/' + encodeURIComponent(contentId) + '/thread',
        { method: 'GET', signal: controller.signal, ...(viewerId ? { expectedAccountId: viewerId } : {}) },
      );
      if (!result.response.ok) throw new Error('Unable to load post thread.');
      const payload = unwrapApiData<ThreadPayload>(result.data);
      const allItems = Array.isArray(payload?.items) ? payload.items : [];
      if (
        typeof payload?.rootContentId !== 'string' ||
        allItems.length < 2 ||
        !allItems.some((item) => item?.id === contentId)
      ) {
        if (active) setState({ status: 'none' });
        return;
      }

      const ordered = [...allItems]
        .filter((item) =>
          typeof item?.id === 'string' &&
          Number.isSafeInteger(item.position) &&
          (item.state === 'PUBLISHED' || item.state === 'DRAFT') &&
          item.accessMode === 'PUBLIC' &&
          typeof item.bodyRef === 'string' &&
          Array.isArray(item.mediaRefs),
        )
        .sort((left, right) => left.position - right.position);
      const currentIndex = ordered.findIndex((item) => item.id === contentId);
      if (currentIndex < 0 || ordered.length < 2) {
        if (active) setState({ status: 'none' });
        return;
      }

      const start = Math.max(0, Math.min(currentIndex - 2, ordered.length - VISIBLE_THREAD_ITEMS));
      const visible = ordered.slice(start, start + VISIBLE_THREAD_ITEMS);
      const resolved = await Promise.all(visible.map(async (item) => {
        const record: ApiContentRecord = {
          id: item.id,
          contentType: 'post',
          state: item.state,
          accessMode: item.accessMode,
          title: item.title,
          bodyRef: item.bodyRef,
          mediaRefs: item.mediaRefs,
          coverRef: item.coverRef,
          createdAt: item.createdAt,
        };
        return { ...item, body: await readContentBody(record, controller.signal) };
      }));
      if (
        !active ||
        controller.signal.aborted ||
        (useAuthStore.getState().user?.id ?? null) !== viewerId
      ) return;
      setState({
        status: 'ready',
        rootContentId: payload.rootContentId,
        items: resolved,
        hiddenBefore: start,
        hiddenAfter: Math.max(0, ordered.length - start - visible.length),
      });
    })().catch(() => {
      if (
        active &&
        !controller.signal.aborted &&
        (useAuthStore.getState().user?.id ?? null) === viewerId
      ) setState({ status: 'error' });
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [contentId, retryNonce, viewerId]);

  if (state.status === 'none') return null;

  return (
    <View className="mt-3 overflow-hidden rounded-2xl border border-neutral-200 dark:border-neutral-700">
      {state.status === 'loading' ? (
        <View className="flex-row items-center gap-2 px-3 py-4">
          <ActivityIndicator size="small" />
          <Text className="text-xs text-neutral-500">正在加载串文…</Text>
        </View>
      ) : state.status === 'error' ? (
        <View className="flex-row items-center justify-between gap-3 px-3 py-3">
          <Text className="flex-1 text-xs text-neutral-500">串文暂时无法显示</Text>
          <Pressable accessibilityRole="button" onPress={() => setRetryNonce((value) => value + 1)}>
            <Text className="text-xs font-semibold text-sky-600">重试</Text>
          </Pressable>
        </View>
      ) : (
        <View className="px-3 py-3">
          <Text className="mb-2 text-xs font-semibold text-neutral-500">
            串文 · {state.items.length + state.hiddenBefore + state.hiddenAfter} 条动态
          </Text>
          {state.hiddenBefore > 0 ? (
            <Text className="mb-2 text-xs text-neutral-500">还有前面的 {state.hiddenBefore} 条动态</Text>
          ) : null}
          {state.items.map((item, index) => {
            const isCurrent = item.id === contentId;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="link"
                accessibilityLabel={isCurrent ? '当前动态' : '打开串文中的动态'}
                disabled={isCurrent}
                onPress={() => router.push(('/post/' + encodeURIComponent(item.id)) as never)}
                className={'border-l-2 py-2 pl-3 ' + (isCurrent ? 'border-sky-500' : 'border-neutral-200 dark:border-neutral-700')}
              >
                <Text className="mb-1 text-xs font-semibold text-neutral-500">
                  {item.position + 1}{isCurrent ? ' · 当前动态' : ''}
                </Text>
                <Text numberOfLines={5} className="text-sm leading-5 text-neutral-800 dark:text-neutral-200">
                  {item.body || item.title || '（无文字内容）'}
                </Text>
              </Pressable>
            );
          })}
          {state.hiddenAfter > 0 ? (
            <Text className="mt-2 text-xs text-neutral-500">还有后面的 {state.hiddenAfter} 条动态</Text>
          ) : null}
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push(('/post/' + encodeURIComponent(state.rootContentId)) as never)}
            className="mt-2 self-start"
          >
            <Text className="text-xs font-semibold text-sky-600">打开串文起始动态</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
