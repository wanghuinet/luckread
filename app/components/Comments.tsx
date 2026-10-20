import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyledExpoImage as Image } from '~/components/Image';

import { apiRequest, getApiErrorMessage } from '~/lib/api-client';
import { resolveNativeMediaSource, unwrapApiData } from '~/lib/content-adapter';
import { readSessionToken } from '~/lib/secure-session';

type ApiComment = {
  id: string;
  contentId: string;
  authorUserId: string;
  parentId: string | null;
  body: string;
  state?: 'PENDING' | 'PUBLISHED' | 'REJECTED' | string;
  depth?: number;
  createdAt: string;
  updatedAt?: string;
};

type CommentPage = {
  items: ApiComment[];
  nextCursor?: string | null;
  hasMore?: boolean;
};

type CommentPageResponse = {
  data?: CommentPage;
  error?: { code?: string; message?: string };
};

type PublicUser = {
  id: string;
  username?: string;
  displayName?: string | null;
  avatar?: string | null;
  avatarHeaders?: Record<string, string>;
};

type PublicUserResponse = PublicUser & {
  data?: PublicUser;
  error?: { message?: string };
};

type CommentsProps = {
  contentId: string;
};

const createIdempotencyKey = (contentId: string) =>
  'native-comment:' +
  contentId +
  ':' +
  Date.now().toString(36) +
  ':' +
  Math.random().toString(36).slice(2, 14);

const formatDate = (value: string): string => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleString()
    : '';
};

export default function Comments({ contentId }: CommentsProps) {
  const router = useRouter();
  const [comments, setComments] = useState<ApiComment[]>([]);
  const [profiles, setProfiles] = useState<Record<string, PublicUser>>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [body, setBody] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const requestIdRef = useRef(0);
  const pendingSubmissionRef = useRef<{
    body: string;
    parentId: string | null;
    key: string;
  } | null>(null);
  const inputRef = useRef<TextInput | null>(null);

  const loadComments = useCallback(async (nextCursor: string | null = null) => {
    const requestId = ++requestIdRef.current;
    if (nextCursor) setLoadingMore(true);
    else setLoading(true);
    setMessage('');

    try {
      const params = new URLSearchParams({ limit: '50' });
      if (nextCursor) params.set('cursor', nextCursor);
      const { response, data } = await apiRequest<CommentPageResponse>(
        '/contents/' + encodeURIComponent(contentId) + '/comments?' + params.toString(),
        { method: 'GET' },
      );
      const page = unwrapApiData<CommentPage>(data);
      if (!response.ok || !page || !Array.isArray(page.items)) {
        throw new Error(getApiErrorMessage(data, 'Could not load comments. Please retry.'));
      }
      if (requestId !== requestIdRef.current) return;
      setComments((current) => {
        if (!nextCursor) return page.items;
        const known = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !known.has(item.id))];
      });
      setCursor(page.nextCursor || null);
      setHasMore(page.hasMore === true);
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setMessage(error instanceof Error ? error.message : 'Could not load comments. Please retry.');
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
      }
    }
  }, [contentId]);

  useEffect(() => {
    void loadComments();
    return () => {
      requestIdRef.current += 1;
    };
  }, [loadComments]);

  useEffect(() => {
    let active = true;
    const authorIds = Array.from(new Set(comments.map((comment) => comment.authorUserId).filter(Boolean)));
    if (authorIds.length === 0) return () => { active = false; };

    void (async () => {
      const sessionToken = await readSessionToken().catch(() => null);
      const results = await Promise.all(authorIds.map(async (authorId) => {
        try {
          const { response, data } = await apiRequest<PublicUserResponse>(
            '/users/' + encodeURIComponent(authorId),
            { method: 'GET' },
          );
          const profile = unwrapApiData<PublicUser>(data);
          if (!response.ok || !profile || typeof profile.id !== 'string') return null;
          const avatar = resolveNativeMediaSource(profile.avatar, sessionToken);
          return [authorId, {
            ...profile,
            avatar: avatar?.uri ?? null,
            avatarHeaders: avatar?.headers,
          }] as const;
        } catch {
          return null;
        }
      }));
      if (!active) return;
      const next: Record<string, PublicUser> = {};
      for (const result of results) {
        if (result) next[result[0]] = result[1];
      }
      if (Object.keys(next).length > 0) setProfiles((current) => ({ ...current, ...next }));
    })();

    return () => { active = false; };
  }, [comments]);

  const refreshComments = useCallback(() => {
    setRefreshing(true);
    void loadComments();
  }, [loadComments]);

  const submitComment = useCallback(async () => {
    const trimmed = body.trim();
    if (!trimmed || submitting || trimmed.length > 10000) return;
    setSubmitting(true);
    setMessage('');

    const existing = pendingSubmissionRef.current;
    const key = existing && existing.body === trimmed && existing.parentId === replyingTo
      ? existing.key
      : createIdempotencyKey(contentId);
    pendingSubmissionRef.current = { body: trimmed, parentId: replyingTo, key };

    try {
      const { response, data } = await apiRequest<{ data?: ApiComment; error?: { message?: string } }>(
        '/contents/' + encodeURIComponent(contentId) + '/comments',
        {
          method: 'POST',
          headers: { 'Idempotency-Key': key },
          body: JSON.stringify({ body: trimmed, parentId: replyingTo }),
        },
      );

      if (response.status === 401) {
        router.push('/login' as never);
        return;
      }
      if (!response.ok) {
        setMessage(getApiErrorMessage(data, 'Could not publish your reply. Please retry.'));
        return;
      }

      // Re-read W05's authoritative page instead of retaining an optimistic,
      // local-only comment. The same content ID is used for GET and POST.
      pendingSubmissionRef.current = null;
      setBody('');
      setReplyingTo(null);
      await loadComments();
    } catch (error) {
      // Retain the same idempotency key for a retry of the identical draft.
      setMessage(error instanceof Error ? error.message : 'Network error. Please retry.');
    } finally {
      setSubmitting(false);
    }
  }, [body, contentId, loadComments, replyingTo, router, submitting]);

  const beginReply = useCallback((comment: ApiComment) => {
    setReplyingTo(comment.id);
    setMessage('');
    inputRef.current?.focus();
  }, []);

  return (
    <View className="mt-3 border-t border-neutral-200 dark:border-neutral-800 px-3 pb-5">
      <View className="flex-row items-center justify-between py-3">
        <Text className="text-lg font-extrabold text-black dark:text-white">Replies</Text>
        <TouchableOpacity accessibilityRole="button" onPress={refreshComments} disabled={refreshing || loading}>
          <Feather name="refresh-cw" size={17} color="#536471" />
        </TouchableOpacity>
      </View>

      <View className="rounded-2xl border border-neutral-200 dark:border-neutral-700 p-3">
        {replyingTo ? (
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="text-sm text-neutral-500">Replying to a comment</Text>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => setReplyingTo(null)}
              disabled={submitting}
            >
              <Text className="text-sm font-semibold text-sky-500">Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        <TextInput
          ref={inputRef}
          accessibilityLabel={replyingTo ? 'Write a reply' : 'Write a comment'}
          className="min-h-20 text-base text-black dark:text-white"
          maxLength={10000}
          multiline
          onChangeText={setBody}
          placeholder={replyingTo ? 'Write your reply…' : 'Post your reply'}
          placeholderTextColor="#8b98a5"
          textAlignVertical="top"
          value={body}
        />
        <View className="mt-2 flex-row items-center justify-between">
          <Text className="text-xs text-neutral-500">{body.length}/10000</Text>
          <TouchableOpacity
            accessibilityRole="button"
            className={`rounded-full px-4 py-2 ${body.trim() && !submitting ? 'bg-sky-500' : 'bg-neutral-300 dark:bg-neutral-700'}`}
            disabled={!body.trim() || submitting}
            onPress={() => void submitComment()}
          >
            <Text className="font-bold text-white">{submitting ? 'Sending…' : replyingTo ? 'Reply' : 'Post'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {message ? (
        <View className="mt-3">
          <Text accessibilityRole="alert" className="text-sm text-rose-600">{message}</Text>
          {!loading && comments.length === 0 ? (
            <TouchableOpacity className="mt-2 self-start" onPress={() => void loadComments()}>
              <Text className="font-semibold text-sky-500">Retry</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {loading && comments.length === 0 ? (
        <View className="items-center py-6">
          <ActivityIndicator color="#1d9bf0" />
          <Text className="mt-2 text-sm text-neutral-500">Loading replies…</Text>
        </View>
      ) : null}

      {!loading && !message && comments.length === 0 ? (
        <Text className="py-5 text-center text-sm text-neutral-500">No replies yet.</Text>
      ) : null}

      {comments.map((comment) => {
        const author = profiles[comment.authorUserId];
        const authorName = author?.displayName?.trim() || author?.username || 'LuckRead member';
        const authorHandle = author?.username || comment.authorUserId;
        const createdAt = formatDate(comment.createdAt);
        const nestingLevel = Math.min(Math.max(comment.depth ?? (comment.parentId ? 1 : 0), 0), 3);
        return (
          <View
            key={comment.id}
            className="border-b border-neutral-100 dark:border-neutral-800 py-3"
            style={{ marginLeft: nestingLevel * 14 }}
          >
            <View className="flex-row items-start">
              <TouchableOpacity
                accessibilityRole="button"
                className="mr-2 h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700"
                onPress={() => router.push(('/profile/' + encodeURIComponent(author?.username || comment.authorUserId)) as never)}
              >
                {author?.avatar ? (
                  <Image source={{ uri: author.avatar, headers: author.avatarHeaders }} className="h-9 w-9 rounded-full" contentFit="cover" />
                ) : (
                  <Feather name="user" size={18} color="#536471" />
                )}
              </TouchableOpacity>
              <View className="min-w-0 flex-1">
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => router.push(('/profile/' + encodeURIComponent(author?.username || comment.authorUserId)) as never)}
                >
                  <Text className="text-sm font-bold text-black dark:text-white">
                    {authorName} <Text className="font-normal text-neutral-500">@{authorHandle}</Text>
                  </Text>
                </TouchableOpacity>
                <Text className="mt-0.5 text-xs text-neutral-500">{createdAt}</Text>
                <Text className="mt-2 text-base leading-6 text-black dark:text-white">{comment.body}</Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  className="mt-2 self-start"
                  onPress={() => beginReply(comment)}
                >
                  <Text className="text-sm font-semibold text-neutral-500">Reply</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        );
      })}

      {hasMore && cursor ? (
        <TouchableOpacity
          accessibilityRole="button"
          className="items-center py-4"
          disabled={loadingMore}
          onPress={() => void loadComments(cursor)}
        >
          {loadingMore ? <ActivityIndicator color="#1d9bf0" /> : <Text className="font-semibold text-sky-500">Load more replies</Text>}
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
