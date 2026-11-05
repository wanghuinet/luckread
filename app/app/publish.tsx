import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useNavigation, usePreventRemove, type NavigationAction } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import DateTimePicker from '@expo/ui/community/datetime-picker';
import * as ImagePicker from 'expo-image-picker';
import CameraCaptureModal, { type CapturedCameraPhoto } from '~/components/CameraCaptureModal';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useColorScheme } from 'nativewind';
import { KeyboardAwareScrollView, KeyboardProvider } from 'react-native-keyboard-controller';
import Sortable from 'react-native-sortables';
import PublishMediaActionSheet from '~/components/PublishMediaActionSheet';

import { apiRequest, createIdempotencyKey, fetchContentBodyReference } from '~/lib/api-client';
import { computeAutoSaveDelay, createPublishDraftFingerprint, createReplyAudienceFingerprint } from '~/lib/publish-draft-autosave';
import { getDefaultScheduledPublishDate, MIN_SCHEDULE_LEAD_TIME_MS, toScheduledPublishISO } from '~/lib/publish-schedule';
import { DEFAULT_POLL_DURATION_MINUTES, getPollDurationMinutes, getPollDurationParts, type PollDurationParts } from '~/lib/poll-duration';
import {
  apiFailureDiagnostic,
  getMediaPlayback,
  getOwnedMediaMetadata,
  uploadMediaFile,
  uploadTextBody,
  type LocalMediaFile,
  type UploadedMedia,
} from '~/lib/publish-api';
import { prepareImageForUpload } from '~/lib/image-upload-preparation';
import { useAuthStore } from '~/store/auth-store';
import {
  deleteOwnPostDraft,
  fetchDiscoveryTopics,
  fetchOwnPostDraftsPage,
  fetchOwnScheduledPostsPage,
  findPublicUserByUsername,
  fetchOwnPostReplyAudience,
  saveOwnPostReplyAudience,
  isNativeReplyAudience,
  transitionOwnScheduledPostState,
  type NativeReplyAudience,
  type NativePostDraft,
  type NativeScheduledPost,
} from '~/lib/social-screen-api';
import {
  findActiveComposerToken,
  replaceActiveComposerToken,
} from '~/lib/publish-composer-tokens';
import { moveComposerAsset } from '~/lib/publish-composer-assets';
import {
  bindPendingMediaRecoveryToDraft,
  deletePendingMediaRecovery,
  deletePendingMediaRecoveryForDraft,
  listPendingMediaRecovery,
  persistPendingMediaRecovery,
} from '~/lib/publish-pending-media-recovery';

type ContentRecord = {
  id: string;
  etag?: string;
  version?: number;
  state?: string;
  contentType?: 'article' | 'post' | 'video';
  accessMode?: 'PUBLIC' | 'MEMBERS_ONLY';
  title?: string;
  bodyRef?: string;
  mediaRefs?: string[];
  coverRef?: string | null;
  mediaWarning?: 'NUDITY' | 'VIOLENCE' | 'SENSITIVE' | null;
  creatorId?: string | null;
  ownerUserId?: string;
};

type ApiEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string };
};

type ComposerAsset = {
  localId: string;
  uri?: string;
  filename: string;
  mimeType: string;
  size?: number | null;
  width?: number;
  height?: number;
  uploadKey?: string;
  uploaded?: UploadedMedia;
  altText?: string;
  serverUrl: string;
  playbackUrl?: string;
  status: 'uploading' | 'uploaded' | 'ready' | 'failed';
  error?: string;
  existing?: boolean;
};

type DiscoveryTopicOption = {
  topicId: string;
  name: string;
  displayName: string;
  contentCount: number;
};

type MentionSuggestion = {
  username: string;
  displayName: string | null;
  avatar: string | null;
};

const REPLY_AUDIENCE_OPTIONS: ReadonlyArray<{
  value: NativeReplyAudience;
  label: string;
  description: string;
}> = [
  { value: 'everyone', label: '每个人', description: '所有账号都可以回复' },
  { value: 'verified', label: '认证账号', description: '只有认证账号可以回复' },
  { value: 'following', label: '你关注的账号', description: '只有你关注的账号可以回复' },
  { value: 'mentioned', label: '你提及的账号', description: '只有你在帖子中提及的账号可以回复' },
  { value: 'followingNetwork', label: '你关注的账号及其关注的账号', description: '你关注的账号及其关注的账号可以回复' },
];

const replyAudienceLabels: Record<NativeReplyAudience, string> = {
  everyone: '所有人可以回复',
  verified: '认证账号可以回复',
  following: '你关注的账号可以回复',
  mentioned: '只有你提及的账号可以回复',
  followingNetwork: '你关注的账号及其关注的账号可以回复',
};

function readReplyAudienceFromResult(data: unknown): NativeReplyAudience | null {
  if (!data || typeof data !== 'object' || !('data' in data)) return null;
  const payload = (data as { data?: { replyAudience?: unknown } }).data;
  return isNativeReplyAudience(payload?.replyAudience) ? payload.replyAudience : null;
}

type SubmitAttempt = {
  fingerprint: string;
  contentKey: string;
  stateKey: string;
  mutationKey: string;
  pollKey: string;
};

const PRIMARY = '#1769aa';
const MAX_TEXT_LENGTH = 500;
const MAX_MEDIA_ITEMS = 4;
const MAX_VIDEO_ITEMS = 1;
const MIN_POLL_OPTIONS = 2;
const MAX_POLL_OPTIONS = 4;
const MAX_POLL_OPTION_LENGTH = 50;

const isVideoAsset = (asset: Pick<ComposerAsset, 'mimeType' | 'filename'>): boolean =>
  asset.mimeType.startsWith('video/') || /\.(mp4|webm|mov|m4v|avi|mkv)(?:[?#].*)?$/i.test(asset.filename);

function unwrapContent(value: unknown): ContentRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const root = value as Record<string, unknown>;
  const nested = root.data && typeof root.data === 'object' && !Array.isArray(root.data)
    ? root.data as Record<string, unknown>
    : root;
  return typeof nested.id === 'string' && nested.id
    ? nested as unknown as ContentRecord
    : null;
}

function mimeFromUrl(url: string): string {
  if (/\.(mp4|webm|mov|m4v|avi|mkv)(?:[?#].*)?$/i.test(url) || url.startsWith('https://video.luckread.com/')) return 'video/mp4';
  if (/\.png(?:[?#].*)?$/i.test(url)) return 'image/png';
  if (/\.webp(?:[?#].*)?$/i.test(url)) return 'image/webp';
  if (/\.gif(?:[?#].*)?$/i.test(url)) return 'image/gif';
  return 'image/jpeg';
}

function ComposerVideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer({ uri }, (instance) => {
    instance.loop = false;
    instance.muted = true;
  });
  return (
    <VideoView
      player={player}
      style={styles.videoPreview}
      contentFit="contain"
      nativeControls
      fullscreenOptions={{ enable: false }}
      allowsPictureInPicture={false}
    />
  );
}

function PublishScreenContent() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ contentId?: string | string[]; draftId?: string | string[] }>();
  const contentId = Array.isArray(params.contentId) ? params.contentId[0] : params.contentId;
  const draftId = Array.isArray(params.draftId) ? params.draftId[0] : params.draftId;
  const authStatus = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);

  const [body, setBody] = useState('');
  const [accessMode, setAccessMode] = useState<'PUBLIC' | 'MEMBERS_ONLY'>('PUBLIC');
  const [assets, setAssets] = useState<ComposerAsset[]>([]);
  const [cameraVisible, setCameraVisible] = useState(false);
  const [mediaActionsVisible, setMediaActionsVisible] = useState(false);
  const [coverRef, setCoverRef] = useState('');
  const [replyAudience, setReplyAudience] = useState<NativeReplyAudience>('everyone');
  const [replyAudiencePickerVisible, setReplyAudiencePickerVisible] = useState(false);
  const [mediaWarning, setMediaWarning] = useState<'NUDITY' | 'VIOLENCE' | 'SENSITIVE' | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(Boolean(contentId));
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [publishPending, setPublishPending] = useState(false);
  const [pollEnabled, setPollEnabled] = useState(false);
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [pollDurationParts, setPollDurationParts] = useState<PollDurationParts>(() => getPollDurationParts(DEFAULT_POLL_DURATION_MINUTES));
  const pollDurationMinutes = getPollDurationMinutes(pollDurationParts);
  const updatePollDurationPart = (unit: keyof PollDurationParts, value: string) => {
    setPollDurationParts((current) => ({ ...current, [unit]: value.replace(/[^0-9]/g, '').slice(0, 2) }));
  };
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(() => getDefaultScheduledPublishDate());
  const [schedulePickerVisible, setSchedulePickerVisible] = useState(false);
  const [schedulePickerDraft, setSchedulePickerDraft] = useState(() => getDefaultScheduledPublishDate());
  const [scheduleEditTarget, setScheduleEditTarget] = useState<NativeScheduledPost | null>(null);
  const openSchedulePicker = useCallback(() => {
    setScheduleEditTarget(null);
    const now = Date.now();
    const candidate = scheduleDate.getTime() > now + MIN_SCHEDULE_LEAD_TIME_MS
      ? scheduleDate
      : getDefaultScheduledPublishDate();
    setSchedulePickerDraft(candidate);
    setSchedulePickerVisible(true);
    setErrorMessage('');
  }, [scheduleDate]);
  const [draftSaveStatus, setDraftSaveStatus] = useState<'idle' | 'scheduled' | 'saving' | 'saved' | 'error'>('idle');
  const [draftInboxVisible, setDraftInboxVisible] = useState(false);
  const [draftInboxItems, setDraftInboxItems] = useState<NativePostDraft[]>([]);
  const [draftInboxCursor, setDraftInboxCursor] = useState<string | null>(null);
  const [draftInboxHasMore, setDraftInboxHasMore] = useState(false);
  const [draftInboxLoading, setDraftInboxLoading] = useState(false);
  const [draftInboxError, setDraftInboxError] = useState('');
  const [deletingDraftId, setDeletingDraftId] = useState<string | null>(null);
  const [scheduledInboxVisible, setScheduledInboxVisible] = useState(false);
  const [scheduledInboxItems, setScheduledInboxItems] = useState<NativeScheduledPost[]>([]);
  const [scheduledInboxCursor, setScheduledInboxCursor] = useState<string | null>(null);
  const [scheduledInboxHasMore, setScheduledInboxHasMore] = useState(false);
  const [scheduledInboxLoading, setScheduledInboxLoading] = useState(false);
  const [scheduledInboxError, setScheduledInboxError] = useState('');
  const [scheduledActionId, setScheduledActionId] = useState<string | null>(null);
  const scheduledActionInFlightRef = useRef(false);
  const [textSelection, setTextSelection] = useState({ start: 0, end: 0 });
  const [topicSuggestions, setTopicSuggestions] = useState<DiscoveryTopicOption[]>([]);
  const [topicSuggestionsLoading, setTopicSuggestionsLoading] = useState(false);
  const [mentionSuggestion, setMentionSuggestion] = useState<MentionSuggestion | null>(null);
  const [mentionLookupLoading, setMentionLookupLoading] = useState(false);

  const recordRef = useRef<ContentRecord | null>(null);
  const replyAudienceSavedFingerprintRef = useRef('');
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftSaveInFlightRef = useRef(false);
  const draftSaveInFlightPromiseRef = useRef<Promise<void> | null>(null);
  const draftSaveLastSavedAtRef = useRef<number | null>(null);
  const draftSaveChangeTokenRef = useRef(0);
  const draftSaveDirtyRef = useRef(false);
  const draftSaveRestoreCompleteRef = useRef(false);
  const skipNextDraftSaveRef = useRef(false);
  const draftCreateKeyRef = useRef('');
  const draftCreatePendingRef = useRef<{ key: string; payload: string; bodyText: string; fingerprint: string } | null>(null);
  const draftSavedFingerprintRef = useRef('');
  const draftAutoSaveSchedulerRef = useRef<() => void>(() => {});
  const pollConfiguredRef = useRef(false);
  const draftWasPublishedRef = useRef(false);
  const originalAccessModeRef = useRef<'PUBLIC' | 'MEMBERS_ONLY'>('PUBLIC');
  const originalBodyRef = useRef<{ text: string; bodyRef: string | null }>({ text: '', bodyRef: null });
  const bodyUploadRef = useRef<{ text: string; key: string; uploaded?: UploadedMedia } | null>(null);
  const submitAttemptRef = useRef<SubmitAttempt | null>(null);
  const editLoadKeyRef = useRef('');
  const bodyInputRef = useRef<React.ElementRef<typeof TextInput>>(null);
  const pendingCaretRef = useRef<number | null>(null);

  const activeComposerToken = findActiveComposerToken(body, textSelection.start);
  const activeCoverRef = coverRef || assets.find((asset) => asset.mimeType.startsWith('image/'))?.serverUrl || '';

  const updateAsset = useCallback((localId: string, patch: Partial<ComposerAsset>) => {
    setAssets((current) => current.map((asset) => asset.localId === localId ? { ...asset, ...patch } : asset));
  }, []);

  const persistPendingAsset = useCallback(async (asset: ComposerAsset) => {
    if (!user?.id || !asset.uri || !asset.uploadKey) {
      throw new Error('The selected media cannot be saved for recovery on this account.');
    }
    return persistPendingMediaRecovery(
      user.id,
      draftId || contentId || recordRef.current?.id || null,
      {
        localId: asset.localId,
        uri: asset.uri,
        filename: asset.filename,
        mimeType: asset.mimeType,
        size: asset.size,
        width: asset.width,
        height: asset.height,
        uploadKey: asset.uploadKey,
        altText: asset.altText,
      },
    );
  }, [contentId, draftId, user?.id]);

  const loadExistingContent = useCallback(async () => {
    const targetContentId = draftId || contentId;
    const restoringDraft = Boolean(draftId && !contentId);
    if (authStatus !== 'authenticated' || !user?.id) return;
    if (!targetContentId) {
      if (editLoadKeyRef.current === '__new-composer__') {
        draftSaveRestoreCompleteRef.current = true;
        return;
      }
      editLoadKeyRef.current = '__new-composer__';
      try {
        const pending = await listPendingMediaRecovery(user.id, null);
        if (pending.length > 0) {
          setAssets(pending.map((asset) => ({
            ...asset,
            serverUrl: '',
            status: 'failed',
            error: '上次上传中断。本机已保留文件，点击重试即可继续。',
          })));
          setStatusMessage('已恢复上次未完成的媒体上传。');
        }
      } catch {
        setErrorMessage('无法读取本机保存的待上传媒体，请重新选择文件。');
      } finally {
        draftSaveRestoreCompleteRef.current = true;
      }
      return;
    }
    if (editLoadKeyRef.current === targetContentId) return;
    editLoadKeyRef.current = targetContentId;
    setLoadingEdit(true);
    setErrorMessage('');
    try {
      const result = await apiRequest<Record<string, unknown>>(
        '/contents/' + encodeURIComponent(targetContentId),
        { method: 'GET' },
      );
      if (!result.response.ok) {
        throw new Error(apiFailureDiagnostic(result, restoringDraft ? 'Unable to restore this draft.' : 'Unable to load this post for editing.'));
      }
      const record = unwrapContent(result.data);
      if (!record) throw new Error('The server returned an incomplete content record.');
      if (record.contentType !== 'post') throw new Error('Beta editing currently supports social posts only.');
      if (restoringDraft && record.state !== 'DRAFT') {
        throw new Error('This saved draft is no longer editable as a draft. Open the published post instead.');
      }
      // W03 exposes ownerUserId only to the authenticated owner. Creator identity
      // may differ from the login user ID; W03 remains the final mutation authority.
      const ownerId = record.ownerUserId;
      if (ownerId && user?.id && ownerId !== user.id) {
        throw new Error('You can edit only your own post.');
      }
      const etag = record.etag || result.response.headers.get('ETag') || undefined;
      if (!etag || etag === '*') {
        throw new Error('The server did not return a version for this post. Refresh it before editing.');
      }

      const replyPolicyResult = await fetchOwnPostReplyAudience(targetContentId);
      const restoredReplyAudience = readReplyAudienceFromResult(replyPolicyResult.data);
      if (!replyPolicyResult.response.ok || !isNativeReplyAudience(restoredReplyAudience)) {
        throw new Error(apiFailureDiagnostic(replyPolicyResult, 'Unable to restore reply permissions for this post.'));
      }

      let restoredBody = record.title || '';
      if (restoringDraft && record.bodyRef) {
        const bodyResponse = await fetchContentBodyReference(record.bodyRef);
        if (!bodyResponse.ok) throw new Error('The saved draft text could not be restored. Your server draft was left unchanged.');
        restoredBody = await bodyResponse.text();
      }

      let restoredPoll: { options: Array<{ text: string }>; durationMinutes: number } | null = null;
      if (restoringDraft) {
        const pollResult = await apiRequest<{ data?: { poll?: { options?: Array<{ text?: string }>; durationMinutes?: number; durationHours?: number } | null } }>(
          '/contents/' + encodeURIComponent(targetContentId) + '/poll',
          { method: 'GET' },
        );
        const pollEnvelope = pollResult.data as { data?: { poll?: { options?: Array<{ text?: string }>; durationMinutes?: number; durationHours?: number } | null } } | null;
        const poll = pollResult.response.ok ? pollEnvelope?.data?.poll : null;
        const options = Array.isArray(poll?.options)
          ? poll.options.map((option) => typeof option.text === 'string' ? option.text : '').filter(Boolean)
          : [];
        const duration = typeof poll?.durationMinutes === 'number'
          ? poll.durationMinutes
          : typeof poll?.durationHours === 'number'
            ? poll.durationHours * 60
            : Number.NaN;
        if (options.length >= MIN_POLL_OPTIONS && options.length <= MAX_POLL_OPTIONS &&
            Number.isSafeInteger(duration) && duration >= 5 && duration <= 10080) {
          restoredPoll = { options: options.map((text) => ({ text })), durationMinutes: duration };
        }
      }

      const loaded: ContentRecord = { ...record, etag };
      recordRef.current = loaded;
      const loadedAccessMode = record.accessMode === 'MEMBERS_ONLY' ? 'MEMBERS_ONLY' : 'PUBLIC';
      const restoredMediaRefs = (record.mediaRefs || []).filter((url): url is string =>
        typeof url === 'string' && /^https?:\/\//i.test(url.trim()),
      );
      const ownedMedia = restoredMediaRefs.length > 0
        ? await getOwnedMediaMetadata(restoredMediaRefs).catch(() => [])
        : [];
      const ownedMediaByUrl = new Map(ownedMedia.map((media) => [media.url, media]));
      const restoredAssets: ComposerAsset[] = restoredMediaRefs.map((url, index) => {
        const filename = url.split('/').pop() || 'Existing media';
        const uploaded = ownedMediaByUrl.get(url);
        return {
          localId: 'existing-' + index + '-' + url,
          filename,
          mimeType: uploaded?.mimeType || mimeFromUrl(url),
          uploaded,
          altText: uploaded?.alt || filename,
          serverUrl: url,
          status: 'ready',
          existing: true,
        };
      });
      const pendingRecoveries = await listPendingMediaRecovery(user.id, targetContentId);
      const recoveredPendingAssets: ComposerAsset[] = pendingRecoveries.map((asset) => ({
        ...asset,
        serverUrl: '',
        status: 'failed',
        error: '上次上传中断。本机已保留文件，点击重试即可继续。',
      }));
      const combinedRestoredAssets = [...restoredAssets, ...recoveredPendingAssets];

      originalAccessModeRef.current = loadedAccessMode;
      originalBodyRef.current = { text: restoredBody, bodyRef: record.bodyRef || null };
      setAccessMode(loadedAccessMode);
      setBody(restoredBody);
      setReplyAudience(restoredReplyAudience);
      replyAudienceSavedFingerprintRef.current = createReplyAudienceFingerprint(restoredBody, restoredReplyAudience);
      setCoverRef(record.coverRef || '');
      setMediaWarning(record.mediaWarning ?? null);
      setAssets(combinedRestoredAssets);
      pollConfiguredRef.current = Boolean(restoredPoll);
      setPollEnabled(Boolean(restoredPoll));
      setPollOptions(restoredPoll ? restoredPoll.options.map((option) => option.text) : ['', '']);
      setPollDurationParts(getPollDurationParts(restoredPoll?.durationMinutes ?? DEFAULT_POLL_DURATION_MINUTES));
      if (restoringDraft) {
        draftSavedFingerprintRef.current = createPublishDraftFingerprint({
          body: restoredBody,
          accessMode: loadedAccessMode,
          mediaRefs: restoredMediaRefs,
          coverRef: record.coverRef || null,
          pollEnabled: Boolean(restoredPoll),
          pollOptions: restoredPoll ? restoredPoll.options.map((option) => option.text) : [],
          pollDurationMinutes: restoredPoll?.durationMinutes ?? DEFAULT_POLL_DURATION_MINUTES,
          mediaWarning: record.mediaWarning ?? null,
        });
        draftSaveLastSavedAtRef.current = Date.now();
        draftSaveDirtyRef.current = false;
        skipNextDraftSaveRef.current = true;
        setDraftSaveStatus('saved');
      }
      draftSaveRestoreCompleteRef.current = true;
    } catch (error) {
      editLoadKeyRef.current = '';
      setErrorMessage(error instanceof Error ? error.message : 'Unable to load this post.');
    } finally {
      setLoadingEdit(false);
    }
  }, [authStatus, contentId, draftId, user?.id]);

  useEffect(() => {
    if (!contentId && !draftId) draftSaveRestoreCompleteRef.current = true;
    void loadExistingContent();
  }, [contentId, draftId, loadExistingContent]);

  const uploadAsset = useCallback(async (asset: ComposerAsset) => {
    let uploaded = asset.uploaded;
    try {
      if (!uploaded) {
        if (!asset.uri || !asset.uploadKey) throw new Error('The selected file is missing retry information.');
        updateAsset(asset.localId, { status: 'uploading', error: undefined });
        const file: LocalMediaFile = {
          uri: asset.uri,
          name: asset.filename,
          mimeType: asset.mimeType,
          size: asset.size,
          width: asset.width,
          height: asset.height,
        };
        let uploadFile = await prepareImageForUpload(file);
        if (uploadFile.uri !== asset.uri) {
          try {
            const durableAsset = await persistPendingAsset({
              ...asset,
              uri: uploadFile.uri,
              filename: uploadFile.name,
              mimeType: uploadFile.mimeType,
              size: uploadFile.size,
              width: uploadFile.width,
              height: uploadFile.height,
            });
            uploadFile = { ...uploadFile, uri: durableAsset.uri };
          } catch {
            // Optional image optimization must not make a previously durable
            // original file unusable when device storage is nearly full.
            uploadFile = file;
          }
        }
        // Upload from the app-private persistent URI. The same URI, bytes,
        // fingerprint and idempotency key survive a process restart.
        updateAsset(asset.localId, {
          uri: uploadFile.uri,
          filename: uploadFile.name,
          mimeType: uploadFile.mimeType,
          size: uploadFile.size,
          width: uploadFile.width,
          height: uploadFile.height,
        });
        uploaded = await uploadMediaFile(uploadFile, asset.uploadKey);
        updateAsset(asset.localId, {
          uploaded,
          altText: uploaded.alt || asset.altText || asset.filename,
          serverUrl: uploaded.url,
          status: 'uploaded',
          error: undefined,
        });
      }

      let deliveryUrl = uploaded.url;
      if (isVideoAsset(asset)) {
        const playback = await getMediaPlayback(uploaded.id);
        deliveryUrl = playback.url;
      }
      updateAsset(asset.localId, {
        uploaded,
        serverUrl: deliveryUrl,
        playbackUrl: isVideoAsset(asset) ? deliveryUrl : undefined,
        status: 'ready',
        error: undefined,
      });
      return true;
    } catch (error) {
      updateAsset(asset.localId, {
        uploaded,
        serverUrl: uploaded?.url || asset.serverUrl,
        status: uploaded ? 'uploaded' : 'failed',
        error: uploaded
          ? 'Upload is saved, but playback could not be authorized. Retry playback; the file will not be uploaded again.'
          : error instanceof Error ? error.message : 'Media upload failed. Retry this file.',
      });
      return false;
    }
  }, [persistPendingAsset, updateAsset]);

  const addCapturedPhoto = useCallback(async (photo: CapturedCameraPhoto) => {
    if (busy || loadingEdit || publishPending) return;
    if (assets.length >= MAX_MEDIA_ITEMS) {
      Alert.alert('Attachment limit', 'A post can contain up to four photos or videos.');
      return;
    }

    const localId = createIdempotencyKey();
    const asset: ComposerAsset = {
      localId,
      uri: photo.uri,
      filename: 'luckread-camera-' + localId + '.jpg',
      mimeType: 'image/jpeg',
      size: null,
      width: photo.width,
      height: photo.height,
      uploadKey: createIdempotencyKey(),
      serverUrl: '',
      status: 'uploading',
    };
    setCameraVisible(false);
    setErrorMessage('');
    setStatusMessage('Preparing camera photo for recoverable upload…');
    setBusy(true);
    try {
      const durable = await persistPendingAsset(asset);
      const durableAsset = { ...asset, uri: durable.uri };
      setAssets((current) => [...current, durableAsset]);
      const succeeded = await uploadAsset(durableAsset);
      setStatusMessage(
        succeeded
          ? 'Camera photo uploaded. Server media references are ready to publish.'
          : 'Camera photo upload failed. The file is saved on this device; retry it from the composer.',
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The camera photo could not be saved for recovery.');
      setStatusMessage('');
    } finally {
      setBusy(false);
    }
  }, [assets.length, busy, loadingEdit, persistPendingAsset, publishPending, uploadAsset]);

  const handleCameraCapture = useCallback((photo: CapturedCameraPhoto) => {
    setCameraVisible(false);
    void addCapturedPhoto(photo);
  }, [addCapturedPhoto]);

  const pickMedia = useCallback(async () => {
    if (busy || loadingEdit || publishPending) return;
    const available = Math.max(0, MAX_MEDIA_ITEMS - assets.length);
    if (available === 0) {
      Alert.alert('Attachment limit', 'A post can contain up to four photos or videos.');
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photo and video access required', 'Allow LuckRead to access your library to attach photos or videos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsMultipleSelection: true,
      selectionLimit: available,
      // Expo SDK 58 requires quality=1 and editing disabled to preserve animated GIFs on Android.
      // Static JPEG/PNG optimization remains centralized in prepareImageForUpload.
      allowsEditing: false,
      quality: 1.0,
      videoMaxDuration: 60,
    });
    if (result.canceled || !result.assets?.length) return;

    const selectedVideoCount = result.assets.filter((asset) =>
      asset.type === 'video' ||
      asset.mimeType?.startsWith('video/') ||
      /\.(mp4|webm|mov|m4v|avi|mkv)(?:[?#].*)?$/i.test(asset.fileName || ''),
    ).length;
    const existingVideoCount = assets.filter(isVideoAsset).length;
    if (existingVideoCount + selectedVideoCount > MAX_VIDEO_ITEMS) {
      Alert.alert('One video per post', 'A dynamic can include one video and up to three pictures. Remove the existing video before choosing another.');
      return;
    }

    const picked = result.assets.slice(0, available);
    if (picked.length + assets.length > MAX_MEDIA_ITEMS) {
      Alert.alert('Attachment limit', 'A post can contain up to four photos or videos.');
      return;
    }
    const newAssets: ComposerAsset[] = picked.map((asset) => {
      const localId = createIdempotencyKey();
      const video = asset.type === 'video' ||
        asset.mimeType?.startsWith('video/') ||
        /\.(mp4|webm|mov|m4v|avi|mkv)(?:[?#].*)?$/i.test(asset.fileName || '');
      const filename = asset.fileName || (video ? 'luckread-video-' + localId + '.mp4' : 'luckread-image-' + localId + '.jpg');
      return {
        localId,
        uri: asset.uri,
        filename,
        mimeType: asset.mimeType || (video ? 'video/mp4' : 'image/jpeg'),
        size: asset.fileSize,
        width: asset.width,
        height: asset.height,
        uploadKey: createIdempotencyKey(),
        serverUrl: '',
        status: 'uploading',
      };
    });
    setErrorMessage('');
    setStatusMessage('Saving selected media on this device…');
    setBusy(true);
    try {
      const durableAssets: ComposerAsset[] = [];
      for (const asset of newAssets) {
        const durable = await persistPendingAsset(asset);
        durableAssets.push({ ...asset, uri: durable.uri });
      }
      setAssets((current) => [...current, ...durableAssets]);
      setStatusMessage('Uploading selected media to LuckRead…');
      const uploadResults: boolean[] = [];
      for (const asset of durableAssets) uploadResults.push(await uploadAsset(asset));
      if (uploadResults.every(Boolean)) {
        setStatusMessage('Media upload complete. Server media references are ready to publish.');
      } else {
        setStatusMessage('Some media uploads failed. Files are saved on this device; retry them from the composer.');
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Selected media could not be saved for recovery.');
      setStatusMessage('');
    } finally {
      setBusy(false);
    }
  }, [assets, busy, loadingEdit, persistPendingAsset, publishPending, uploadAsset]);

  const retryAsset = useCallback(async (asset: ComposerAsset) => {
    setBusy(true);
    setErrorMessage('');
    setStatusMessage('Retrying ' + asset.filename + '…');
    try {
      const succeeded = await uploadAsset(asset);
      const allReady = succeeded && assets.every((candidate) =>
        candidate.localId === asset.localId
          ? succeeded
          : candidate.existing || candidate.status === 'ready',
      );
      setStatusMessage(
        allReady
          ? 'Media upload complete. Server media references are ready to publish.'
          : succeeded
            ? 'This file uploaded successfully. Retry any remaining failed media before publishing.'
            : 'Media upload failed. Retry this file before publishing.',
      );
    } finally {
      setBusy(false);
    }
  }, [assets, uploadAsset]);

  const removeAsset = useCallback((localId: string) => {
    if (busy || publishPending) return;
    const target = assets.find((asset) => asset.localId === localId);
    const nextAssets = assets.filter((asset) => asset.localId !== localId);
    setAssets(nextAssets);
    if (target && !target.existing && user?.id) {
      void deletePendingMediaRecovery(user.id, target.localId).catch(() => undefined);
    }
    if (nextAssets.length === 0) setMediaWarning(null);
    if (target && coverRef === target.serverUrl) {
      setCoverRef(nextAssets.find((asset) => asset.mimeType.startsWith('image/'))?.serverUrl || '');
    }
  }, [assets, busy, coverRef, mediaWarning, publishPending, user?.id]);

  const moveAsset = useCallback((localId: string, direction: -1 | 1) => {
    if (busy || publishPending) return;
    setAssets((current) => {
      const currentIndex = current.findIndex((asset) => asset.localId === localId);
      if (currentIndex < 0) return current;
      return moveComposerAsset(current, currentIndex, direction);
    });
  }, [busy, publishPending]);

  const saveAssetAltText = useCallback(async (asset: ComposerAsset, value: string) => {
    const media = asset.uploaded;
    if (!media?.id) throw new Error('只有当前账号拥有的已上传图片才能保存替代文本。');
    const alt = value.normalize('NFKC').trim();
    if (!alt) throw new Error('请填写图片替代文本，或使用简短的内容描述。');
    if (alt === (media.alt || '').trim()) {
      updateAsset(asset.localId, { altText: alt });
      return;
    }
    const result = await apiRequest<Record<string, unknown>>(
      '/media/' + encodeURIComponent(media.id),
      { method: 'PATCH', body: JSON.stringify({ alt }) },
    );
    if (!result.response.ok) {
      throw new Error(apiFailureDiagnostic(result, '图片替代文本保存失败。'));
    }
    updateAsset(asset.localId, {
      altText: alt,
      uploaded: { ...media, alt },
    });
  }, [updateAsset]);

  const savePendingAssetAltText = useCallback(async () => {
    for (const asset of assets) {
      const media = asset.uploaded;
      if (!media?.id) continue;
      const alt = (asset.altText ?? media.alt ?? asset.filename).normalize('NFKC').trim();
      if (!alt) throw new Error('图片替代文本不能为空。');
      if (alt !== (media.alt || '').trim()) {
        await saveAssetAltText(asset, alt);
      }
    }
  }, [assets, saveAssetAltText]);

  const renderComposerAsset = useCallback(
    ({ item: asset, index }: { item: ComposerAsset; index: number }) => (
      <View style={[styles.assetTile, isDark && { backgroundColor: '#09090b', borderColor: '#3f3f46' }]}>
        <View style={styles.assetTilePreview}>
          {isVideoAsset(asset) ? (
            <View style={styles.videoPreviewWrap}>
              <ComposerVideoPreview uri={(asset.uri || asset.playbackUrl || asset.serverUrl) as string} />
            </View>
          ) : (
            <Image
              source={{ uri: asset.uri || asset.playbackUrl || asset.serverUrl }}
              style={styles.assetThumbnail}
              resizeMode="cover"
            />
          )}
          <View style={styles.assetTileActions}>
            <Sortable.Handle style={styles.assetTileAction}>
              <Feather name="move" size={17} color="#ffffff" />
            </Sortable.Handle>
            <Pressable
              disabled={busy || publishPending}
              accessibilityRole="button"
              accessibilityLabel="Remove attachment"
              onPress={() => removeAsset(asset.localId)}
              style={styles.assetTileAction}
            >
              <Feather name="x" size={18} color="#ffffff" />
            </Pressable>
          </View>
        </View>
        <View style={styles.assetTileMeta}>
          <Text numberOfLines={1} style={[styles.assetName, isDark && { color: '#e5e7eb' }]}>
            {asset.filename}
          </Text>
          <Text style={[styles.assetStatus, isDark && { color: '#9ca3af' }, asset.status === 'failed' ? styles.errorText : null]}>
            {asset.status === 'uploading' ? 'Uploading to LuckRead…'
              : asset.status === 'uploaded' ? 'Uploaded; playback authorization needs retry'
                : asset.status === 'ready' ? 'Ready'
                  : 'Upload failed'}
            {typeof asset.size === 'number' ? ' · ' + Math.round(asset.size / 1024) + ' KB' : ''}
          </Text>
          {asset.mimeType.startsWith('image/') ? (
            <View style={{ marginTop: 10 }}>
              <Text style={[styles.assetStatus, isDark && { color: '#d4d4d8' }]}>替代文本（无障碍图片说明）</Text>
              <TextInput
                accessibilityLabel="图片替代文本"
                accessibilityHint="描述图片的重要内容，供屏幕阅读器用户理解。"
                value={asset.altText ?? asset.uploaded?.alt ?? asset.filename}
                onChangeText={(value) => updateAsset(asset.localId, { altText: value })}
                editable={Boolean(asset.uploaded?.id) && asset.status === 'ready' && !busy && !publishPending}
                multiline
                maxLength={1000}
                placeholder="描述图片内容，方便屏幕阅读器用户理解"
                placeholderTextColor={isDark ? '#71717a' : '#98a2b3'}
                style={{
                  minHeight: 54,
                  borderWidth: 1,
                  borderColor: isDark ? '#52525b' : '#d0d5dd',
                  borderRadius: 8,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  marginTop: 5,
                  color: isDark ? '#f4f4f5' : '#101828',
                  fontSize: 13,
                  textAlignVertical: 'top',
                }}
              />
              {asset.uploaded?.id && (asset.altText ?? asset.uploaded.alt ?? asset.filename).trim() !== (asset.uploaded.alt ?? '').trim() ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="保存图片替代文本"
                  disabled={busy || publishPending}
                  onPress={() => {
                    void saveAssetAltText(asset, asset.altText ?? asset.uploaded?.alt ?? asset.filename)
                      .then(() => setStatusMessage('图片替代文本已保存。'))
                      .catch((error) => setErrorMessage(error instanceof Error ? error.message : '图片替代文本保存失败。'));
                  }}
                  style={[styles.retryLink, (busy || publishPending) && styles.disabledButton]}
                >
                  <Text style={styles.retryText}>保存说明</Text>
                </Pressable>
              ) : !asset.uploaded?.id ? (
                <Text style={[styles.assetStatus, isDark && { color: '#71717a' }]}>上传完成后可编辑图片说明。</Text>
              ) : null}
            </View>
          ) : null}
          {assets.length > 1 ? (
            <View style={styles.assetOrderControls}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Move attachment earlier"
                accessibilityHint="Moves this attachment one position earlier in the post."
                accessibilityState={{ disabled: busy || publishPending || index === 0 }}
                disabled={busy || publishPending || index === 0}
                onPress={() => moveAsset(asset.localId, -1)}
                style={[styles.assetOrderButton, isDark && { borderColor: '#52525b' }, (busy || publishPending || index === 0) && styles.disabledButton]}
              >
                <Feather name="arrow-up" size={16} color={isDark ? '#d4d4d8' : '#475467'} />
              </Pressable>
              <Text style={[styles.assetOrderLabel, isDark && { color: '#9ca3af' }]}>Attachment {index + 1} of {assets.length}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Move attachment later"
                accessibilityHint="Moves this attachment one position later in the post."
                accessibilityState={{ disabled: busy || publishPending || index === assets.length - 1 }}
                disabled={busy || publishPending || index === assets.length - 1}
                onPress={() => moveAsset(asset.localId, 1)}
                style={[styles.assetOrderButton, isDark && { borderColor: '#52525b' }, (busy || publishPending || index === assets.length - 1) && styles.disabledButton]}
              >
                <Feather name="arrow-down" size={16} color={isDark ? '#d4d4d8' : '#475467'} />
              </Pressable>
            </View>
          ) : null}
          {asset.mimeType.startsWith('image/') && asset.status === 'ready' && asset.serverUrl ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={asset.serverUrl === activeCoverRef ? '当前封面' : '设为封面'}
              accessibilityState={{
                selected: asset.serverUrl === activeCoverRef,
                disabled: busy || publishPending,
              }}
              disabled={busy || publishPending}
              onPress={() => setCoverRef(asset.serverUrl)}
              style={{
                alignSelf: 'flex-start',
                marginTop: 7,
                borderWidth: 1,
                borderColor: asset.serverUrl === activeCoverRef ? PRIMARY : (isDark ? '#52525b' : '#d0d5dd'),
                borderRadius: 999,
                paddingHorizontal: 10,
                paddingVertical: 5,
                backgroundColor: asset.serverUrl === activeCoverRef
                  ? (isDark ? '#102a43' : '#e8f4ff')
                  : 'transparent',
              }}
            >
              <Text style={{
                color: asset.serverUrl === activeCoverRef ? PRIMARY : (isDark ? '#d4d4d8' : '#475467'),
                fontSize: 11,
                fontWeight: '800',
              }}>
                {asset.serverUrl === activeCoverRef ? '当前封面' : '设为封面'}
              </Text>
            </Pressable>
          ) : null}
          {asset.error ? <Text numberOfLines={2} style={styles.inlineError}>{asset.error}</Text> : null}
          {(asset.status === 'failed' || asset.status === 'uploaded') && !asset.existing ? (
            <Pressable disabled={busy || publishPending} onPress={() => { void retryAsset(asset); }} style={styles.retryLink}>
              <Text style={styles.retryText}>Retry this file</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    ),
    [activeCoverRef, assets.length, busy, isDark, moveAsset, publishPending, removeAsset, retryAsset, saveAssetAltText, updateAsset],
  );

  const saveDraftSnapshot = useCallback(async () => {
    if (contentId || loadingEdit || publishPending || authStatus !== 'authenticated') return;
    const trimmedBody = body.trim();
    if (!trimmedBody || trimmedBody.length > MAX_TEXT_LENGTH) return;
    if (pollEnabled) {
      const cleanOptions = pollOptions.map((option) => option.normalize('NFKC').trim());
      const optionKeys = cleanOptions.map((option) => option.toLocaleLowerCase('en-US'));
      if (
        cleanOptions.length < MIN_POLL_OPTIONS ||
        cleanOptions.length > MAX_POLL_OPTIONS ||
        cleanOptions.some((option) => !option || [...option].length > MAX_POLL_OPTION_LENGTH) ||
        new Set(optionKeys).size !== optionKeys.length
      ) {
        throw new Error('A poll needs 2–4 different, non-empty options. Complete the poll before saving the draft.');
      }
    }
    const pendingAssets = assets.filter((asset) => !asset.existing && asset.status !== 'ready');
    if (pendingAssets.some((asset) => !asset.uri || !asset.uploadKey)) {
      throw new Error('An unfinished attachment is missing its local recovery file. Remove it or select it again.');
    }
    await Promise.all(pendingAssets.map((asset) => persistPendingAsset(asset)));
    const readyAssets = assets.filter((asset) => asset.existing || asset.status === 'ready');
    if (readyAssets.some((asset) => !asset.serverUrl || !/^https?:\/\//i.test(asset.serverUrl))) return;

    const mediaRefs = Array.from(new Set(readyAssets.map((asset) => asset.serverUrl)));
    const nextCover = coverRef && mediaRefs.includes(coverRef)
      ? coverRef
      : readyAssets.find((asset) => asset.mimeType.startsWith('image/'))?.serverUrl || null;
    const fingerprint = createPublishDraftFingerprint({
      body: trimmedBody,
      accessMode,
      mediaRefs,
      coverRef: nextCover,
      pollEnabled,
      pollOptions,
      pollDurationMinutes: pollDurationMinutes ?? -1,
      mediaWarning,
    });
    const replyAudienceFingerprint = createReplyAudienceFingerprint(trimmedBody, replyAudience);
    if (
      recordRef.current?.id &&
      draftSavedFingerprintRef.current === fingerprint &&
      replyAudienceSavedFingerprintRef.current === replyAudienceFingerprint
    ) {
      await bindPendingMediaRecoveryToDraft(
        user.id,
        recordRef.current.id,
        pendingAssets.map((asset) => asset.localId),
      );
      return;
    }

    let bodyRef = originalBodyRef.current.text === trimmedBody
      ? originalBodyRef.current.bodyRef
      : null;
    if (!bodyRef && bodyUploadRef.current?.text === trimmedBody && bodyUploadRef.current.uploaded) {
      bodyRef = bodyUploadRef.current.uploaded.url;
    }
    if (!bodyRef) {
      if (bodyUploadRef.current?.text !== trimmedBody) {
        bodyUploadRef.current = { text: trimmedBody, key: createIdempotencyKey() };
      }
      const bodyAttempt = bodyUploadRef.current;
      const uploadedBody = await uploadTextBody(trimmedBody, bodyAttempt.key);
      bodyAttempt.uploaded = uploadedBody;
      bodyRef = uploadedBody.url;
    }
    if (!bodyRef) throw new Error('The server did not return a permanent URL for the draft text.');

    const payload = {
      contentType: 'post',
      title: trimmedBody,
      bodyRef,
      mediaRefs,
      coverRef: nextCover,
      mediaWarning,
      ...(accessMode === 'MEMBERS_ONLY' || originalAccessModeRef.current === 'MEMBERS_ONLY' ? { accessMode } : {}),
    };
    const serializedPayload = JSON.stringify(payload);
    let draft = recordRef.current;

    // If a create timed out, replay its exact idempotent request before writing
    // newer text. This prevents a second DRAFT row from being created.
    const pendingCreate = draftCreatePendingRef.current;
    let createdThisCall = false;
    if (!draft?.id) {
      const createKey = pendingCreate?.key || draftCreateKeyRef.current || createIdempotencyKey();
      const createPayload = pendingCreate?.payload || serializedPayload;
      const createBody = pendingCreate?.bodyText || trimmedBody;
      const createFingerprint = pendingCreate?.fingerprint || fingerprint;
      draftCreateKeyRef.current = createKey;
      let created;
      try {
        created = await apiRequest<Record<string, unknown>>('/contents', {
          method: 'POST',
          body: createPayload,
          idempotencyKey: createKey,
        });
      } catch (error) {
        draftCreatePendingRef.current = {
          key: createKey,
          payload: createPayload,
          bodyText: createBody,
          fingerprint: createFingerprint,
        };
        throw error;
      }
      if (!created.response.ok) {
        if (created.response.status === 408 || created.response.status >= 500) {
          draftCreatePendingRef.current = {
            key: createKey,
            payload: createPayload,
            bodyText: createBody,
            fingerprint: createFingerprint,
          };
        }
        throw new Error(apiFailureDiagnostic(created, 'Unable to auto-save this post draft.'));
      }
      const createdRecord = unwrapContent(created.data);
      const createdEtag = createdRecord?.etag || created.response.headers.get('ETag') || undefined;
      if (!createdRecord?.id || !createdEtag || createdEtag === '*') {
        draftCreatePendingRef.current = {
          key: createKey,
          payload: createPayload,
          bodyText: createBody,
          fingerprint: createFingerprint,
        };
        throw new Error('The draft may have been created, but its version was not returned. Retry the same save to avoid duplicates.');
      }
      draft = {
        ...createdRecord,
        etag: createdEtag,
        contentType: 'post',
        title: createBody,
        bodyRef: (JSON.parse(createPayload) as { bodyRef: string }).bodyRef,
        mediaRefs: (JSON.parse(createPayload) as { mediaRefs: string[] }).mediaRefs,
        coverRef: (JSON.parse(createPayload) as { coverRef: string | null }).coverRef,
        state: 'DRAFT',
      };
      recordRef.current = draft;
      createdThisCall = true;
      draftCreatePendingRef.current = null;
      draftCreateKeyRef.current = '';
      editLoadKeyRef.current = draft.id;
      router.setParams({ draftId: draft.id } as never);
      originalBodyRef.current = { text: createBody, bodyRef: draft.bodyRef || null };
    }

    if (!draft?.id) throw new Error('The draft could not be identified after saving.');
    if (!createdThisCall && draftSavedFingerprintRef.current !== fingerprint) {
      if (!draft.etag || draft.etag === '*') {
        const detail = await apiRequest<Record<string, unknown>>(
          '/contents/' + encodeURIComponent(draft.id),
          { method: 'GET' },
        );
        if (detail.response.ok) {
          const refreshed = unwrapContent(detail.data);
          const etag = refreshed?.etag || detail.response.headers.get('ETag') || undefined;
          if (refreshed && etag) draft = { ...draft, ...refreshed, etag };
        }
      }
      if (!draft.etag || draft.etag === '*') throw new Error('The saved draft is missing its version. Reload it before saving again.');
      const updated = await apiRequest<Record<string, unknown>>(
        '/contents/' + encodeURIComponent(draft.id),
        {
          method: 'PATCH',
          headers: { 'If-Match': draft.etag },
          body: serializedPayload,
          idempotencyKey: createIdempotencyKey(),
        },
      );
      if (!updated.response.ok) {
        throw new Error(apiFailureDiagnostic(updated, 'Unable to update the saved draft.'));
      }
      const updatedRecord = unwrapContent(updated.data);
      const updatedEtag = updatedRecord?.etag || updated.response.headers.get('ETag') || undefined;
      if (!updatedRecord?.id || !updatedEtag || updatedEtag === '*') {
        throw new Error('The draft was updated, but its new version was not returned. Reload before publishing.');
      }
      draft = { ...updatedRecord, etag: updatedEtag };
      recordRef.current = draft;
      originalBodyRef.current = { text: trimmedBody, bodyRef };
    }

    // The web composer already uses these W01/W05 draft poll routes. Keep the
    // native draft's poll synchronized without creating new backend surfaces.
    if (pollEnabled) {
      const cleanOptions = pollOptions.map((option) => option.normalize('NFKC').trim());
      const optionKeys = cleanOptions.map((option) => option.toLocaleLowerCase('en-US'));
      const validPoll = pollDurationMinutes !== null && cleanOptions.length >= MIN_POLL_OPTIONS &&
        cleanOptions.length <= MAX_POLL_OPTIONS &&
        cleanOptions.every((option) => option.length > 0 && [...option].length <= MAX_POLL_OPTION_LENGTH) &&
        new Set(optionKeys).size === optionKeys.length;
      if (validPoll) {
        const pollResult = await apiRequest<unknown>(
          '/contents/' + encodeURIComponent(draft.id) + '/poll',
          {
            method: 'POST',
            body: JSON.stringify({ options: cleanOptions, durationMinutes: pollDurationMinutes ?? DEFAULT_POLL_DURATION_MINUTES }),
            idempotencyKey: createIdempotencyKey(),
          },
        );
        if (!pollResult.response.ok) {
          throw new Error(apiFailureDiagnostic(pollResult, 'Unable to auto-save the poll.'));
        }
        pollConfiguredRef.current = true;
      }
    } else if (pollConfiguredRef.current) {
      const pollResult = await apiRequest<unknown>(
        '/contents/' + encodeURIComponent(draft.id) + '/poll',
        { method: 'DELETE', idempotencyKey: createIdempotencyKey() },
      );
      if (!pollResult.response.ok) {
        throw new Error(apiFailureDiagnostic(pollResult, 'Unable to remove the draft poll.'));
      }
      pollConfiguredRef.current = false;
    }
    // The owner policy is persisted in W05; W01 resolves @mentions to canonical IDs.
    if (replyAudienceSavedFingerprintRef.current !== replyAudienceFingerprint) {
      const replyPolicyResult = await saveOwnPostReplyAudience(draft.id, replyAudience, trimmedBody);
      if (!replyPolicyResult.response.ok || !readReplyAudienceFromResult(replyPolicyResult.data)) {
        throw new Error(apiFailureDiagnostic(replyPolicyResult, 'Unable to save who can reply to this post.'));
      }
      replyAudienceSavedFingerprintRef.current = replyAudienceFingerprint;
    }
    // Pending files remain local and recoverable; only permanent media refs are
    // written to W03. Once ready refs are safely saved, their local copies can
    // be removed without affecting the server draft.
    await bindPendingMediaRecoveryToDraft(
      user.id,
      draft.id,
      pendingAssets.map((asset) => asset.localId),
    );
    await Promise.all(
      readyAssets
        .filter((asset) => !asset.existing)
        .map((asset) => deletePendingMediaRecovery(user.id, asset.localId)),
    );

    // Only mark the content fingerprint saved after content, poll and reply policy succeed.
    draftSavedFingerprintRef.current = fingerprint;
    originalBodyRef.current = { text: trimmedBody, bodyRef };
  }, [
    accessMode,
    assets,
    authStatus,
    body,
    contentId,
    coverRef,
    loadingEdit,
    mediaWarning,
    persistPendingAsset,
    pollDurationMinutes,
    pollEnabled,
    pollOptions,
    publishPending,
    replyAudience,
    router,
    user?.id,
  ]);

  const scheduleDraftAutoSave = useCallback(() => {
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
    if (
      !draftSaveRestoreCompleteRef.current ||
      !draftSaveDirtyRef.current ||
      contentId ||
      !body.trim() ||
      body.trim().length > MAX_TEXT_LENGTH ||
      loadingEdit ||
      publishPending ||
      assets.some((asset) => !asset.existing && asset.status !== 'ready')
    ) {
      setDraftSaveStatus('idle');
      return;
    }

    const changeToken = draftSaveChangeTokenRef.current;
    const delay = computeAutoSaveDelay(Date.now(), draftSaveLastSavedAtRef.current);
    setDraftSaveStatus('scheduled');
    draftSaveTimerRef.current = setTimeout(() => {
      draftSaveTimerRef.current = null;
      if (
        changeToken !== draftSaveChangeTokenRef.current ||
        draftSaveInFlightRef.current ||
        busy ||
        !draftSaveDirtyRef.current
      ) {
        return;
      }
      draftSaveInFlightRef.current = true;
      setDraftSaveStatus('saving');
      const task = (async () => {
        try {
          await saveDraftSnapshot();
          draftSaveLastSavedAtRef.current = Date.now();
          if (changeToken === draftSaveChangeTokenRef.current) {
            draftSaveDirtyRef.current = false;
            setDraftSaveStatus('saved');
          }
        } catch {
          setDraftSaveStatus('error');
        } finally {
          draftSaveInFlightRef.current = false;
          if (draftSaveDirtyRef.current && changeToken !== draftSaveChangeTokenRef.current) {
            draftAutoSaveSchedulerRef.current();
          }
        }
      })();
      draftSaveInFlightPromiseRef.current = task;
      void task.finally(() => {
        if (draftSaveInFlightPromiseRef.current === task) {
          draftSaveInFlightPromiseRef.current = null;
        }
      });
    }, delay);
  }, [
    assets,
    body,
    busy,
    contentId,
    loadingEdit,
    publishPending,
    saveDraftSnapshot,
  ]);

  const loadDraftInbox = useCallback(async (cursor: string | null = null, append = false) => {
    setDraftInboxLoading(true);
    setDraftInboxError('');
    try {
      const result = await fetchOwnPostDraftsPage({ cursor, limit: 20 });
      if (!result.response.ok) throw new Error(apiFailureDiagnostic(result, '暂时无法加载草稿箱。'));
      const page = result.data && 'data' in result.data ? result.data.data : undefined;
      if (!page || !Array.isArray(page.items)) throw new Error('草稿箱返回的数据格式无效。');
      setDraftInboxItems((current) => {
        if (!append) return page.items;
        const known = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !known.has(item.id))];
      });
      setDraftInboxCursor(page.nextCursor || null);
      setDraftInboxHasMore(page.hasMore === true);
    } catch (cause) {
      setDraftInboxError(cause instanceof Error ? cause.message : '暂时无法加载草稿箱。');
    } finally {
      setDraftInboxLoading(false);
    }
  }, []);

  const loadScheduledInbox = useCallback(async (cursor: string | null = null, append = false) => {
    setScheduledInboxLoading(true);
    setScheduledInboxError('');
    try {
      const result = await fetchOwnScheduledPostsPage({ cursor, limit: 20 });
      if (!result.response.ok) {
        throw new Error(apiFailureDiagnostic(result, '暂时无法加载定时发布列表。'));
      }
      const page = result.data && 'data' in result.data ? result.data.data : undefined;
      if (!page || !Array.isArray(page.items)) {
        throw new Error('定时发布列表返回的数据格式无效。');
      }
      setScheduledInboxItems((current) => {
        if (!append) return page.items;
        const known = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !known.has(item.id))];
      });
      setScheduledInboxCursor(page.nextCursor || null);
      setScheduledInboxHasMore(page.hasMore === true);
    } catch (cause) {
      setScheduledInboxError(cause instanceof Error ? cause.message : '暂时无法加载定时发布列表。');
    } finally {
      setScheduledInboxLoading(false);
    }
  }, []);

  const openScheduledInbox = useCallback(async () => {
    if (busy || loadingEdit || publishPending) return;
    setScheduledInboxVisible(true);
    await loadScheduledInbox(null, false);
  }, [busy, loadScheduledInbox, loadingEdit, publishPending]);

  const openDraftInbox = useCallback(async () => {
    if (busy || loadingEdit || publishPending) return;
    setDraftInboxVisible(true);
    setDraftInboxError('');
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
    if (!contentId && draftSaveDirtyRef.current) {
      draftSaveChangeTokenRef.current += 1;
      const pendingSave = draftSaveInFlightPromiseRef.current;
      if (pendingSave) await pendingSave;
      try {
        await saveDraftSnapshot();
        draftSaveDirtyRef.current = false;
        setDraftSaveStatus('saved');
      } catch (cause) {
        setDraftInboxError(cause instanceof Error ? cause.message : '当前草稿保存失败，请先检查网络。');
        return;
      }
    }
    await loadDraftInbox(null, false);
  }, [busy, contentId, loadDraftInbox, loadingEdit, publishPending, saveDraftSnapshot]);

  const cancelScheduledPost = useCallback((item: NativeScheduledPost) => {
    if (scheduledActionInFlightRef.current) return;
    Alert.alert(
      '取消定时发布',
      '“' + item.title + '”将转为草稿，不会删除内容。',
      [
        { text: '保留定时', style: 'cancel' },
        {
          text: '转为草稿',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              if (scheduledActionInFlightRef.current) return;
              scheduledActionInFlightRef.current = true;
              setScheduledActionId(item.id);
              setScheduledInboxError('');
              try {
                const result = await transitionOwnScheduledPostState(item, 'DRAFT');
                if (!result.response.ok) {
                  throw new Error(apiFailureDiagnostic(result, '取消定时发布失败。'));
                }
                setScheduledInboxItems((current) => current.filter((candidate) => candidate.id !== item.id));
                setScheduledInboxError('');
                await loadScheduledInbox(null, false);
              } catch (cause) {
                setScheduledInboxError(cause instanceof Error ? cause.message : '取消定时发布失败。');
              } finally {
                scheduledActionInFlightRef.current = false;
                setScheduledActionId(null);
              }
            })();
          },
        },
      ],
    );
  }, [loadScheduledInbox]);

  const rescheduleScheduledPost = useCallback(async (item: NativeScheduledPost, scheduledAt: string) => {
    if (scheduledActionInFlightRef.current || scheduledActionId) return;
    scheduledActionInFlightRef.current = true;
    setScheduledActionId(item.id);
    setScheduledInboxError('');
    let movedToDraft = false;
    try {
      // Use the existing lifecycle state machine rather than adding a self-transition.
      const unscheduled = await transitionOwnScheduledPostState(item, 'DRAFT');
      if (!unscheduled.response.ok) {
        throw new Error(apiFailureDiagnostic(unscheduled, '原定时未能取消，内容状态未改变。'));
      }
      movedToDraft = true;
      setScheduledInboxItems((current) => current.filter((candidate) => candidate.id !== item.id));

      const transitionData = unscheduled.data && typeof unscheduled.data === 'object'
        ? unscheduled.data as Record<string, unknown>
        : null;
      const nextEtag = typeof transitionData?.etag === 'string' ? transitionData.etag : '';
      if (!nextEtag || nextEtag === '*') {
        throw new Error('原定时已取消，内容已转为草稿；服务器未返回新版本，暂时无法重新安排。请从草稿箱继续编辑。');
      }

      const updatedDraft = { ...item, etag: nextEtag };
      const scheduled = await transitionOwnScheduledPostState(updatedDraft, 'SCHEDULED', scheduledAt);
      if (!scheduled.response.ok) {
        throw new Error(
          '原定时已取消，内容已安全转为草稿；重新安排失败：' +
          apiFailureDiagnostic(scheduled, '请从草稿箱重新安排发布时间。'),
        );
      }

      await loadScheduledInbox(null, false);
      Alert.alert('定时已更新', '新的发布时间：' + new Date(scheduledAt).toLocaleString() + '（本机时间）。');
    } catch (cause) {
      if (movedToDraft) {
        setScheduledInboxItems((current) => current.filter((candidate) => candidate.id !== item.id));
      }
      setScheduledInboxError(cause instanceof Error ? cause.message : '修改发布时间失败。');
    } finally {
      scheduledActionInFlightRef.current = false;
      setScheduledActionId(null);
      setScheduledInboxVisible(true);
    }
  }, [loadScheduledInbox, scheduledActionId]);

  const openScheduleEditPicker = useCallback((item: NativeScheduledPost) => {
    const existing = Date.parse(item.scheduledAt);
    const candidate = Number.isFinite(existing) && existing > Date.now() + MIN_SCHEDULE_LEAD_TIME_MS
      ? new Date(existing)
      : getDefaultScheduledPublishDate();
    setScheduleEditTarget(item);
    setSchedulePickerDraft(candidate);
    setSchedulePickerVisible(true);
    setScheduledInboxVisible(false);
  }, []);

  const confirmSchedulePicker = useCallback(() => {
    const iso = toScheduledPublishISO(schedulePickerDraft);
    if (!iso) {
      Alert.alert('时间无效', '请选择至少一分钟后的时间。');
      return;
    }
    if (scheduleEditTarget) {
      const target = scheduleEditTarget;
      setScheduleEditTarget(null);
      setSchedulePickerVisible(false);
      void rescheduleScheduledPost(target, iso);
      return;
    }
    setScheduleDate(new Date(iso));
    setScheduleEnabled(true);
    setSchedulePickerVisible(false);
    setErrorMessage('');
  }, [rescheduleScheduledPost, scheduleEditTarget, schedulePickerDraft]);

  const restoreDraftFromInbox = useCallback((draft: NativePostDraft) => {
    setDraftInboxVisible(false);
    if (draftId === draft.id) return;
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
    draftSaveDirtyRef.current = false;
    draftSaveRestoreCompleteRef.current = false;
    draftSavedFingerprintRef.current = '';
    replyAudienceSavedFingerprintRef.current = '';
    draftCreatePendingRef.current = null;
    draftCreateKeyRef.current = '';
    recordRef.current = null;
    editLoadKeyRef.current = '';
    pollConfiguredRef.current = false;
    draftWasPublishedRef.current = false;
    setBody('');
    setAssets([]);
    setCoverRef('');
    setAccessMode('PUBLIC');
    setReplyAudience('everyone');
    setPollEnabled(false);
    setPollOptions(['', '']);
    setErrorMessage('');
    setStatusMessage('');
    setDraftSaveStatus('idle');
    router.setParams({ contentId: undefined, draftId: draft.id } as never);
  }, [draftId, router]);

  const removeDraftFromInbox = useCallback((draft: NativePostDraft) => {
    Alert.alert('删除草稿', '删除后无法恢复这条草稿。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setDeletingDraftId(draft.id);
            setDraftInboxError('');
            try {
              const result = await deleteOwnPostDraft(draft.id, draft.etag);
              if (!result.response.ok) throw new Error(apiFailureDiagnostic(result, '删除草稿失败。'));
              setDraftInboxItems((current) => current.filter((item) => item.id !== draft.id));
              if (recordRef.current?.id === draft.id) {
                recordRef.current = null;
                editLoadKeyRef.current = '';
                draftSaveRestoreCompleteRef.current = false;
                draftSavedFingerprintRef.current = '';
                replyAudienceSavedFingerprintRef.current = '';
                pollConfiguredRef.current = false;
                setBody('');
                setAssets([]);
                setCoverRef('');
                setAccessMode('PUBLIC');
                setReplyAudience('everyone');
                setPollEnabled(false);
                setPollOptions(['', '']);
                setDraftSaveStatus('idle');
                router.setParams({ draftId: undefined } as never);
              }
            } catch (cause) {
              setDraftInboxError(cause instanceof Error ? cause.message : '删除草稿失败。');
              await loadDraftInbox(null, false);
            } finally {
              setDeletingDraftId(null);
            }
          })();
        },
      },
    ]);
  }, [loadDraftInbox, router]);

  const insertComposerToken = useCallback((value: string) => {
    const token = findActiveComposerToken(body, textSelection.start);
    if (!token) return;
    try {
      const updated = replaceActiveComposerToken(body, token, value);
      pendingCaretRef.current = updated.selection.start;
      setBody(updated.text);
      setTextSelection(updated.selection);
      setMentionSuggestion(null);
    } catch {
      setErrorMessage('无法插入该用户名或话题，请重新输入。');
    }
  }, [body, textSelection.start]);

  const syncPublishedSocialTokens = useCallback(async (contentIdValue: string, textValue: string): Promise<string | null> => {
    try {
      const result = await apiRequest<unknown>(
        '/contents/' + encodeURIComponent(contentIdValue) + '/social',
        { method: 'POST', body: JSON.stringify({ text: textValue }) },
      );
      return result.response.ok
        ? null
        : apiFailureDiagnostic(result, '提及和话题同步暂时失败。');
    } catch {
      return '动态已保存，但 @提及和 #话题同步暂时失败；可稍后编辑动态重试。';
    }
  }, []);

  useEffect(() => {
    if (activeComposerToken?.kind !== 'topic') return;
    let active = true;
    const controller = new AbortController();
    setTopicSuggestionsLoading(true);
    void fetchDiscoveryTopics(controller.signal).then((result) => {
      if (!result.response.ok) throw new Error('Topics unavailable');
      const root = result.data as { data?: { items?: unknown[] } } | null;
      const items = Array.isArray(root?.data?.items) ? root.data.items : [];
      if (!active) return;
      setTopicSuggestions(items.filter((item): item is DiscoveryTopicOption => {
        if (!item || typeof item !== 'object') return false;
        const value = item as Record<string, unknown>;
        return typeof value.topicId === 'string' && typeof value.name === 'string' && typeof value.displayName === 'string';
      }));
    }).catch(() => {
      if (active) setTopicSuggestions([]);
    }).finally(() => {
      if (active) setTopicSuggestionsLoading(false);
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [activeComposerToken?.kind]);

  useEffect(() => {
    const query = activeComposerToken?.kind === 'mention' ? activeComposerToken.query : '';
    if (query.length < 2) {
      setMentionSuggestion(null);
      setMentionLookupLoading(false);
      return;
    }
    setMentionSuggestion(null);
    setMentionLookupLoading(false);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setMentionLookupLoading(true);
      void findPublicUserByUsername(query, controller.signal).then((result) => {
        if (controller.signal.aborted) return;
        if (!result.response.ok) {
          setMentionSuggestion(null);
          return;
        }
        const root = result.data as Record<string, unknown> | null;
        const profile = root?.data && typeof root.data === 'object'
          ? root.data as Record<string, unknown>
          : root;
        const username = typeof profile?.username === 'string' ? profile.username : '';
        if (!username || username.toLocaleLowerCase('en-US') !== query.toLocaleLowerCase('en-US')) {
          setMentionSuggestion(null);
          return;
        }
        setMentionSuggestion({
          username,
          displayName: typeof profile?.displayName === 'string' ? profile.displayName : null,
          avatar: typeof profile?.avatar === 'string' ? profile.avatar : null,
        });
      }).catch(() => {
        if (!controller.signal.aborted) setMentionSuggestion(null);
      }).finally(() => {
        if (!controller.signal.aborted) setMentionLookupLoading(false);
      });
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [activeComposerToken?.kind, activeComposerToken?.query]);

  useEffect(() => {
    const caret = pendingCaretRef.current;
    if (caret === null) return;
    bodyInputRef.current?.setNativeProps({ selection: { start: caret, end: caret } });
    pendingCaretRef.current = null;
  }, [body]);

  useEffect(() => {
    draftAutoSaveSchedulerRef.current = scheduleDraftAutoSave;
  }, [scheduleDraftAutoSave]);

  useEffect(() => {
    if (!draftSaveRestoreCompleteRef.current || contentId || loadingEdit || publishPending) return;
    if (skipNextDraftSaveRef.current) {
      skipNextDraftSaveRef.current = false;
      return;
    }
    if (!body.trim() && assets.length === 0 && !pollEnabled) return;
    draftSaveDirtyRef.current = true;
    draftSaveChangeTokenRef.current += 1;
    draftAutoSaveSchedulerRef.current();
  }, [accessMode, assets, body, busy, contentId, coverRef, loadingEdit, pollDurationMinutes, pollEnabled, pollOptions, publishPending, replyAudience, mediaWarning]);

  useEffect(() => () => {
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
  }, []);

  const handlePreventRemove = useCallback(({ data }: { data: { action: NavigationAction } }) => {
    void (async () => {
      if (busy || loadingEdit || publishPending) {
        Alert.alert('请稍候', '当前操作尚未完成，完成后再关闭发布窗口。');
        return;
      }
      if (assets.some((asset) => !asset.existing && asset.status !== 'ready')) {
        setErrorMessage('媒体仍未全部上传成功，请重试或移除失败附件后再关闭。');
        return;
      }
      if (!body.trim() && (assets.length > 0 || pollEnabled)) {
        setErrorMessage('请先填写动态正文，再保存或关闭这份草稿。');
        return;
      }
      if (body.trim()) {
        if (draftSaveTimerRef.current) {
          clearTimeout(draftSaveTimerRef.current);
          draftSaveTimerRef.current = null;
        }
        draftSaveChangeTokenRef.current += 1;
        const pendingSave = draftSaveInFlightPromiseRef.current;
        if (pendingSave) await pendingSave;
        try {
          await saveDraftSnapshot();
        } catch (error) {
          setDraftSaveStatus('error');
          setErrorMessage(error instanceof Error ? error.message : '草稿保存失败，请检查网络后重试。');
          return;
        }
      }
      navigation.dispatch(data.action);
    })();
  }, [assets, body, busy, loadingEdit, navigation, pollEnabled, publishPending, saveDraftSnapshot]);

  const closeComposer = useCallback(() => {
    if (busy || loadingEdit || publishPending) {
      Alert.alert('请稍候', '当前操作尚未完成，完成后再关闭发布窗口。');
      return;
    }
    router.back();
  }, [busy, loadingEdit, publishPending, router]);

  const shouldPreventRemove = !contentId &&
    !draftWasPublishedRef.current &&
    (Boolean(body.trim()) || assets.length > 0 || pollEnabled);
  usePreventRemove(shouldPreventRemove, handlePreventRemove);

  const submit = useCallback(async () => {
    const trimmedBody = body.trim();
    if (!trimmedBody) {
      setErrorMessage('Write something before publishing.');
      return;
    }
    if (trimmedBody.length > MAX_TEXT_LENGTH) {
      setErrorMessage('A social post can contain up to 500 characters.');
      return;
    }
    if (assets.some((asset) => !asset.existing && asset.status !== 'ready')) {
      setErrorMessage('Finish or retry every media upload before publishing.');
      return;
    }
    if (assets.some((asset) => !asset.serverUrl || !/^https?:\/\//i.test(asset.serverUrl))) {
      setErrorMessage('Media is missing a permanent server URL. Device-local paths cannot be published.');
      return;
    }

    if (mediaWarning !== null && assets.length === 0) {
      setErrorMessage('Add at least one photo or video before applying a media warning.');
      return;
    }

    const cleanPollOptions = pollEnabled
      ? pollOptions.map((option) => option.normalize('NFKC').trim())
      : [];
    if (pollEnabled) {
      if (pollDurationMinutes === null) {
        setErrorMessage('Poll duration must be between 5 minutes and 7 days.');
        return;
      }
      const optionKeys = cleanPollOptions.map((option) => option.toLocaleLowerCase('en-US'));
      if (
        cleanPollOptions.length < MIN_POLL_OPTIONS ||
        cleanPollOptions.length > MAX_POLL_OPTIONS ||
        cleanPollOptions.some((option) => !option || [...option].length > MAX_POLL_OPTION_LENGTH) ||
        new Set(optionKeys).size !== optionKeys.length
      ) {
        setErrorMessage('A poll needs 2–4 different, non-empty options. Each option can be up to 50 characters.');
        return;
      }
    }

    if (scheduleEnabled && pollEnabled) {
      setErrorMessage('Polls cannot be scheduled yet. Turn off the poll or publish immediately.');
      return;
    }
    const normalizedScheduledAt = scheduleEnabled ? toScheduledPublishISO(scheduleDate) : null;
    if (scheduleEnabled && !normalizedScheduledAt) {
      setErrorMessage('Choose a publish time at least one minute in the future.');
      return;
    }

    const mediaRefs = Array.from(new Set(assets.map((asset) => asset.serverUrl)));
    const nextCover = coverRef && mediaRefs.includes(coverRef)
      ? coverRef
      : assets.find((asset) => asset.mimeType.startsWith('image/'))?.serverUrl || null;
    const fingerprint = JSON.stringify([contentId || '', trimmedBody, mediaRefs, nextCover, accessMode, pollEnabled, cleanPollOptions, pollEnabled ? pollDurationMinutes : null, normalizedScheduledAt, mediaWarning]);
    let attempt = submitAttemptRef.current;
    if (attempt && attempt.fingerprint !== fingerprint) {
      if (!contentId && !recordRef.current && publishPending) {
        setErrorMessage('The previous publish result is not confirmed. Retry the original request to avoid creating a duplicate post.');
        return;
      }
      attempt = null;
    }
    if (!attempt) {
      attempt = {
        fingerprint,
        contentKey: createIdempotencyKey(),
        stateKey: createIdempotencyKey(),
        mutationKey: createIdempotencyKey(),
        pollKey: createIdempotencyKey(),
      };
      submitAttemptRef.current = attempt;
    }

    if (!contentId) {
      if (draftSaveTimerRef.current) {
        clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
      draftSaveChangeTokenRef.current += 1;
      const pendingDraftSave = draftSaveInFlightPromiseRef.current;
      if (pendingDraftSave) await pendingDraftSave;
      try {
        // Settle the authoritative DRAFT first; replay ambiguous creates with the original key.
        await saveDraftSnapshot();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : '草稿保存失败，暂时无法发布。');
        setStatusMessage('');
        return;
      }
    }
    setBusy(true);
    setErrorMessage('');
    setStatusMessage(contentId ? 'Saving your changes…' : scheduleEnabled ? 'Scheduling your post…' : 'Publishing your post…');
    try {
      await savePendingAssetAltText();
      let bodyRef: string | null = null;
      const unchangedExistingBody = Boolean(
        contentId &&
        originalBodyRef.current.bodyRef &&
        trimmedBody === originalBodyRef.current.text,
      );
      if (unchangedExistingBody) {
        bodyRef = originalBodyRef.current.bodyRef;
      } else if (bodyUploadRef.current?.text === trimmedBody && bodyUploadRef.current.uploaded) {
        bodyRef = bodyUploadRef.current.uploaded.url;
      } else {
        if (bodyUploadRef.current?.text !== trimmedBody) {
          bodyUploadRef.current = { text: trimmedBody, key: createIdempotencyKey() };
        }
        const bodyAttempt = bodyUploadRef.current;
        const uploadedBody = await uploadTextBody(trimmedBody, bodyAttempt.key);
        bodyAttempt.uploaded = uploadedBody;
        bodyRef = uploadedBody.url;
      }
      if (!bodyRef) throw new Error('The server did not return a permanent URL for the post body.');

      const includeAccessMode = accessMode === 'MEMBERS_ONLY' ||
        originalAccessModeRef.current === 'MEMBERS_ONLY';
      const payload = {
        // X-style media posts remain W03 social posts; video is an attachment, not a separate video-content record.
        contentType: 'post',
        title: trimmedBody,
        bodyRef,
        mediaRefs,
        coverRef: nextCover,
        mediaWarning,
        ...(includeAccessMode ? { accessMode } : {}),
      };

      if (contentId) {
        const record = recordRef.current;
        if (!record?.etag) throw new Error('Reload the post before editing because its server version is missing.');
        const result = await apiRequest<Record<string, unknown>>(
          '/contents/' + encodeURIComponent(contentId),
          {
            method: 'PATCH',
            headers: { 'If-Match': record.etag },
            body: JSON.stringify(payload),
            idempotencyKey: attempt.mutationKey,
          },
        );
        if (!result.response.ok) {
          throw new Error(apiFailureDiagnostic(result, 'Unable to save post changes.'));
        }
        const updatedRecord = unwrapContent(result.data);
        const updatedEtag = updatedRecord?.etag || result.response.headers.get('ETag') || undefined;
        if (updatedRecord?.id && updatedEtag && updatedEtag !== '*') {
          recordRef.current = { ...(recordRef.current ?? record), ...updatedRecord, etag: updatedEtag };
        }
        const replyAudienceFingerprint = createReplyAudienceFingerprint(trimmedBody, replyAudience);
        const replyPolicyResult = await saveOwnPostReplyAudience(contentId, replyAudience, trimmedBody);
        if (!replyPolicyResult.response.ok || !readReplyAudienceFromResult(replyPolicyResult.data)) {
          throw new Error(apiFailureDiagnostic(replyPolicyResult, 'Post changes were saved, but reply permissions could not be updated.'));
        }
        replyAudienceSavedFingerprintRef.current = replyAudienceFingerprint;
        const socialSyncWarning = recordRef.current?.state === 'PUBLISHED'
          ? await syncPublishedSocialTokens(contentId, trimmedBody)
          : null;
        Alert.alert('保存成功', socialSyncWarning
          ? '你的动态已保存，但 @提及和 #话题同步暂时失败，可稍后再次编辑重试。'
          : '你的动态修改已保存。', [
          {
            text: '查看动态',
            onPress: () => router.replace(('/post/' + encodeURIComponent(contentId)) as never),
          },
          {
            text: '完成',
            onPress: () => router.replace(('/?published=' + encodeURIComponent(contentId) + '&refresh=' + Date.now()) as never),
          },
        ]);
        return;
      }

      let draft = recordRef.current;
      const currentDraftFingerprint = createPublishDraftFingerprint({
        body: trimmedBody,
        accessMode,
        mediaRefs,
        coverRef: nextCover,
        pollEnabled,
        pollOptions,
        pollDurationMinutes: pollDurationMinutes ?? -1,
        mediaWarning,
      });
      if (draft?.id && draftSavedFingerprintRef.current !== currentDraftFingerprint) {
        if (!draft.etag || draft.etag === '*') {
          const detail = await apiRequest<Record<string, unknown>>(
            '/contents/' + encodeURIComponent(draft.id),
            { method: 'GET' },
          );
          if (detail.response.ok) {
            const refreshed = unwrapContent(detail.data);
            const refreshedEtag = refreshed?.etag || detail.response.headers.get('ETag') || undefined;
            if (refreshed && refreshedEtag) draft = { ...draft, ...refreshed, etag: refreshedEtag };
          }
        }
        if (!draft.etag || draft.etag === '*') throw new Error('Reload the draft before publishing because its server version is missing.');
        const updated = await apiRequest<Record<string, unknown>>(
          '/contents/' + encodeURIComponent(draft.id),
          {
            method: 'PATCH',
            headers: { 'If-Match': draft.etag },
            body: JSON.stringify(payload),
            idempotencyKey: attempt.mutationKey,
          },
        );
        if (!updated.response.ok) throw new Error(apiFailureDiagnostic(updated, 'Unable to save the latest draft before publishing.'));
        const updatedRecord = unwrapContent(updated.data);
        const updatedEtag = updatedRecord?.etag || updated.response.headers.get('ETag') || undefined;
        if (!updatedRecord?.id || !updatedEtag || updatedEtag === '*') throw new Error('The draft was saved but its new version was not returned. Retry publication after reloading.');
        draft = { ...updatedRecord, etag: updatedEtag };
        recordRef.current = draft;
        draftSavedFingerprintRef.current = currentDraftFingerprint;
        originalBodyRef.current = { text: trimmedBody, bodyRef };
      }
      if (!draft?.id) {
        let created;
        try {
          created = await apiRequest<Record<string, unknown>>('/contents', {
            method: 'POST',
            body: JSON.stringify(payload),
            idempotencyKey: attempt.contentKey,
          });
        } catch (error) {
          // Keep the same idempotency key and freeze the payload while a network
          // result is uncertain; the user can retry without creating another row.
          setPublishPending(true);
          throw error;
        }
        if (!created.response.ok) {
          if (created.response.status === 408 || created.response.status >= 500) setPublishPending(true);
          throw new Error(apiFailureDiagnostic(created, 'Unable to create the post.'));
        }
        draft = unwrapContent(created.data) || null;
        if (!draft?.id) {
          setPublishPending(true);
          throw new Error('The server may have created the post but did not return its ID. Retry this same request to avoid a duplicate.');
        }
        const etag = draft.etag || created.response.headers.get('ETag') || undefined;
        draft = { ...draft, etag, contentType: 'post', title: trimmedBody, bodyRef, mediaRefs, coverRef: nextCover, state: draft.state || 'DRAFT' };
        recordRef.current = draft;
        setPublishPending(true);
        setStatusMessage('Post created. Completing the publish transition…');
      }

      if (!draft.etag || draft.etag === '*') {
        const detail = await apiRequest<Record<string, unknown>>(
          '/contents/' + encodeURIComponent(draft.id),
          { method: 'GET' },
        );
        if (detail.response.ok) {
          const refreshed = unwrapContent(detail.data);
          const etag = refreshed?.etag || detail.response.headers.get('ETag') || undefined;
          if (refreshed && etag) {
            draft = { ...draft, ...refreshed, etag };
            recordRef.current = draft;
          }
        }
      }
      if (!draft.etag || draft.etag === '*') {
        setPublishPending(true);
        throw new Error('The post exists, but the server did not return its version. Retry publication; another content record will not be created.');
      }

      if (pollEnabled && !contentId && !pollConfiguredRef.current) {
        let pollResult: { response: Response; data: unknown };
        try {
          pollResult = await apiRequest<unknown>(
            '/contents/' + encodeURIComponent(draft.id) + '/poll',
            {
              method: 'POST',
              body: JSON.stringify({
                options: cleanPollOptions,
                durationMinutes: pollDurationMinutes,
              }),
              idempotencyKey: attempt.pollKey,
            },
          );
        } catch (cause) {
          setPublishPending(true);
          throw new Error(
            cause instanceof Error
              ? cause.message
              : 'The post draft exists, but its poll could not be saved. Retry to finish the same post.',
          );
        }
        if (!pollResult.response.ok) {
          setPublishPending(true);
          throw new Error(apiFailureDiagnostic(
            pollResult,
            'The post draft exists, but its poll could not be saved. Retry to finish the same post.',
          ));
        }
      }

      const replyAudienceFingerprint = createReplyAudienceFingerprint(trimmedBody, replyAudience);
      if (replyAudienceSavedFingerprintRef.current !== replyAudienceFingerprint) {
        const replyPolicyResult = await saveOwnPostReplyAudience(draft.id, replyAudience, trimmedBody);
        if (!replyPolicyResult.response.ok || !readReplyAudienceFromResult(replyPolicyResult.data)) {
          setPublishPending(true);
          throw new Error(apiFailureDiagnostic(replyPolicyResult, 'The post draft exists, but reply permissions could not be saved. Retry to finish the same post.'));
        }
        replyAudienceSavedFingerprintRef.current = replyAudienceFingerprint;
      }

      const transitioned = await apiRequest<Record<string, unknown>>(
        '/contents/' + encodeURIComponent(draft.id) + '/state',
        {
          method: 'POST',
          headers: { 'If-Match': draft.etag },
          body: JSON.stringify({
            to: scheduleEnabled ? 'SCHEDULED' : 'PUBLISHED',
            ...(normalizedScheduledAt ? { scheduledAt: normalizedScheduledAt } : {}),
            preflight: {
              contentType: 'post',
              title: trimmedBody,
              body: trimmedBody,
              mediaRefs,
              coverRef: nextCover,
            },
          }),
          idempotencyKey: attempt.stateKey,
        },
      );
      if (!transitioned.response.ok) {
        setPublishPending(true);
        throw new Error(apiFailureDiagnostic(
          transitioned,
          'The post was created but could not be published yet. Retry to finish publishing this same post.',
        ));
      }

      if (scheduleEnabled) {
        submitAttemptRef.current = null;
        recordRef.current = null;
        draftWasPublishedRef.current = true;
        draftSaveDirtyRef.current = false;
        setDraftSaveStatus('idle');
        const localScheduleLabel = scheduleDate.toLocaleString();
        setStatusMessage('定时发布已安排');
        Alert.alert('定时发布已安排', '动态已保存，将于 ' + localScheduleLabel + '（本机时间）自动发布。', [
          {
            text: '完成',
            onPress: () => router.replace(('/?refresh=' + Date.now()) as never),
          },
        ]);
        return;
      }

      // W01 resolves @handles to canonical W02 identities; W05 persists mention/topic edges.
      const socialSyncWarning = await syncPublishedSocialTokens(draft.id, trimmedBody);
      submitAttemptRef.current = null;
      recordRef.current = null;
      draftWasPublishedRef.current = true;
      draftSaveDirtyRef.current = false;
      setDraftSaveStatus('idle');
      const publishedId = draft.id;
      setStatusMessage(socialSyncWarning ? '发布成功，提及和话题同步待重试。' : '发布成功');
      Alert.alert('发布成功', socialSyncWarning
        ? '你的动态已发布，但 @提及和 #话题同步暂时失败；之后编辑动态可以重试同步。'
        : '你的动态已发布，现在可以在公开信息流中查看。', [
        {
          text: '查看动态',
          onPress: () => router.replace(('/post/' + encodeURIComponent(publishedId)) as never),
        },
        {
          text: '完成',
          onPress: () => router.replace(('/?published=' + encodeURIComponent(publishedId) + '&refresh=' + Date.now()) as never),
        },
      ]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Publishing failed. Please retry.');
      setStatusMessage('');
    } finally {
      setBusy(false);
    }
  }, [accessMode, assets, body, contentId, coverRef, mediaWarning, pollDurationMinutes, pollEnabled, pollOptions, publishPending, replyAudience, router, saveDraftSnapshot, savePendingAssetAltText, scheduleDate, scheduleEnabled, syncPublishedSocialTokens]);

  if (authStatus !== 'authenticated') {
    return (
      <View style={[styles.centerState, isDark && { backgroundColor: '#000000' }]}>
        <Stack.Screen options={{ title: 'Create post', headerShown: false }} />
        <Text style={[styles.heading, isDark && { color: '#f9fafb' }]}>Create a LuckRead post</Text>
        <Text style={[styles.description, isDark && { color: '#9ca3af' }]}>Sign in to publish text, pictures, or a short video.</Text>
        <Pressable style={styles.primaryButton} onPress={() => router.push('/login' as never)}>
          <Text style={styles.primaryButtonText}>Sign in</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={() => router.back()}>
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.page, isDark && { backgroundColor: '#000000' }]}>
      <Stack.Screen options={{ title: contentId ? 'Edit post' : 'New post', headerShown: false }} />
      <View style={[styles.header, isDark && { backgroundColor: '#000000', borderBottomColor: '#27272a' }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close composer" disabled={busy || loadingEdit} onPress={() => { void closeComposer(); }} style={[styles.iconButton, (busy || loadingEdit) && styles.disabledButton]}>
          <Feather name="x" size={22} color={isDark ? '#e5e7eb' : '#111827'} />
        </Pressable>
        {!contentId && Platform.OS !== 'web' ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Open drafts" onPress={() => { void openDraftInbox(); }} style={styles.iconButton}>
            <Feather name="file-text" size={19} color={isDark ? '#e5e7eb' : '#344054'} />
          </Pressable>
        ) : null}
        {!contentId && Platform.OS !== 'web' ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Open scheduled posts" onPress={() => { void openScheduledInbox(); }} style={styles.iconButton}>
            <Feather name="calendar" size={19} color={isDark ? '#e5e7eb' : '#344054'} />
          </Pressable>
        ) : null}
        <Text style={[styles.headerTitle, isDark && { color: '#f9fafb' }]}>{contentId ? 'Edit post' : 'New post'}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => { void submit(); }}
          disabled={busy || loadingEdit || !body.trim()}
          style={[styles.publishButton, (busy || loadingEdit || !body.trim()) && styles.disabledButton]}
        >
          {busy ? <ActivityIndicator color="#ffffff" size="small" /> : <Text style={styles.publishButtonText}>{publishPending ? (scheduleEnabled ? 'Retry schedule' : 'Retry publish') : contentId ? 'Save' : scheduleEnabled ? 'Schedule' : 'Post'}</Text>}
        </Pressable>
      </View>

      {loadingEdit ? (
        <View style={[styles.centerState, isDark && { backgroundColor: '#000000' }]}>
          <ActivityIndicator size="large" color={PRIMARY} />
          <Text style={[styles.description, isDark && { color: '#9ca3af' }]}>Loading your post…</Text>
        </View>
      ) : (
        <KeyboardAwareScrollView
          style={{ flex: 1 }}
          bottomOffset={16}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.scrollContent, isDark && { backgroundColor: '#000000' }]}
        >
          <TextInput
            ref={bodyInputRef}
            accessibilityLabel="Post text"
            multiline
            maxLength={MAX_TEXT_LENGTH}
            editable={!busy && !publishPending}
            placeholder="What is happening?!"
            placeholderTextColor="#667085"
            style={[styles.composerInput, isDark && { color: '#f9fafb' }]}
            value={body}
            onChangeText={(value) => { setBody(value); setErrorMessage(''); }}
            onSelectionChange={(event) => setTextSelection(event.nativeEvent.selection)}
            textAlignVertical="top"
          />
          {activeComposerToken?.kind === 'topic' ? (
            <View style={[styles.suggestionPanel, isDark && styles.suggestionPanelDark]}>
              <Text style={[styles.suggestionHeading, isDark && { color: '#d4d4d8' }]}>热门话题</Text>
              {topicSuggestions
                .filter((topic) => !activeComposerToken.query || topic.name.toLocaleLowerCase('en-US').includes(activeComposerToken.query.toLocaleLowerCase('en-US')))
                .slice(0, 5)
                .map((topic) => (
                  <Pressable key={topic.topicId} accessibilityRole="button" onPress={() => insertComposerToken(topic.name)} style={styles.suggestionRow}>
                    <View style={styles.suggestionTopicIcon}><Feather name="hash" size={16} color={PRIMARY} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.suggestionName, isDark && { color: '#f4f4f5' }]}>#{topic.name}</Text>
                      <Text style={[styles.suggestionMeta, isDark && { color: '#a1a1aa' }]}>{topic.displayName} · {topic.contentCount.toLocaleString()} 条动态</Text>
                    </View>
                  </Pressable>
                ))}
              {topicSuggestionsLoading ? <Text style={[styles.suggestionMeta, isDark && { color: '#a1a1aa' }]}>正在加载热门话题…</Text> : topicSuggestions.length === 0 ? <Text style={[styles.suggestionMeta, isDark && { color: '#a1a1aa' }]}>暂无热门话题；可以继续输入自定义话题。</Text> : null}
            </View>
          ) : activeComposerToken?.kind === 'mention' && activeComposerToken.query.length >= 2 ? (
            <View style={[styles.suggestionPanel, isDark && styles.suggestionPanelDark]}>
              {mentionSuggestion ? (
                <Pressable accessibilityRole="button" onPress={() => insertComposerToken(mentionSuggestion.username)} style={styles.suggestionRow}>
                  {mentionSuggestion.avatar ? <Image source={{ uri: mentionSuggestion.avatar }} style={styles.mentionAvatar} /> : <View style={styles.mentionAvatarFallback}><Feather name="user" size={15} color={PRIMARY} /></View>}
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.suggestionName, isDark && { color: '#f4f4f5' }]}>{mentionSuggestion.displayName || mentionSuggestion.username}</Text>
                    <Text style={[styles.suggestionMeta, isDark && { color: '#a1a1aa' }]}>@{mentionSuggestion.username}</Text>
                  </View>
                </Pressable>
              ) : <Text style={[styles.suggestionMeta, isDark && { color: '#a1a1aa' }]}>{mentionLookupLoading ? '正在查找完整用户名…' : '输入完整用户名后可确认并插入提及。'}</Text>}
            </View>
          ) : null}
          <View style={[styles.counterRow, isDark && { borderBottomColor: '#27272a' }]}>
            <Text style={[styles.helperText, isDark && { color: '#9ca3af' }]}>Ordinary social posts publish directly; no extra review screen.</Text>
            <Text style={[styles.counter, isDark && { color: '#9ca3af' }]}>{body.length}/{MAX_TEXT_LENGTH}</Text>
          </View>
          <View style={[styles.replyAudienceSection, isDark && { borderBottomColor: '#27272a' }]}>
            <Text style={[styles.replyAudienceHeading, isDark && { color: '#f9fafb' }]}>回复权限</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose who can reply"
              accessibilityState={{ disabled: busy || loadingEdit || publishPending }}
              disabled={busy || loadingEdit || publishPending}
              onPress={() => setReplyAudiencePickerVisible(true)}
              style={[styles.replyAudienceButton, isDark && { borderColor: '#52525b', backgroundColor: '#09090b' }]}
            >
              <Feather name="message-circle" size={18} color={PRIMARY} />
              <Text style={[styles.replyAudienceButtonText, isDark && { color: '#f4f4f5' }]}>{replyAudienceLabels[replyAudience]}</Text>
              <Feather name="chevron-right" size={17} color={isDark ? '#a1a1aa' : '#667085'} />
            </Pressable>
            <Text style={[styles.replyAudienceHint, isDark && { color: '#9ca3af' }]}>
              被提及的账号始终可以回复。权限由服务端执行。
            </Text>
          </View>
          {!contentId && draftSaveStatus !== 'idle' ? (
            <Text accessibilityLiveRegion="polite" style={[styles.draftSaveStatus, isDark && { color: '#9ca3af' }]}>
              {draftSaveStatus === 'scheduled' ? '草稿即将自动保存…'
                : draftSaveStatus === 'saving' ? '正在自动保存草稿…'
                  : draftSaveStatus === 'saved' ? '草稿已自动保存。'
                    : '草稿自动保存失败，请检查网络后继续；再次编辑会重试。'}
            </Text>
          ) : null}

          {!contentId && Platform.OS !== 'web' ? (
            <View style={[styles.scheduleSection, isDark && { borderBottomColor: '#27272a' }]}>
              <Text style={[styles.scheduleSectionTitle, isDark && { color: '#f9fafb' }]}>发布时间</Text>
              <View style={styles.scheduleModeRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: !scheduleEnabled, disabled: busy || loadingEdit || publishPending }}
                  disabled={busy || loadingEdit || publishPending}
                  onPress={() => {
                    setScheduleEnabled(false);
                    setErrorMessage('');
                  }}
                  style={[styles.scheduleModeOption, !scheduleEnabled && styles.scheduleModeOptionSelected, isDark && !scheduleEnabled && { backgroundColor: '#102a43', borderColor: PRIMARY }]}
                >
                  <Text style={[styles.scheduleModeOptionText, isDark && { color: !scheduleEnabled ? '#ffffff' : '#e5e7eb' }, !scheduleEnabled && styles.scheduleModeOptionTextSelected]}>立即发布</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: scheduleEnabled, disabled: busy || loadingEdit || publishPending || pollEnabled }}
                  disabled={busy || loadingEdit || publishPending || pollEnabled}
                  onPress={openSchedulePicker}
                  style={[styles.scheduleModeOption, scheduleEnabled && styles.scheduleModeOptionSelected, isDark && { borderColor: scheduleEnabled ? PRIMARY : '#52525b', backgroundColor: scheduleEnabled ? '#102a43' : '#09090b' }]}
                >
                  <Text style={[styles.scheduleModeOptionText, isDark && { color: scheduleEnabled ? '#ffffff' : '#e5e7eb' }, scheduleEnabled && styles.scheduleModeOptionTextSelected]}>定时发布</Text>
                </Pressable>
              </View>
              {scheduleEnabled ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Change scheduled publish time"
                  disabled={busy || loadingEdit || publishPending}
                  onPress={openSchedulePicker}
                  style={[styles.scheduleDateButton, isDark && { borderColor: '#52525b', backgroundColor: '#09090b' }]}
                >
                  <View style={styles.scheduleDateButtonContent}>
                    <Feather name="calendar" size={17} color={PRIMARY} />
                    <Text style={[styles.scheduleDateText, isDark && { color: '#f4f4f5' }]}>{scheduleDate.toLocaleString()}</Text>
                    <Feather name="chevron-right" size={17} color={isDark ? '#a1a1aa' : '#667085'} />
                  </View>
                </Pressable>
              ) : null}
              <Text style={[styles.scheduleHint, isDark && { color: '#9ca3af' }]}>
                {pollEnabled
                  ? '投票暂不支持定时发布；关闭投票后可设置发布时间。'
                  : '按手机当前时区选择时间。服务端会在到点后重新检查创作者权限，再自动发布。'}
              </Text>
            </View>
          ) : null}

          <View style={[styles.accessModeSection, isDark && { borderBottomColor: '#27272a' }]}>
            <View>
              <Text style={[styles.accessModeTitle, isDark && { color: '#f9fafb' }]}>内容可见范围</Text>
              <Text style={[styles.accessModeDescription, isDark && { color: '#9ca3af' }]}>公开内容人人可见；会员专享内容仅对有效订阅者开放。</Text>
            </View>
            <View style={styles.accessModeOptions}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: accessMode === 'PUBLIC', disabled: busy || loadingEdit || publishPending }}
                disabled={busy || loadingEdit || publishPending}
                onPress={() => setAccessMode('PUBLIC')}
                style={[styles.accessModeOption, isDark && { borderColor: '#52525b' }, accessMode === 'PUBLIC' && styles.accessModeOptionSelected]}
              >
                <Feather name="globe" size={16} color={accessMode === 'PUBLIC' ? '#ffffff' : PRIMARY} />
                <Text style={[styles.accessModeOptionText, isDark && accessMode !== 'PUBLIC' && { color: '#e5e7eb' }, accessMode === 'PUBLIC' && styles.accessModeOptionTextSelected]}>公开</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: accessMode === 'MEMBERS_ONLY', disabled: busy || loadingEdit || publishPending }}
                disabled={busy || loadingEdit || publishPending}
                onPress={() => setAccessMode('MEMBERS_ONLY')}
                style={[styles.accessModeOption, isDark && { borderColor: '#52525b' }, accessMode === 'MEMBERS_ONLY' && styles.accessModeOptionSelected]}
              >
                <Feather name="lock" size={16} color={accessMode === 'MEMBERS_ONLY' ? '#ffffff' : PRIMARY} />
                <Text style={[styles.accessModeOptionText, isDark && accessMode !== 'MEMBERS_ONLY' && { color: '#e5e7eb' }, accessMode === 'MEMBERS_ONLY' && styles.accessModeOptionTextSelected]}>会员专享</Text>
              </Pressable>
            </View>
            {accessMode === 'MEMBERS_ONLY' ? (
              <Text style={[styles.accessModeNotice, isDark && { color: '#9ca3af' }]}>
                仅通过服务端创作者身份验证的账号可以发布会员专享内容。订阅权益由 W07 根据有效订阅状态实时判断。
              </Text>
            ) : null}
          </View>

          {assets.length > 0 ? (
            <View style={styles.assetGrid}>
              <Sortable.Grid
                columns={assets.length === 1 ? 1 : 2}
                data={assets}
                keyExtractor={(asset) => asset.localId}
                renderItem={renderComposerAsset}
                onDragEnd={({ data }) => setAssets(data)}
                sortEnabled={!busy && !publishPending && assets.length > 1}
                customHandle
                rowGap={10}
                columnGap={10}
              />
            </View>
          ) : null}

          {assets.length > 0 ? (
            <View style={[styles.mediaWarningSection, isDark && { borderBottomColor: '#27272a' }]}>
              <Text style={[styles.accessModeTitle, isDark && { color: '#f9fafb' }]}>媒体内容警告</Text>
              <Text style={[styles.accessModeDescription, isDark && { color: '#9ca3af' }]}>为可能包含敏感内容的图片或视频添加提示。读者可以选择是否查看。</Text>
              <View style={styles.mediaWarningOptions}>
                {([
                  { value: null, label: '无' },
                  { value: 'NUDITY', label: '裸露' },
                  { value: 'VIOLENCE', label: '暴力' },
                  { value: 'SENSITIVE', label: '敏感事件' },
                ] as const).map((option) => {
                  const selected = mediaWarning === option.value;
                  return (
                    <Pressable
                      key={option.value ?? 'none'}
                      accessibilityRole="button"
                      accessibilityState={{ selected, disabled: busy || loadingEdit || publishPending }}
                      disabled={busy || loadingEdit || publishPending}
                      onPress={() => setMediaWarning(option.value)}
                      style={[
                        styles.mediaWarningOption,
                        isDark && { borderColor: '#52525b' },
                        selected && styles.mediaWarningOptionSelected,
                        isDark && selected && { backgroundColor: '#102a43', borderColor: PRIMARY },
                      ]}
                    >
                      <Text style={[
                        styles.mediaWarningOptionText,
                        isDark && { color: '#e5e7eb' },
                        selected && styles.mediaWarningOptionTextSelected,
                      ]}>{option.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          <View style={styles.mediaActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add photos or video"
              accessibilityState={{ disabled: busy || loadingEdit || publishPending || assets.length >= MAX_MEDIA_ITEMS }}
              disabled={busy || loadingEdit || publishPending || assets.length >= MAX_MEDIA_ITEMS}
              style={[styles.mediaButton, isDark && { borderColor: '#52525b' }]}
              onPress={() => setMediaActionsVisible(true)}
            >
              <Feather name="image" size={19} color={PRIMARY} />
              <Text style={styles.mediaButtonText}>Add photos or video</Text>
            </Pressable>
            <Text style={[styles.mediaLimitHint, isDark && { color: '#9ca3af' }]}>Up to 4 media items · 1 video max · 60 seconds</Text>
          </View>

          {!contentId ? (
            <View style={[styles.pollSection, isDark && { borderBottomColor: '#27272a' }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: pollEnabled, disabled: busy || loadingEdit || publishPending || scheduleEnabled }}
                disabled={busy || loadingEdit || publishPending || scheduleEnabled}
                onPress={() => {
                  setPollEnabled((value) => !value);
                  setErrorMessage('');
                }}
                style={[styles.pollToggle, isDark && { borderColor: '#52525b', backgroundColor: '#09090b' }]}
              >
                <Feather name="bar-chart-2" size={19} color={PRIMARY} />
                <Text style={styles.mediaButtonText}>{pollEnabled ? 'Remove poll' : 'Add poll'}</Text>
              </Pressable>
              {pollEnabled ? (
                <View style={[styles.pollEditor, isDark && { borderColor: '#3f3f46', backgroundColor: '#09090b' }]}>
                  <Text style={[styles.pollHelper, isDark && { color: '#9ca3af' }]}>
                    Add 2–4 different options. Published poll options cannot be changed.
                  </Text>
                  {pollOptions.map((option, index) => (
                    <View key={'poll-option-' + index} style={styles.pollOptionRow}>
                      <TextInput
                        accessibilityLabel={'Poll option ' + (index + 1)}
                        editable={!busy && !publishPending}
                        maxLength={MAX_POLL_OPTION_LENGTH}
                        onChangeText={(value) => setPollOptions((current) =>
                          current.map((existing, optionIndex) => optionIndex === index ? value : existing),
                        )}
                        placeholder={'Option ' + (index + 1)}
                        placeholderTextColor="#667085"
                        style={[styles.pollOptionInput, isDark && { borderColor: '#52525b', backgroundColor: '#18181b', color: '#f9fafb' }]}
                        value={option}
                      />
                      {pollOptions.length > MIN_POLL_OPTIONS ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={'Remove poll option ' + (index + 1)}
                          disabled={busy || publishPending}
                          onPress={() => setPollOptions((current) => current.filter((_, optionIndex) => optionIndex !== index))}
                          style={styles.pollRemoveButton}
                        >
                          <Feather name="x-circle" size={20} color="#667085" />
                        </Pressable>
                      ) : null}
                    </View>
                  ))}
                  {pollOptions.length < MAX_POLL_OPTIONS ? (
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy || publishPending}
                      onPress={() => setPollOptions((current) => current.length < MAX_POLL_OPTIONS ? [...current, ''] : current)}
                      style={styles.pollAddOption}
                    >
                      <Feather name="plus" size={17} color={PRIMARY} />
                      <Text style={styles.mediaButtonText}>Add option</Text>
                    </Pressable>
                  ) : null}
                  <Text style={styles.pollHelper}>Poll duration · 5 minutes to 7 days</Text>
                  <View style={styles.pollDurationPartsRow}>
                    {([
                      { key: 'days', label: 'Days' },
                      { key: 'hours', label: 'Hours' },
                      { key: 'minutes', label: 'Minutes' },
                    ] as const).map((part) => (
                      <View key={part.key} style={styles.pollDurationPart}>
                        <Text style={[styles.pollDurationPartLabel, isDark && { color: '#9ca3af' }]}>{part.label}</Text>
                        <TextInput
                          accessibilityLabel={'Poll duration ' + part.label}
                          editable={!busy && !publishPending}
                          keyboardType="number-pad"
                          maxLength={2}
                          onChangeText={(value) => updatePollDurationPart(part.key, value)}
                          selectTextOnFocus
                          style={[styles.pollDurationPartInput, isDark && { borderColor: '#52525b', backgroundColor: '#18181b', color: '#f9fafb' }]}
                          value={pollDurationParts[part.key]}
                        />
                      </View>
                    ))}
                  </View>
                  {pollDurationMinutes === null ? (
                    <Text accessibilityLiveRegion="polite" style={styles.inlineError}>Choose a duration from 5 minutes through 7 days.</Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}

          {statusMessage ? <Text accessibilityLiveRegion="polite" style={styles.statusText}>{statusMessage}</Text> : null}
          {errorMessage ? <Text accessibilityLiveRegion="assertive" style={styles.errorText}>{errorMessage}</Text> : null}

          <View style={styles.footer}>
            <Feather name="check-circle" size={17} color={isDark ? '#9ca3af' : '#667085'} />
            <Text style={[styles.footerText, isDark && { color: '#9ca3af' }]}>Files upload to LuckRead first. Only permanent server media URLs are attached to the post.</Text>
          </View>
        </KeyboardAwareScrollView>
      )}
      <PublishMediaActionSheet
        visible={mediaActionsVisible}
        disabled={busy || loadingEdit || publishPending || assets.length >= MAX_MEDIA_ITEMS}
        remainingCount={MAX_MEDIA_ITEMS - assets.length}
        onClose={() => setMediaActionsVisible(false)}
        onTakePhoto={() => setCameraVisible(true)}
        onPickMedia={() => { void pickMedia(); }}
      />
      <CameraCaptureModal
        visible={cameraVisible}
        onClose={() => setCameraVisible(false)}
        onCapture={handleCameraCapture}
      />
      <Modal
        visible={schedulePickerVisible && Platform.OS !== 'web'}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          const wasEditing = scheduleEditTarget !== null;
          setSchedulePickerVisible(false);
          setScheduleEditTarget(null);
          if (wasEditing) setScheduledInboxVisible(true);
        }}
      >
        <View style={[styles.schedulePickerModal, isDark && styles.schedulePickerModalDark]}>
          <View style={[styles.schedulePickerHeader, isDark && { borderBottomColor: '#27272a' }]}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                const wasEditing = scheduleEditTarget !== null;
                setSchedulePickerVisible(false);
                setScheduleEditTarget(null);
                if (wasEditing) setScheduledInboxVisible(true);
              }}
              style={styles.schedulePickerActionHit}
            >
              <Text style={styles.schedulePickerCancel}>取消</Text>
            </Pressable>
            <Text style={[styles.schedulePickerTitle, isDark && { color: '#f9fafb' }]}>
              {scheduleEditTarget ? '修改发布时间' : '设置发布时间'}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={confirmSchedulePicker}
              style={styles.schedulePickerActionHit}
            >
              <Text style={styles.schedulePickerConfirm}>确认</Text>
            </Pressable>
          </View>
          <Text style={[styles.schedulePickerHint, isDark && { color: '#9ca3af' }]}>
            {scheduleEditTarget
              ? '修改时会先取消原定时并转为草稿，再按当前创作者权限重新安排。时间按手机当前时区显示。'
              : '时间按手机当前时区显示。最早可选择一分钟后。'}
          </Text>
          <DateTimePicker
            value={schedulePickerDraft}
            onValueChange={(_event, selectedDate) => setSchedulePickerDraft(selectedDate)}
            mode="datetime"
            minimumDate={new Date(Date.now() + MIN_SCHEDULE_LEAD_TIME_MS)}
            is24Hour
            presentation="inline"
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            accentColor={PRIMARY}
            themeVariant={isDark ? 'dark' : 'light'}
          />
        </View>
      </Modal>
      <Modal
        visible={replyAudiencePickerVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setReplyAudiencePickerVisible(false)}
      >
        <View style={[styles.replyAudienceModal, isDark && styles.draftsModalDark]}>
          <View style={[styles.schedulePickerHeader, isDark && { borderBottomColor: '#27272a' }]}>
            <Pressable accessibilityRole="button" onPress={() => setReplyAudiencePickerVisible(false)} style={styles.schedulePickerActionHit}>
              <Text style={styles.schedulePickerCancel}>取消</Text>
            </Pressable>
            <Text style={[styles.schedulePickerTitle, isDark && { color: '#f9fafb' }]}>谁可以回复？</Text>
            <View style={styles.schedulePickerActionHit} />
          </View>
          <Text style={[styles.schedulePickerHint, isDark && { color: '#9ca3af' }]}>
            选择可以回复这条动态的账号。只要被提及，账号仍然可以回复。
          </Text>
          {REPLY_AUDIENCE_OPTIONS.map((option) => (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected: replyAudience === option.value }}
              onPress={() => {
                setReplyAudience(option.value);
                setReplyAudiencePickerVisible(false);
                setErrorMessage('');
              }}
              style={[styles.replyAudienceOption, isDark && { borderBottomColor: '#27272a' }]}
            >
              <View style={styles.replyAudienceOptionCopy}>
                <Text style={[styles.replyAudienceOptionLabel, isDark && { color: '#f4f4f5' }]}>{option.label}</Text>
                <Text style={[styles.replyAudienceOptionDescription, isDark && { color: '#a1a1aa' }]}>{option.description}</Text>
              </View>
              <View style={[styles.replyAudienceRadio, replyAudience === option.value && styles.replyAudienceRadioSelected]}>
                {replyAudience === option.value ? <View style={styles.replyAudienceRadioDot} /> : null}
              </View>
            </Pressable>
          ))}
        </View>
      </Modal>
      <Modal
        visible={draftInboxVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setDraftInboxVisible(false)}
      >
        <View style={[styles.draftsModal, isDark && styles.draftsModalDark]}>
          <View style={[styles.draftsHeader, isDark && { borderBottomColor: '#27272a' }]}>
            <Pressable accessibilityRole="button" accessibilityLabel="Close drafts" onPress={() => setDraftInboxVisible(false)} style={styles.iconButton}>
              <Feather name="x" size={22} color={isDark ? '#e5e7eb' : '#111827'} />
            </Pressable>
            <Text style={[styles.draftsTitle, isDark && { color: '#f9fafb' }]}>草稿箱</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Refresh drafts" disabled={draftInboxLoading} onPress={() => { void loadDraftInbox(null, false); }} style={styles.iconButton}>
              <Feather name="refresh-cw" size={18} color={isDark ? '#e5e7eb' : '#344054'} />
            </Pressable>
          </View>
          {draftInboxError ? <Text style={styles.draftsError}>{draftInboxError}</Text> : null}
          {draftInboxLoading && draftInboxItems.length === 0 ? (
            <View style={styles.draftsEmpty}><ActivityIndicator color={PRIMARY} /><Text style={[styles.suggestionMeta, isDark && { color: '#a1a1aa' }]}>正在加载草稿…</Text></View>
          ) : (
            <FlatList
              data={draftInboxItems}
              keyExtractor={(item) => item.id}
              contentContainerStyle={draftInboxItems.length === 0 ? styles.draftsEmptyList : styles.draftsList}
              ListEmptyComponent={<Text style={[styles.draftsEmptyText, isDark && { color: '#a1a1aa' }]}>还没有保存的动态草稿。</Text>}
              renderItem={({ item }) => (
                <View style={[styles.draftItem, isDark && { borderBottomColor: '#27272a' }]}>
                  <Pressable accessibilityRole="button" onPress={() => restoreDraftFromInbox(item)} style={styles.draftItemMain}>
                    <Text numberOfLines={2} style={[styles.draftItemTitle, isDark && { color: '#f4f4f5' }]}>{item.title?.trim() || '未命名草稿'}</Text>
                    <Text style={[styles.draftItemMeta, isDark && { color: '#a1a1aa' }]}>{item.updatedAt ? new Date(item.updatedAt).toLocaleString() : ''} · {item.mediaRefs?.length ? item.mediaRefs.length + ' 个附件 · ' : ''}{item.accessMode === 'MEMBERS_ONLY' ? '会员专享' : '公开'}</Text>
                    <Text style={styles.draftRestoreLabel}>点击继续编辑</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel="Delete draft" disabled={deletingDraftId === item.id} onPress={() => removeDraftFromInbox(item)} style={styles.draftDeleteButton}>
                    {deletingDraftId === item.id ? <ActivityIndicator size="small" color="#b42318" /> : <Feather name="trash-2" size={18} color="#b42318" />}
                  </Pressable>
                </View>
              )}
              onEndReached={() => {
                if (draftInboxHasMore && !draftInboxLoading && draftInboxCursor) void loadDraftInbox(draftInboxCursor, true);
              }}
              onEndReachedThreshold={0.5}
              ListFooterComponent={draftInboxLoading && draftInboxItems.length > 0 ? <ActivityIndicator color={PRIMARY} style={{ padding: 16 }} /> : undefined}
            />
          )}
        </View>
      </Modal>
      <Modal
        visible={scheduledInboxVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setScheduledInboxVisible(false)}
      >
        <View style={[styles.draftsModal, isDark && styles.draftsModalDark]}>
          <View style={[styles.draftsHeader, isDark && { borderBottomColor: '#27272a' }]}>
            <Pressable accessibilityRole="button" accessibilityLabel="Close scheduled posts" onPress={() => setScheduledInboxVisible(false)} style={styles.iconButton}>
              <Feather name="x" size={22} color={isDark ? '#e5e7eb' : '#111827'} />
            </Pressable>
            <Text style={[styles.draftsTitle, isDark && { color: '#f9fafb' }]}>定时发布</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Refresh scheduled posts" disabled={scheduledInboxLoading} onPress={() => { void loadScheduledInbox(null, false); }} style={styles.iconButton}>
              <Feather name="refresh-cw" size={18} color={isDark ? '#e5e7eb' : '#344054'} />
            </Pressable>
          </View>
          {scheduledInboxError ? <Text style={styles.draftsError}>{scheduledInboxError}</Text> : null}
          {scheduledInboxLoading && scheduledInboxItems.length === 0 ? (
            <View style={styles.draftsEmpty}>
              <ActivityIndicator color={PRIMARY} />
              <Text style={[styles.suggestionMeta, isDark && { color: '#a1a1aa' }]}>正在加载定时动态…</Text>
            </View>
          ) : (
            <FlatList
              data={scheduledInboxItems}
              keyExtractor={(item) => item.id}
              contentContainerStyle={scheduledInboxItems.length === 0 ? styles.draftsEmptyList : styles.draftsList}
              ListEmptyComponent={
                <Text style={[styles.draftsEmptyText, isDark && { color: '#a1a1aa' }]}>
                  还没有待发布的定时动态。
                </Text>
              }
              renderItem={({ item }) => (
                <View style={[styles.scheduledItem, isDark && { borderBottomColor: '#27272a' }]}>
                  <View style={styles.scheduledItemMain}>
                    <Text numberOfLines={3} style={[styles.draftItemTitle, isDark && { color: '#f4f4f5' }]}>
                      {item.title?.trim() || '未命名动态'}
                    </Text>
                    <Text style={[styles.draftItemMeta, isDark && { color: '#a1a1aa' }]}>
                      计划于 {new Date(item.scheduledAt).toLocaleString()} 发布
                    </Text>
                    <Text style={[styles.draftItemMeta, isDark && { color: '#a1a1aa' }]}>
                      {item.mediaRefs?.length ? item.mediaRefs.length + ' 个附件 · ' : ''}
                      {item.accessMode === 'MEMBERS_ONLY' ? '会员专享' : '公开'}
                      {' · '}v{item.version}
                    </Text>
                    <View style={styles.scheduledActions}>
                      <Pressable
                        accessibilityRole="button"
                        disabled={scheduledActionId !== null}
                        onPress={() => openScheduleEditPicker(item)}
                        style={[styles.scheduledActionButton, isDark && { borderColor: '#52525b' }]}
                      >
                        <Feather name="calendar" size={14} color={PRIMARY} />
                        <Text style={styles.scheduledActionText}>修改时间</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        disabled={scheduledActionId !== null}
                        onPress={() => cancelScheduledPost(item)}
                        style={[styles.scheduledActionButton, styles.scheduledCancelButton, isDark && { borderColor: '#7f1d1d' }]}
                      >
                        {scheduledActionId === item.id
                          ? <ActivityIndicator size="small" color="#b42318" />
                          : <Feather name="x-circle" size={14} color="#b42318" />}
                        <Text style={styles.scheduledCancelText}>取消定时</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
              )}
              onEndReached={() => {
                if (scheduledInboxHasMore && !scheduledInboxLoading && scheduledInboxCursor) {
                  void loadScheduledInbox(scheduledInboxCursor, true);
                }
              }}
              onEndReachedThreshold={0.5}
              ListFooterComponent={scheduledInboxLoading && scheduledInboxItems.length > 0
                ? <ActivityIndicator color={PRIMARY} style={{ padding: 16 }} />
                : undefined}
            />
          )}
        </View>
      </Modal>
    </View>
  );
}


export default function PublishScreen() {
  return (
    <KeyboardProvider preload={false}>
      <PublishScreenContent />
    </KeyboardProvider>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#ffffff' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#d0d5dd' },
  headerTitle: { color: '#101828', fontSize: 17, fontWeight: '800' },
  iconButton: { alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 18 },
  publishButton: { minWidth: 76, alignItems: 'center', justifyContent: 'center', backgroundColor: PRIMARY, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
  publishButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
  disabledButton: { opacity: 0.55 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 36 },
  composerInput: { minHeight: 180, maxHeight: 300, color: '#101828', fontSize: 19, lineHeight: 27, paddingVertical: 8, paddingHorizontal: 0 },
  counterRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, paddingBottom: 15, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eaecf0' },
  helperText: { flex: 1, fontSize: 12, lineHeight: 17, color: '#667085' },
  counter: { fontSize: 12, color: '#667085' },
  draftSaveStatus: { color: '#667085', fontSize: 12, lineHeight: 17, marginTop: 7 },
  suggestionPanel: { marginTop: 8, marginBottom: 10, borderWidth: 1, borderColor: '#d0d5dd', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#ffffff' },
  suggestionPanelDark: { borderColor: '#3f3f46', backgroundColor: '#09090b' },
  suggestionHeading: { color: '#667085', fontSize: 11, fontWeight: '800', paddingHorizontal: 4, paddingBottom: 5 },
  suggestionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingHorizontal: 4, paddingVertical: 6 },
  suggestionTopicIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#e8f4ff' },
  suggestionName: { color: '#101828', fontSize: 13, fontWeight: '800' },
  suggestionMeta: { color: '#667085', fontSize: 11, lineHeight: 16 },
  mentionAvatar: { width: 32, height: 32, borderRadius: 16 },
  mentionAvatarFallback: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#e8f4ff' },
  draftsModal: { flex: 1, backgroundColor: '#ffffff', paddingTop: 8 },
  draftsModalDark: { backgroundColor: '#000000' },
  draftsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eaecf0' },
  draftsTitle: { color: '#101828', fontSize: 17, fontWeight: '800' },
  draftsList: { paddingHorizontal: 16, paddingBottom: 28 },
  draftsEmptyList: { flexGrow: 1, justifyContent: 'center', padding: 28 },
  draftsEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  draftsEmptyText: { color: '#667085', fontSize: 14, textAlign: 'center' },
  draftsError: { color: '#b42318', fontSize: 12, lineHeight: 18, paddingHorizontal: 16, paddingVertical: 8 },
  draftItem: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eaecf0', paddingVertical: 14, gap: 8 },
  draftItemMain: { flex: 1, gap: 4 },
  draftItemTitle: { color: '#101828', fontSize: 14, lineHeight: 20, fontWeight: '700' },
  draftItemMeta: { color: '#667085', fontSize: 11, lineHeight: 16 },
  draftRestoreLabel: { color: PRIMARY, fontSize: 11, fontWeight: '800', marginTop: 2 },
  draftDeleteButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  scheduledItem: { flexDirection: 'row', alignItems: 'flex-start', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eaecf0', paddingVertical: 14, gap: 8 },
  scheduledItemMain: { flex: 1, gap: 5 },
  scheduledActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 6 },
  scheduledActionButton: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: '#d0d5dd', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  scheduledActionText: { color: PRIMARY, fontSize: 12, fontWeight: '800' },
  scheduledCancelButton: { borderColor: '#fecdca' },
  scheduledCancelText: { color: '#b42318', fontSize: 12, fontWeight: '800' },
  accessModeSection: { paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eaecf0' },
  accessModeTitle: { color: '#101828', fontSize: 14, fontWeight: '800' },
  accessModeDescription: { color: '#667085', fontSize: 12, lineHeight: 18, marginTop: 4 },
  accessModeOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 12 },
  accessModeOption: { flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: '#d0d5dd', borderRadius: 999, paddingHorizontal: 15, paddingVertical: 9 },
  accessModeOptionSelected: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  accessModeOptionText: { color: '#344054', fontSize: 13, fontWeight: '700' },
  accessModeOptionTextSelected: { color: '#ffffff' },
  accessModeNotice: { color: '#667085', fontSize: 12, lineHeight: 18, marginTop: 10 },
  scheduleSection: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eaecf0' },
  scheduleSectionTitle: { color: '#101828', fontSize: 14, fontWeight: '800' },
  scheduleModeRow: { flexDirection: 'row', gap: 9, marginTop: 10 },
  scheduleModeOption: { borderWidth: 1, borderColor: '#d0d5dd', borderRadius: 999, paddingHorizontal: 15, paddingVertical: 9 },
  scheduleModeOptionSelected: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  scheduleModeOptionText: { color: '#344054', fontSize: 13, fontWeight: '700' },
  scheduleModeOptionTextSelected: { color: '#ffffff' },
  scheduleDateButton: { marginTop: 10, borderWidth: 1, borderColor: '#d0d5dd', borderRadius: 11, paddingHorizontal: 12, paddingVertical: 11 },
  scheduleDateButtonContent: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  scheduleDateText: { flex: 1, color: '#101828', fontSize: 13, fontWeight: '700' },
  scheduleHint: { color: '#667085', fontSize: 11, lineHeight: 16, marginTop: 8 },
  replyAudienceSection: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eaecf0' },
  replyAudienceHeading: { color: '#101828', fontSize: 14, fontWeight: '800', marginBottom: 9 },
  replyAudienceButton: { flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 44, borderWidth: 1, borderColor: '#d0d5dd', borderRadius: 11, paddingHorizontal: 12, backgroundColor: '#ffffff' },
  replyAudienceButtonText: { flex: 1, color: '#344054', fontSize: 13, fontWeight: '700' },
  replyAudienceHint: { color: '#667085', fontSize: 11, lineHeight: 16, marginTop: 7 },
  replyAudienceModal: { flex: 1, backgroundColor: '#ffffff', paddingHorizontal: 16, paddingTop: 12 },
  replyAudienceOption: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eaecf0', paddingHorizontal: 4, paddingVertical: 12 },
  replyAudienceOptionCopy: { flex: 1, gap: 4 },
  replyAudienceOptionLabel: { color: '#101828', fontSize: 14, fontWeight: '700' },
  replyAudienceOptionDescription: { color: '#667085', fontSize: 12, lineHeight: 17 },
  replyAudienceRadio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#98a2b3', alignItems: 'center', justifyContent: 'center' },
  replyAudienceRadioSelected: { borderColor: PRIMARY },
  replyAudienceRadioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: PRIMARY },
  schedulePickerModal: { flex: 1, backgroundColor: '#ffffff', paddingHorizontal: 16, paddingTop: 12 },
  schedulePickerModalDark: { backgroundColor: '#000000' },
  schedulePickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eaecf0', paddingBottom: 12 },
  schedulePickerActionHit: { minWidth: 48, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  schedulePickerTitle: { color: '#101828', fontSize: 16, fontWeight: '800' },
  schedulePickerCancel: { color: '#667085', fontSize: 14, fontWeight: '700' },
  schedulePickerConfirm: { color: PRIMARY, fontSize: 14, fontWeight: '800' },
  schedulePickerHint: { color: '#667085', fontSize: 12, lineHeight: 18, marginVertical: 12 },
  assetGrid: { width: '100%', marginTop: 12 },
  assetTile: { width: '100%', overflow: 'hidden', borderWidth: 1, borderColor: '#eaecf0', borderRadius: 14, backgroundColor: '#ffffff' },
  assetTilePreview: { width: '100%', height: 148, position: 'relative', overflow: 'hidden', backgroundColor: '#101828' },
  assetThumbnail: { width: '100%', height: '100%' },
  videoPreviewWrap: { width: '100%', height: '100%', overflow: 'hidden', backgroundColor: '#101828' },
  videoPreview: { width: '100%', height: '100%' },
  assetTileActions: { position: 'absolute', top: 8, left: 8, right: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  assetTileAction: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.58)' },
  assetTileMeta: { paddingHorizontal: 10, paddingVertical: 8 },
  assetOrderControls: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 7 },
  assetOrderButton: { width: 34, height: 30, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#d0d5dd', borderRadius: 8 },
  assetOrderLabel: { flex: 1, color: '#667085', fontSize: 11, textAlign: 'center' },
  assetName: { fontSize: 13, fontWeight: '700', color: '#344054' },
  assetStatus: { marginTop: 3, fontSize: 12, color: '#667085' },
  inlineError: { marginTop: 3, fontSize: 11, color: '#b42318', lineHeight: 15 },
  errorText: { color: '#b42318', fontSize: 13, lineHeight: 19, marginTop: 8 },
  retryLink: { alignSelf: 'flex-start', paddingTop: 7, paddingBottom: 2 },
  retryText: { color: PRIMARY, fontWeight: '700', fontSize: 12 },
  mediaActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingTop: 18, paddingBottom: 10 },
  mediaButton: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#d0d5dd', borderRadius: 999, paddingHorizontal: 15, paddingVertical: 10 },
  mediaButtonText: { color: PRIMARY, fontSize: 13, fontWeight: '800' },
  mediaLimitHint: { alignSelf: 'center', color: '#667085', fontSize: 11 },
  mediaWarningSection: { marginTop: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eaecf0', paddingBottom: 14, gap: 8 },
  mediaWarningOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  mediaWarningOption: { borderWidth: 1, borderColor: '#d0d5dd', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 13 },
  mediaWarningOptionSelected: { backgroundColor: '#e8f4ff', borderColor: PRIMARY },
  mediaWarningOptionText: { color: '#344054', fontSize: 12, fontWeight: '700' },
  mediaWarningOptionTextSelected: { color: PRIMARY },
  pollSection: { marginTop: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eaecf0', paddingBottom: 14 },
  pollToggle: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 8, borderWidth: 1, borderColor: '#d0d5dd', borderRadius: 999, paddingHorizontal: 15, paddingVertical: 10 },
  pollEditor: { marginTop: 12, padding: 12, borderWidth: 1, borderColor: '#d0d5dd', borderRadius: 14 },
  pollHelper: { fontSize: 12, lineHeight: 17, color: '#667085', marginBottom: 8 },
  pollOptionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  pollOptionInput: { flex: 1, minHeight: 42, borderWidth: 1, borderColor: '#d0d5dd', borderRadius: 9, paddingHorizontal: 10, color: '#101828', fontSize: 14 },
  pollRemoveButton: { width: 32, height: 36, alignItems: 'center', justifyContent: 'center' },
  pollAddOption: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, paddingVertical: 8 },
  pollDurationPartsRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  pollDurationPart: { flex: 1, gap: 5 },
  pollDurationPartLabel: { color: '#667085', fontSize: 11, fontWeight: '700' },
  pollDurationPartInput: { minHeight: 42, borderWidth: 1, borderColor: '#d0d5dd', borderRadius: 9, paddingHorizontal: 10, color: '#101828', fontSize: 14, textAlign: 'center' },
  pollDurationOption: { borderWidth: 1, borderColor: '#d0d5dd', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
  pollDurationSelected: { backgroundColor: '#e8f4ff', borderColor: PRIMARY },
  pollDurationText: { color: '#344054', fontSize: 12, fontWeight: '700' },
  pollDurationSelectedText: { color: PRIMARY },

  statusText: { color: '#027a48', fontSize: 13, marginTop: 10, lineHeight: 19 },
  footer: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingTop: 22 },
  footerText: { flex: 1, color: '#667085', fontSize: 12, lineHeight: 18 },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 32, backgroundColor: '#ffffff' },
  heading: { fontSize: 21, fontWeight: '800', color: '#101828', textAlign: 'center' },
  description: { color: '#667085', fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 10 },
  primaryButton: { marginTop: 18, minWidth: 130, alignItems: 'center', backgroundColor: PRIMARY, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 12 },
  primaryButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
  secondaryButton: { marginTop: 10, paddingHorizontal: 20, paddingVertical: 10 },
  secondaryButtonText: { color: PRIMARY, fontSize: 14, fontWeight: '700' },
});
