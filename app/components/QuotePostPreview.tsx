import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { apiRequest } from '~/lib/api-client';
import { mapContentToFeedContent, readContentBody, unwrapApiData, type ApiContentRecord } from '~/lib/content-adapter';
import type { FeedContent } from './FeedItem';

type RelationshipPage = {
  items?: Array<{
    relationType?: unknown;
    direction?: unknown;
    relatedContent?: { id?: unknown } | null;
  }>;
};

type QuotePreviewState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'error' }
  | { status: 'ready'; content: FeedContent; contentId: string };

export default function QuotePostPreview({ contentId }: { contentId: string }) {
  const router = useRouter();
  const [retryNonce, setRetryNonce] = useState(0);
  const [state, setState] = useState<QuotePreviewState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setState({ status: 'loading' });

    void (async () => {
      const relationshipResult = await apiRequest<unknown>(
        '/contents/' + encodeURIComponent(contentId) + '/relationships?direction=out&limit=20',
        { method: 'GET', signal: controller.signal },
      );
      if (!relationshipResult.response.ok) throw new Error('Unable to load quote relationship.');
      const relationshipPage = unwrapApiData<RelationshipPage>(relationshipResult.data);
      const quoteRelationship = relationshipPage?.items?.find((item) =>
        item.relationType === 'quote-post' && item.direction === 'out',
      );
      const targetId = quoteRelationship?.relatedContent?.id;
      if (typeof targetId !== 'string' || !targetId.trim()) {
        if (active) setState({ status: 'none' });
        return;
      }

      const targetResult = await apiRequest<unknown>(
        '/contents/' + encodeURIComponent(targetId) ,
        { method: 'GET', signal: controller.signal },
      );
      if (!targetResult.response.ok) throw new Error('Unable to load quoted post.');
      const target = unwrapApiData<ApiContentRecord>(targetResult.data);
      if (
        !target ||
        target.id !== targetId ||
        target.contentType !== 'post' ||
        target.state !== 'PUBLISHED' ||
        target.accessMode !== 'PUBLIC'
      ) {
        if (active) setState({ status: 'none' });
        return;
      }

      const bodyText = await readContentBody(target, controller.signal);
      if (!active || controller.signal.aborted) return;
      setState({
        status: 'ready',
        contentId: target.id,
        content: mapContentToFeedContent(target, bodyText),
      });
    })().catch(() => {
      if (active && !controller.signal.aborted) setState({ status: 'error' });
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [contentId, retryNonce]);

  if (state.status === 'none') return null;

  return (
    <View className="mt-3 overflow-hidden rounded-2xl border border-neutral-200 dark:border-neutral-700">
      {state.status === 'loading' ? (
        <View className="flex-row items-center gap-2 px-3 py-4">
          <ActivityIndicator size="small" />
          <Text className="text-xs text-neutral-500">正在加载引用原帖…</Text>
        </View>
      ) : state.status === 'error' ? (
        <View className="flex-row items-center justify-between gap-3 px-3 py-3">
          <Text className="flex-1 text-xs text-neutral-500">引用原帖暂时无法显示</Text>
          <Pressable accessibilityRole="button" onPress={() => setRetryNonce((value) => value + 1)}>
            <Text className="text-xs font-semibold text-sky-600">重试</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="打开引用的原帖"
          onPress={() => router.push(('/post/' + encodeURIComponent(state.contentId)) as never)}
          className="px-3 py-3"
        >
          <Text className="mb-2 text-xs font-semibold text-neutral-500">引用原帖</Text>
          <Text className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
            {state.content.authorName || 'LuckRead 用户'} {state.content.authorHandle ? '@' + state.content.authorHandle : ''}
          </Text>
          <Text numberOfLines={5} className="mt-1 text-sm leading-5 text-neutral-700 dark:text-neutral-300">
            {state.content.message}
          </Text>
          <Text className="mt-2 text-xs text-sky-600">查看原帖</Text>
        </Pressable>
      )}
    </View>
  );
}
