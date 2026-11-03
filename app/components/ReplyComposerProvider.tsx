import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Keyboard, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { useRouter } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { StyledExpoImage as Image } from '~/components/Image';
import { createComment } from '~/lib/comment-create-api';
import { createIdempotencyKey, getApiErrorMessage } from '~/lib/api-client';

export type ReplyComposerTarget = {
  contentId: string;
  parentId?: string | null;
  authorName: string;
  authorHandle: string;
  authorAvatar?: string | null;
  authorAvatarHeaders?: Record<string, string>;
  contentText: string;
  onSubmitted?: () => void;
};

type ReplyComposerContextValue = {
  openReplyComposer: (target: ReplyComposerTarget) => void;
};

const ReplyComposerContext = createContext<ReplyComposerContextValue | null>(null);

export function useReplyComposer(): ReplyComposerContextValue {
  const context = useContext(ReplyComposerContext);
  if (!context) {
    throw new Error('useReplyComposer must be used inside ReplyComposerProvider.');
  }
  return context;
}

export function ReplyComposerProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const foreground = isDark ? '#f9fafb' : '#0f1419';
  const muted = isDark ? '#9ca3af' : '#536471';
  const border = isDark ? '#303030' : '#e5e7eb';
  const surface = isDark ? '#111111' : '#ffffff';

  const sheetRef = useRef<BottomSheetModal>(null);
  const [target, setTarget] = useState<ReplyComposerTarget | null>(null);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const pendingSubmissionRef = useRef<{
    contentId: string;
    parentId: string | null;
    body: string;
    key: string;
  } | null>(null);
  const snapPoints = useMemo(() => ['68%'], []);

  const openReplyComposer = useCallback((nextTarget: ReplyComposerTarget) => {
    const contentId = nextTarget.contentId.trim();
    if (!contentId || submitting) return;
    pendingSubmissionRef.current = null;
    setTarget({ ...nextTarget, contentId });
    setDraft('');
    setMessage('');
    sheetRef.current?.present();
  }, [submitting]);

  const closeReplyComposer = useCallback(() => {
    if (submitting) return;
    Keyboard.dismiss();
    sheetRef.current?.dismiss();
  }, [submitting]);

  const submitReply = useCallback(async () => {
    const activeTarget = target;
    const body = draft.trim();
    if (!activeTarget || !body || submitting || body.length > 10000) return;

    setSubmitting(true);
    setMessage('');
    const parentId = activeTarget.parentId?.trim() || null;
    const existing = pendingSubmissionRef.current;
    const key = existing &&
      existing.contentId === activeTarget.contentId &&
      existing.parentId === parentId &&
      existing.body === body
      ? existing.key
      : createIdempotencyKey();
    pendingSubmissionRef.current = {
      contentId: activeTarget.contentId,
      parentId,
      body,
      key,
    };

    try {
      const result = await createComment<{ data?: unknown; error?: { message?: string } }>({
        contentId: activeTarget.contentId,
        body,
        parentId,
        idempotencyKey: key,
      });
      if (result.response.status === 401) {
        sheetRef.current?.dismiss();
        router.push('/login' as never);
        return;
      }
      if (!result.response.ok) {
        setMessage(getApiErrorMessage(
          result.data,
          'Could not publish your reply. Please retry.',
          result.response.status,
        ));
        return;
      }
      pendingSubmissionRef.current = null;
      setDraft('');
      activeTarget.onSubmitted?.();
      sheetRef.current?.dismiss();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Network error. Please retry.');
    } finally {
      setSubmitting(false);
    }
  }, [draft, router, submitting, target]);

  const handleDismiss = useCallback(() => {
    setTarget(null);
    setDraft('');
    setMessage('');
    pendingSubmissionRef.current = null;
  }, []);

  const backdropComponent = useCallback((props: BottomSheetBackdropProps) => (
    <BottomSheetBackdrop
      {...props}
      appearsOnIndex={0}
      disappearsOnIndex={-1}
      opacity={0.48}
      pressBehavior={submitting ? 'none' : 'close'}
    />
  ), [submitting]);

  const contextValue = useMemo(() => ({ openReplyComposer }), [openReplyComposer]);

  return (
    <ReplyComposerContext.Provider value={contextValue}>
      {children}
      <BottomSheetModal
        ref={sheetRef}
        index={0}
        snapPoints={snapPoints}
        enableDynamicSizing={false}
        enablePanDownToClose={!submitting}
        keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
        android_keyboardInputMode="adjustResize"
        backdropComponent={backdropComponent}
        onDismiss={handleDismiss}
        backgroundStyle={{
          backgroundColor: surface,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
        }}
        handleIndicatorStyle={{ backgroundColor: isDark ? '#575757' : '#c7cdd3', width: 42 }}
      >
        <BottomSheetView
          style={{
            flex: 1,
            paddingHorizontal: 18,
            paddingTop: 8,
            paddingBottom: Math.max(insets.bottom, 12),
            backgroundColor: surface,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 42 }}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close reply composer"
              disabled={submitting}
              onPress={closeReplyComposer}
              style={{ width: 42, height: 40, alignItems: 'flex-start', justifyContent: 'center' }}
            >
              <Feather name="x" size={23} color={foreground} />
            </TouchableOpacity>
            <Text style={{ color: foreground, fontSize: 17, fontWeight: '800' }}>Reply</Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Send reply"
              disabled={!draft.trim() || submitting}
              onPress={() => void submitReply()}
              style={{
                minWidth: 64,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 999,
                paddingHorizontal: 15,
                paddingVertical: 8,
                backgroundColor: draft.trim() && !submitting ? '#1d9bf0' : (isDark ? '#343434' : '#cbd5e1'),
              }}
            >
              <Text style={{ color: '#ffffff', fontSize: 14, fontWeight: '800' }}>
                {submitting ? 'Sending…' : 'Reply'}
              </Text>
            </TouchableOpacity>
          </View>

          {target ? (
            <>
              <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'flex-start' }}>
                {target.authorAvatar ? (
                  <Image
                    source={{ uri: target.authorAvatar, headers: target.authorAvatarHeaders }}
                    style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: isDark ? '#303030' : '#eef0f2' }}
                    contentFit="cover"
                  />
                ) : (
                  <View style={{
                    width: 42,
                    height: 42,
                    borderRadius: 21,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: isDark ? '#303030' : '#eef0f2',
                  }}>
                    <Feather name="user" size={20} color={muted} />
                  </View>
                )}
                <View style={{ flex: 1, marginLeft: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: border }}>
                  <Text style={{ color: muted, fontSize: 13, marginBottom: 5 }}>
                    Replying to @{target.authorHandle.replace(/^@/, '')}
                  </Text>
                  <Text numberOfLines={5} style={{ color: foreground, fontSize: 15, lineHeight: 21 }}>
                    {target.contentText || target.authorName}
                  </Text>
                </View>
              </View>

              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-start', marginTop: 16 }}>
                <View style={{
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: isDark ? '#303030' : '#eef0f2',
                }}>
                  <Feather name="user" size={19} color={muted} />
                </View>
                <BottomSheetTextInput
                  accessibilityLabel="Write your reply"
                  autoFocus
                  editable={!submitting}
                  multiline
                  maxLength={10000}
                  onChangeText={setDraft}
                  placeholder="Post your reply"
                  placeholderTextColor={muted}
                  scrollEnabled
                  style={{
                    flex: 1,
                    minHeight: 150,
                    maxHeight: 300,
                    marginLeft: 12,
                    paddingTop: 2,
                    paddingBottom: 12,
                    color: foreground,
                    fontSize: 17,
                    lineHeight: 24,
                    textAlignVertical: 'top',
                  }}
                  value={draft}
                />
              </View>

              {message ? (
                <Text accessibilityRole="alert" style={{ color: '#e5484d', fontSize: 13, marginTop: 6 }}>
                  {message}
                </Text>
              ) : null}
              <View style={{
                borderTopWidth: 1,
                borderTopColor: border,
                paddingTop: 11,
                flexDirection: 'row',
                justifyContent: 'flex-end',
              }}>
                <Text style={{ color: muted, fontSize: 12 }}>{draft.length}/10000</Text>
              </View>
            </>
          ) : null}
        </BottomSheetView>
      </BottomSheetModal>
    </ReplyComposerContext.Provider>
  );
}
