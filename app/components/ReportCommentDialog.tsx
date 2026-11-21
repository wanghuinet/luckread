import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { createIdempotencyKey } from '~/lib/api-client';
import {
  COMMENT_REPORT_REASONS,
  CommentReportApiError,
  reportComment,
  type CommentReportReason,
} from '~/lib/comment-report-api';

type Props = {
  commentId: string;
  onClose: () => void;
};

export default function ReportCommentDialog({ commentId, onClose }: Props) {
  const router = useRouter();
  const [reason, setReason] = useState<CommentReportReason>('ABUSE');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<'SUBMITTED' | 'DEDUPLICATED' | null>(null);
  const pendingRef = useRef<{ signature: string; key: string } | null>(null);

  const submit = async () => {
    if (submitting || result) return;
    const trimmedDescription = description.trim();
    const signature = JSON.stringify([reason, trimmedDescription]);
    const pending = pendingRef.current;
    const idempotencyKey = pending?.signature === signature
      ? pending.key
      : createIdempotencyKey();
    pendingRef.current = { signature, key: idempotencyKey };
    setSubmitting(true);
    setError('');

    try {
      const response = await reportComment({
        commentId,
        reasonCode: reason,
        description: trimmedDescription,
        idempotencyKey,
      });
      pendingRef.current = null;
      setResult(response.status);
    } catch (cause) {
      if (cause instanceof CommentReportApiError && cause.status === 401) {
        onClose();
        router.push('/login' as never);
        return;
      }
      setError(cause instanceof Error
        ? cause.message
        : 'Could not submit the report. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible
    >
      <View className="flex-1 justify-center bg-black/50 px-5">
        <View className="rounded-2xl bg-white p-5 dark:bg-neutral-950">
          <View className="mb-4 flex-row items-center justify-between">
            <Text className="text-lg font-bold text-black dark:text-white">
              {result ? 'Report status' : 'Report comment'}
            </Text>
            <TouchableOpacity
              accessibilityLabel="Close report dialog"
              accessibilityRole="button"
              disabled={submitting}
              onPress={onClose}
              className="h-9 w-9 items-center justify-center rounded-full"
            >
              <Feather name="x" size={20} color="#536471" />
            </TouchableOpacity>
          </View>

          {result ? (
            <View>
              <View className="mb-3 flex-row items-center">
                <Feather
                  name="check-circle"
                  size={20}
                  color="#16a34a"
                />
                <Text className="ml-2 flex-1 text-base text-black dark:text-white">
                  {result === 'DEDUPLICATED'
                    ? 'You have already reported this comment. Your previous report is recorded.'
                    : 'Your report has been submitted for review.'}
                </Text>
              </View>
              <TouchableOpacity
                accessibilityRole="button"
                className="mt-3 items-center rounded-full bg-sky-500 px-4 py-3"
                onPress={onClose}
              >
                <Text className="font-bold text-white">Done</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text className="mb-3 text-sm text-neutral-500 dark:text-neutral-400">
                Choose the reason that best describes this comment.
              </Text>
              <View className="gap-2">
                {COMMENT_REPORT_REASONS.map((item) => {
                  const selected = item.code === reason;
                  return (
                    <TouchableOpacity
                      key={item.code}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      onPress={() => setReason(item.code)}
                      className={selected
                        ? 'flex-row items-center rounded-xl border border-sky-500 bg-sky-500/10 px-3 py-3'
                        : 'flex-row items-center rounded-xl border border-neutral-200 px-3 py-3 dark:border-neutral-700'}
                    >
                      <Feather
                        name={selected ? 'check-circle' : 'circle'}
                        size={18}
                        color={selected ? '#1D9BF0' : '#8b98a5'}
                      />
                      <Text className="ml-3 flex-1 text-sm text-black dark:text-white">
                        {item.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TextInput
                accessibilityLabel="Additional report details"
                className="mt-4 min-h-20 rounded-xl border border-neutral-200 px-3 py-3 text-sm text-black dark:border-neutral-700 dark:text-white"
                editable={!submitting}
                maxLength={4000}
                multiline
                onChangeText={setDescription}
                placeholder="Additional details (optional)"
                placeholderTextColor="#8b98a5"
                textAlignVertical="top"
                value={description}
              />
              <Text className="mt-1 text-right text-xs text-neutral-500">
                {description.length}/4000
              </Text>

              {error ? (
                <Text accessibilityRole="alert" className="mt-3 text-sm text-red-500">
                  {error}
                </Text>
              ) : null}

              <View className="mt-4 flex-row gap-3">
                <TouchableOpacity
                  accessibilityRole="button"
                  className="flex-1 items-center rounded-full border border-neutral-300 px-4 py-3 dark:border-neutral-700"
                  disabled={submitting}
                  onPress={onClose}
                >
                  <Text className="font-bold text-black dark:text-white">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  className="flex-1 items-center rounded-full bg-sky-500 px-4 py-3"
                  disabled={submitting}
                  onPress={() => void submit()}
                >
                  {submitting ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Text className="font-bold text-white">Submit report</Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
