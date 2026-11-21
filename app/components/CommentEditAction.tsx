import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { createIdempotencyKey } from '~/lib/api-client';
import { CommentEditApiError, updateComment } from '~/lib/comment-edit-api';
import { useAuthStore } from '~/store/auth-store';

type EditableComment = {
  id: string;
  authorUserId: string;
  body: string;
  updatedAt?: string;
};

type CommentEditActionProps = {
  comment: EditableComment;
  onSaved: () => Promise<void> | void;
};

type PendingEdit = {
  commentId: string;
  body: string;
  updatedAt: string;
  key: string;
};

export default function CommentEditAction({ comment, onSaved }: CommentEditActionProps) {
  const router = useRouter();
  const currentUserId = useAuthStore((state) => state.user?.id ?? null);
  const [visible, setVisible] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const pendingEditRef = useRef<PendingEdit | null>(null);

  if (!currentUserId || comment.authorUserId !== currentUserId) return null;

  const openEditor = () => {
    setDraft(comment.body);
    setMessage('');
    setVisible(true);
  };

  const closeEditor = () => {
    if (saving) return;
    setVisible(false);
    setMessage('');
  };

  const saveEdit = async () => {
    const normalizedBody = draft.trim();
    const version = comment.updatedAt?.trim() || '';
    if (saving || !normalizedBody || normalizedBody.length > 10000) return;
    if (!version) {
      setMessage('The current comment version is unavailable. Refresh replies and try again.');
      return;
    }
    if (normalizedBody === comment.body.trim()) {
      setVisible(false);
      setMessage('');
      return;
    }

    setSaving(true);
    setMessage('');
    const pending = pendingEditRef.current;
    const key = pending &&
      pending.commentId === comment.id &&
      pending.body === normalizedBody &&
      pending.updatedAt === version
      ? pending.key
      : createIdempotencyKey();
    pendingEditRef.current = {
      commentId: comment.id,
      body: normalizedBody,
      updatedAt: version,
      key,
    };

    try {
      await updateComment(comment.id, normalizedBody, version, key);
      pendingEditRef.current = null;
      setVisible(false);
      setDraft('');
      await onSaved();
    } catch (cause) {
      if (cause instanceof CommentEditApiError && cause.status === 401) {
        router.push('/login' as never);
        return;
      }
      if (
        cause instanceof CommentEditApiError &&
        typeof cause.status === 'number' &&
        cause.status >= 400 &&
        cause.status < 500 &&
        cause.status !== 408 &&
        cause.status !== 429
      ) {
        pendingEditRef.current = null;
      }
      setMessage(
        cause instanceof CommentEditApiError && cause.status === 412
          ? 'This comment changed elsewhere. Close this editor, refresh replies, and try again.'
          : cause instanceof Error
            ? cause.message
            : 'Could not update this comment. Please retry.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Edit your comment"
        className="mt-2 self-start"
        onPress={openEditor}
      >
        <Text className="text-sm font-semibold text-sky-500">Edit</Text>
      </TouchableOpacity>
      <Modal
        animationType="slide"
        onRequestClose={closeEditor}
        transparent
        visible={visible}
      >
        <View className="flex-1 justify-center bg-black/50 px-5">
          <View className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-700 dark:bg-neutral-900">
            <Text className="text-lg font-extrabold text-black dark:text-white">Edit comment</Text>
            <TextInput
              accessibilityLabel="Edit comment text"
              className="mt-4 min-h-28 rounded-xl border border-neutral-200 p-3 text-base leading-6 text-black dark:border-neutral-700 dark:text-white"
              editable={!saving}
              maxLength={10000}
              multiline
              onChangeText={setDraft}
              placeholder="Write your comment…"
              placeholderTextColor="#8b98a5"
              textAlignVertical="top"
              value={draft}
            />
            <Text className="mt-1 text-xs text-neutral-500">{draft.length}/10000</Text>
            {message ? (
              <Text accessibilityRole="alert" className="mt-3 text-sm text-rose-600">{message}</Text>
            ) : null}
            <View className="mt-5 flex-row items-center justify-end gap-3">
              <TouchableOpacity
                accessibilityRole="button"
                className="rounded-full px-4 py-2"
                disabled={saving}
                onPress={closeEditor}
              >
                <Text className="font-semibold text-neutral-600 dark:text-neutral-300">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                className={`flex-row items-center rounded-full px-4 py-2 ${normalizedDraftCanSave(draft, comment.body, saving) ? 'bg-sky-500' : 'bg-neutral-300 dark:bg-neutral-700'}`}
                disabled={!normalizedDraftCanSave(draft, comment.body, saving)}
                onPress={() => void saveEdit()}
              >
                {saving ? <ActivityIndicator color="#ffffff" size="small" /> : null}
                <Text className="ml-1 font-bold text-white">{saving ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function normalizedDraftCanSave(draft: string, original: string, saving: boolean): boolean {
  const normalized = draft.trim();
  return !saving && normalized.length > 0 && normalized.length <= 10000 && normalized !== original.trim();
}
