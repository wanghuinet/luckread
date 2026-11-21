import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  CONTENT_REPORT_REASONS,
  submitContentReport,
  type ContentReportReason,
} from '~/lib/report-api';

type ReportPostDialogProps = {
  visible: boolean;
  contentId?: string | null;
  onClose: () => void;
};

const reasonOptions: Array<{ value: ContentReportReason; label: string; hint: string }> = [
  { value: 'ABUSE', label: 'Abuse or harassment', hint: 'Threats, hateful behavior, or targeted harassment' },
  { value: 'SPAM', label: 'Spam or unwanted promotion', hint: 'Scams, repetitive posts, or unsolicited ads' },
  { value: 'IMPERSONATION', label: 'Impersonation', hint: 'Someone pretending to be another person or organization' },
  { value: 'COPYRIGHT', label: 'Copyright infringement', hint: 'Content that may infringe intellectual property' },
  { value: 'OTHER', label: 'Other', hint: 'Another issue that needs review' },
];

export default function ReportPostDialog({ visible, contentId, onClose }: ReportPostDialogProps) {
  const [reasonCode, setReasonCode] = useState<ContentReportReason>('SPAM');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const close = () => {
    if (submitting) return;
    setReasonCode('SPAM');
    setDescription('');
    onClose();
  };

  const submit = async () => {
    if (submitting) return;
    if (!contentId?.trim()) {
      Alert.alert('Cannot report post', 'This post is not connected to a valid LuckRead content ID.');
      return;
    }
    setSubmitting(true);
    const result = await submitContentReport(contentId, reasonCode, description);
    setSubmitting(false);
    if (!result.ok) {
      Alert.alert('Report failed', result.message || 'Could not submit this report. Please try again.');
      return;
    }

    const duplicate = result.deduplicated === true;
    setReasonCode('SPAM');
    setDescription('');
    onClose();
    Alert.alert(
      duplicate ? 'Already reported' : 'Report submitted',
      duplicate
        ? 'You have already reported this post. The existing report is retained for review.'
        : 'Thank you. Your report has been submitted for moderation review.',
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={close}
    >
      <View className="flex-1 justify-center bg-black/55 px-4 py-8">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close report dialog"
          disabled={submitting}
          onPress={close}
          className="absolute inset-0"
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="w-full self-center"
        >
          <View className="max-h-[90%] w-full rounded-2xl bg-white p-5 dark:bg-neutral-950" accessibilityViewIsModal>
            <View className="flex-row items-start justify-between">
              <View className="mr-4 flex-1">
                <Text className="text-xl font-bold text-neutral-900 dark:text-white">Report post</Text>
                <Text className="mt-2 text-sm leading-5 text-neutral-600 dark:text-neutral-300">
                  Choose the reason that best describes this post. Reports are reviewed under LuckRead's moderation process.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close report dialog"
                disabled={submitting}
                onPress={close}
                hitSlop={8}
                className="rounded-full p-2"
              >
                <Text className="text-xl text-neutral-500">×</Text>
              </Pressable>
            </View>

            <ScrollView className="mt-4 shrink" keyboardShouldPersistTaps="handled">
              {reasonOptions.filter((option) => CONTENT_REPORT_REASONS.includes(option.value)).map((option) => {
                const selected = reasonCode === option.value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    disabled={submitting}
                    onPress={() => setReasonCode(option.value)}
                    className="mb-2 flex-row items-center rounded-xl border border-neutral-200 px-3 py-3 dark:border-neutral-800"
                  >
                    <View className={'mr-3 h-5 w-5 items-center justify-center rounded-full border-2 ' + (selected ? 'border-sky-500' : 'border-neutral-400')}>
                      {selected ? <View className="h-2.5 w-2.5 rounded-full bg-sky-500" /> : null}
                    </View>
                    <View className="flex-1">
                      <Text className="font-semibold text-neutral-900 dark:text-white">{option.label}</Text>
                      <Text className="mt-1 text-xs leading-4 text-neutral-500 dark:text-neutral-400">{option.hint}</Text>
                    </View>
                  </Pressable>
                );
              })}

              <Text className="mb-2 mt-2 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
                Additional details (optional)
              </Text>
              <TextInput
                accessibilityLabel="Additional report details"
                value={description}
                onChangeText={setDescription}
                editable={!submitting}
                multiline
                maxLength={4000}
                textAlignVertical="top"
                placeholder="Describe the issue so the moderation team can review it."
                placeholderTextColor="#737373"
                className="min-h-24 rounded-xl border border-neutral-300 px-3 py-3 text-sm text-neutral-900 dark:border-neutral-700 dark:text-white"
              />
              <Text className="mt-1 self-end text-xs text-neutral-500">{description.length}/4000</Text>
            </ScrollView>

            <View className="mt-4 flex-row gap-3">
              <Pressable
                accessibilityRole="button"
                disabled={submitting}
                onPress={close}
                className="flex-1 items-center rounded-full border border-neutral-300 px-4 py-3 dark:border-neutral-700"
              >
                <Text className="font-semibold text-neutral-800 dark:text-neutral-100">Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={submitting || !contentId?.trim()}
                onPress={() => void submit()}
                className={'flex-1 flex-row items-center justify-center rounded-full px-4 py-3 ' + (submitting || !contentId?.trim() ? 'bg-sky-300' : 'bg-sky-500')}
              >
                {submitting ? <ActivityIndicator color="#ffffff" size="small" /> : null}
                <Text className="ml-2 font-bold text-white">{submitting ? 'Submitting…' : 'Submit report'}</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
