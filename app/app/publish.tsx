import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import { apiRequest, createIdempotencyKey } from '~/lib/api-client';
import {
  apiFailureDiagnostic,
  getMediaPlayback,
  uploadMediaFile,
  uploadTextBody,
  type LocalMediaFile,
  type UploadedMedia,
} from '~/lib/publish-api';
import { useAuthStore } from '~/store/auth-store';

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
  uploadKey?: string;
  uploaded?: UploadedMedia;
  serverUrl: string;
  playbackUrl?: string;
  status: 'uploading' | 'uploaded' | 'ready' | 'failed';
  error?: string;
  existing?: boolean;
};

type PollDurationHours = 24 | 72 | 168;

type SubmitAttempt = {
  fingerprint: string;
  contentKey: string;
  stateKey: string;
  mutationKey: string;
  pollKey: string;
};

const PRIMARY = '#1769aa';
const MAX_TEXT_LENGTH = 500;
const MAX_IMAGES = 4;
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
  if (/\.(mp4|webm|mov|m4v|avi|mkv)(?:[?#].*)?$/i.test(url)) return 'video/mp4';
  if (/\.png(?:[?#].*)?$/i.test(url)) return 'image/png';
  if (/\.webp(?:[?#].*)?$/i.test(url)) return 'image/webp';
  return 'image/jpeg';
}

export default function PublishScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ contentId?: string | string[] }>();
  const contentId = Array.isArray(params.contentId) ? params.contentId[0] : params.contentId;
  const authStatus = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);

  const [body, setBody] = useState('');
  const [accessMode, setAccessMode] = useState<'PUBLIC' | 'MEMBERS_ONLY'>('PUBLIC');
  const [assets, setAssets] = useState<ComposerAsset[]>([]);
  const [coverRef, setCoverRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(Boolean(contentId));
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [publishPending, setPublishPending] = useState(false);
  const [pollEnabled, setPollEnabled] = useState(false);
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [pollDurationHours, setPollDurationHours] = useState<PollDurationHours>(24);

  const recordRef = useRef<ContentRecord | null>(null);
  const originalAccessModeRef = useRef<'PUBLIC' | 'MEMBERS_ONLY'>('PUBLIC');
  const originalBodyRef = useRef<{ text: string; bodyRef: string | null }>({ text: '', bodyRef: null });
  const bodyUploadRef = useRef<{ text: string; key: string; uploaded?: UploadedMedia } | null>(null);
  const submitAttemptRef = useRef<SubmitAttempt | null>(null);
  const editLoadKeyRef = useRef('');

  const updateAsset = useCallback((localId: string, patch: Partial<ComposerAsset>) => {
    setAssets((current) => current.map((asset) => asset.localId === localId ? { ...asset, ...patch } : asset));
  }, []);

  const loadExistingContent = useCallback(async () => {
    if (!contentId || authStatus !== 'authenticated' || editLoadKeyRef.current === contentId) return;
    editLoadKeyRef.current = contentId;
    setLoadingEdit(true);
    setErrorMessage('');
    try {
      const result = await apiRequest<Record<string, unknown>>(
        '/contents/' + encodeURIComponent(contentId),
        { method: 'GET' },
      );
      if (!result.response.ok) {
        throw new Error(apiFailureDiagnostic(result, 'Unable to load this post for editing.'));
      }
      const record = unwrapContent(result.data);
      if (!record) throw new Error('The server returned an incomplete content record.');
      if (record.contentType !== 'post') throw new Error('Beta editing currently supports social posts only.');
      const ownerId = record.ownerUserId || record.creatorId;
      if (ownerId && user?.id && ownerId !== user.id) {
        throw new Error('You can edit only your own post.');
      }
      const etag = record.etag || result.response.headers.get('ETag') || undefined;
      if (!etag || etag === '*') {
        throw new Error('The server did not return a version for this post. Refresh it before editing.');
      }
      const loaded: ContentRecord = { ...record, etag };
      recordRef.current = loaded;
      const loadedAccessMode = record.accessMode === 'MEMBERS_ONLY' ? 'MEMBERS_ONLY' : 'PUBLIC';
      originalAccessModeRef.current = loadedAccessMode;
      setAccessMode(loadedAccessMode);
      originalBodyRef.current = { text: record.title || '', bodyRef: record.bodyRef || null };
      setBody(record.title || '');
      setCoverRef(record.coverRef || '');
      setAssets((record.mediaRefs || []).filter((url): url is string => typeof url === 'string' && /^https?:\/\//i.test(url.trim()))
        .map((url, index) => ({
          localId: 'existing-' + index + '-' + url,
          filename: url.split('/').pop() || 'Existing media',
          mimeType: mimeFromUrl(url),
          serverUrl: url,
          status: 'ready',
          existing: true,
        })));
    } catch (error) {
      editLoadKeyRef.current = '';
      setErrorMessage(error instanceof Error ? error.message : 'Unable to load this post for editing.');
    } finally {
      setLoadingEdit(false);
    }
  }, [authStatus, contentId, user?.id]);

  useEffect(() => {
    void loadExistingContent();
  }, [loadExistingContent]);

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
        };
        uploaded = await uploadMediaFile(file, asset.uploadKey);
        updateAsset(asset.localId, {
          uploaded,
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
  }, [updateAsset]);

  const pickMedia = useCallback(async (kind: 'image' | 'video') => {
    if (busy || loadingEdit || publishPending) return;
    if (kind === 'image' && assets.some(isVideoAsset)) {
      Alert.alert('Replace video first', 'Remove the selected video before adding pictures.');
      return;
    }
    if (kind === 'video' && assets.length > 0) {
      Alert.alert('Replace current media first', 'A short video must be the only media attachment in this Beta composer.');
      return;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photo access required', 'Allow LuckRead to access your photo library to attach media.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: kind === 'image' ? ImagePicker.MediaTypeOptions.Images : ImagePicker.MediaTypeOptions.Videos,
      allowsMultipleSelection: kind === 'image',
      selectionLimit: kind === 'image' ? MAX_IMAGES : 1,
      quality: 0.9,
      videoMaxDuration: 60,
    });
    if (result.canceled || !result.assets?.length) return;

    const available = kind === 'image' ? Math.max(0, MAX_IMAGES - assets.length) : 1;
    if (available === 0) {
      Alert.alert('Attachment limit', 'A post can contain up to four pictures.');
      return;
    }
    const picked = result.assets.slice(0, available);
    const newAssets: ComposerAsset[] = picked.map((asset) => {
      const localId = createIdempotencyKey();
      const video = asset.type === 'video' || kind === 'video';
      const filename = asset.fileName || (video ? 'luckread-video-' + localId + '.mp4' : 'luckread-image-' + localId + '.jpg');
      return {
        localId,
        uri: asset.uri,
        filename,
        mimeType: asset.mimeType || (video ? 'video/mp4' : 'image/jpeg'),
        size: asset.fileSize,
        uploadKey: createIdempotencyKey(),
        serverUrl: '',
        status: 'uploading',
      };
    });
    setAssets((current) => [...current, ...newAssets]);
    setErrorMessage('');
    setStatusMessage('Uploading media to LuckRead…');
    setBusy(true);
    try {
      const uploadResults: boolean[] = [];
      for (const asset of newAssets) uploadResults.push(await uploadAsset(asset));
      if (uploadResults.every(Boolean)) {
        setStatusMessage('Media upload complete. Server media references are ready to publish.');
      } else {
        setStatusMessage('Some media uploads failed. Retry failed files before publishing.');
      }
    } finally {
      setBusy(false);
    }
  }, [assets, busy, loadingEdit, publishPending, uploadAsset]);

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
    if (target && coverRef === target.serverUrl) {
      setCoverRef(nextAssets.find((asset) => asset.mimeType.startsWith('image/'))?.serverUrl || '');
    }
  }, [assets, busy, coverRef, publishPending]);

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

    const cleanPollOptions = pollEnabled
      ? pollOptions.map((option) => option.normalize('NFKC').trim())
      : [];
    if (pollEnabled) {
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

    const mediaRefs = Array.from(new Set(assets.map((asset) => asset.serverUrl)));
    const nextCover = coverRef && mediaRefs.includes(coverRef)
      ? coverRef
      : assets.find((asset) => asset.mimeType.startsWith('image/'))?.serverUrl || null;
    const fingerprint = JSON.stringify([contentId || '', trimmedBody, mediaRefs, nextCover, accessMode, pollEnabled, cleanPollOptions, pollEnabled ? pollDurationHours : null]);
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

    setBusy(true);
    setErrorMessage('');
    setStatusMessage(contentId ? 'Saving your changes…' : 'Publishing your post…');
    try {
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
        contentType: 'post',
        title: trimmedBody,
        bodyRef,
        mediaRefs,
        coverRef: nextCover,
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
        router.replace(('/?published=' + encodeURIComponent(contentId) + '&refresh=' + Date.now()) as never);
        return;
      }

      let draft = recordRef.current;
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

      if (pollEnabled && !contentId) {
        let pollResult: { response: Response; data: unknown };
        try {
          pollResult = await apiRequest<unknown>(
            '/contents/' + encodeURIComponent(draft.id) + '/poll',
            {
              method: 'POST',
              body: JSON.stringify({
                options: cleanPollOptions,
                durationHours: pollDurationHours,
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

      const transitioned = await apiRequest<Record<string, unknown>>(
        '/contents/' + encodeURIComponent(draft.id) + '/state',
        {
          method: 'POST',
          headers: { 'If-Match': draft.etag },
          body: JSON.stringify({
            to: 'PUBLISHED',
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

      submitAttemptRef.current = null;
      recordRef.current = null;
      router.replace(('/?published=' + encodeURIComponent(draft.id) + '&refresh=' + Date.now()) as never);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Publishing failed. Please retry.');
      setStatusMessage('');
    } finally {
      setBusy(false);
    }
  }, [assets, body, contentId, coverRef, pollDurationHours, pollEnabled, pollOptions, publishPending, router]);

  if (authStatus !== 'authenticated') {
    return (
      <View style={styles.centerState}>
        <Stack.Screen options={{ title: 'Create post', headerShown: false }} />
        <Text style={styles.heading}>Create a LuckRead post</Text>
        <Text style={styles.description}>Sign in to publish text, pictures, or a short video.</Text>
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
    <KeyboardAvoidingView
      style={styles.page}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
    >
      <Stack.Screen options={{ title: contentId ? 'Edit post' : 'New post', headerShown: false }} />
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close composer" onPress={() => router.back()} style={styles.iconButton}>
          <Feather name="x" size={22} color="#111827" />
        </Pressable>
        <Text style={styles.headerTitle}>{contentId ? 'Edit post' : 'New post'}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => { void submit(); }}
          disabled={busy || loadingEdit || !body.trim()}
          style={[styles.publishButton, (busy || loadingEdit || !body.trim()) && styles.disabledButton]}
        >
          {busy ? <ActivityIndicator color="#ffffff" size="small" /> : <Text style={styles.publishButtonText}>{publishPending ? 'Retry publish' : contentId ? 'Save' : 'Post'}</Text>}
        </Pressable>
      </View>

      {loadingEdit ? (
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={PRIMARY} />
          <Text style={styles.description}>Loading your post…</Text>
        </View>
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scrollContent}
        >
          <TextInput
            accessibilityLabel="Post text"
            multiline
            maxLength={MAX_TEXT_LENGTH}
            editable={!busy && !publishPending}
            placeholder="What is happening?!"
            placeholderTextColor="#667085"
            style={styles.composerInput}
            value={body}
            onChangeText={(value) => { setBody(value); setErrorMessage(''); }}
            textAlignVertical="top"
          />
          <View style={styles.counterRow}>
            <Text style={styles.helperText}>Ordinary social posts publish directly; no extra review screen.</Text>
            <Text style={styles.counter}>{body.length}/{MAX_TEXT_LENGTH}</Text>
          </View>

          {assets.map((asset) => (
            <View key={asset.localId} style={styles.assetRow}>
              {asset.mimeType.startsWith('image/') && (asset.uri || asset.playbackUrl || asset.serverUrl) ? (
                <Image source={{ uri: asset.uri || asset.playbackUrl || asset.serverUrl }} style={styles.assetThumbnail} />
              ) : (
                <View style={[styles.assetThumbnail, styles.videoThumbnail]}>
                  <Feather name="video" size={24} color={PRIMARY} />
                </View>
              )}
              <View style={styles.assetText}>
                <Text numberOfLines={1} style={styles.assetName}>{asset.filename}</Text>
                <Text style={[styles.assetStatus, asset.status === 'failed' ? styles.errorText : null]}>
                  {asset.status === 'uploading' ? 'Uploading to LuckRead…'
                    : asset.status === 'uploaded' ? 'Uploaded; playback authorization needs retry'
                      : asset.status === 'ready' ? 'Ready'
                        : 'Upload failed'}
                  {typeof asset.size === 'number' ? ' · ' + Math.round(asset.size / 1024) + ' KB' : ''}
                </Text>
                {asset.error ? <Text style={styles.inlineError}>{asset.error}</Text> : null}
                {(asset.status === 'failed' || asset.status === 'uploaded') && !asset.existing ? (
                  <Pressable disabled={busy || publishPending} onPress={() => { void retryAsset(asset); }} style={styles.retryLink}>
                    <Text style={styles.retryText}>Retry this file</Text>
                  </Pressable>
                ) : null}
              </View>
              {!asset.existing ? (
                <Pressable disabled={busy || publishPending} accessibilityLabel="Remove attachment" onPress={() => removeAsset(asset.localId)} style={styles.iconButton}>
                  <Feather name="x-circle" size={21} color="#667085" />
                </Pressable>
              ) : (
                <Pressable disabled={busy || publishPending} accessibilityLabel="Remove attachment" onPress={() => removeAsset(asset.localId)} style={styles.iconButton}>
                  <Feather name="x-circle" size={21} color="#667085" />
                </Pressable>
              )}
            </View>
          ))}

          <View style={styles.mediaActions}>
            <Pressable
              accessibilityRole="button"
              disabled={busy || loadingEdit || publishPending || assets.length >= MAX_IMAGES || assets.some(isVideoAsset)}
              style={styles.mediaButton}
              onPress={() => { void pickMedia('image'); }}
            >
              <Feather name="image" size={19} color={PRIMARY} />
              <Text style={styles.mediaButtonText}>Add pictures</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy || loadingEdit || publishPending || assets.length > 0}
              style={styles.mediaButton}
              onPress={() => { void pickMedia('video'); }}
            >
              <Feather name="video" size={19} color={PRIMARY} />
              <Text style={styles.mediaButtonText}>Add short video</Text>
            </Pressable>
          </View>

          {!contentId ? (
            <View style={styles.pollSection}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: pollEnabled, disabled: busy || loadingEdit || publishPending }}
                disabled={busy || loadingEdit || publishPending}
                onPress={() => {
                  setPollEnabled((value) => !value);
                  setErrorMessage('');
                }}
                style={styles.pollToggle}
              >
                <Feather name="bar-chart-2" size={19} color={PRIMARY} />
                <Text style={styles.mediaButtonText}>{pollEnabled ? 'Remove poll' : 'Add poll'}</Text>
              </Pressable>
              {pollEnabled ? (
                <View style={styles.pollEditor}>
                  <Text style={styles.pollHelper}>
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
                        style={styles.pollOptionInput}
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
                  <Text style={styles.pollHelper}>Poll duration</Text>
                  <View style={styles.pollDurationRow}>
                    {([24, 72, 168] as const).map((duration) => (
                      <Pressable
                        key={duration}
                        accessibilityRole="button"
                        accessibilityState={{ selected: pollDurationHours === duration, disabled: busy || publishPending }}
                        disabled={busy || publishPending}
                        onPress={() => setPollDurationHours(duration)}
                        style={[
                          styles.pollDurationOption,
                          pollDurationHours === duration && styles.pollDurationSelected,
                        ]}
                      >
                        <Text style={[
                          styles.pollDurationText,
                          pollDurationHours === duration && styles.pollDurationSelectedText,
                        ]}>
                          {duration === 24 ? '1 day' : duration === 72 ? '3 days' : '7 days'}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}
            </View>
          ) : null}

          {statusMessage ? <Text accessibilityLiveRegion="polite" style={styles.statusText}>{statusMessage}</Text> : null}
          {errorMessage ? <Text accessibilityLiveRegion="assertive" style={styles.errorText}>{errorMessage}</Text> : null}

          <View style={styles.footer}>
            <Feather name="check-circle" size={17} color="#667085" />
            <Text style={styles.footerText}>Files upload to LuckRead first. Only permanent server media URLs are attached to the post.</Text>
          </View>
        </ScrollView>
      )}
    </KeyboardAvoidingView>
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
  assetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12, padding: 10, borderWidth: 1, borderColor: '#eaecf0', borderRadius: 12 },
  assetThumbnail: { width: 58, height: 58, borderRadius: 8, backgroundColor: '#f2f4f7' },
  videoThumbnail: { alignItems: 'center', justifyContent: 'center' },
  assetText: { flex: 1, minWidth: 0 },
  assetName: { fontSize: 13, fontWeight: '700', color: '#344054' },
  assetStatus: { marginTop: 3, fontSize: 12, color: '#667085' },
  inlineError: { marginTop: 3, fontSize: 11, color: '#b42318', lineHeight: 15 },
  errorText: { color: '#b42318', fontSize: 13, lineHeight: 19, marginTop: 8 },
  retryLink: { alignSelf: 'flex-start', paddingTop: 7, paddingBottom: 2 },
  retryText: { color: PRIMARY, fontWeight: '700', fontSize: 12 },
  mediaActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingTop: 18, paddingBottom: 10 },
  mediaButton: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#d0d5dd', borderRadius: 999, paddingHorizontal: 15, paddingVertical: 10 },
  mediaButtonText: { color: PRIMARY, fontSize: 13, fontWeight: '800' },
  pollSection: { marginTop: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eaecf0', paddingBottom: 14 },
  pollToggle: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 8, borderWidth: 1, borderColor: '#d0d5dd', borderRadius: 999, paddingHorizontal: 15, paddingVertical: 10 },
  pollEditor: { marginTop: 12, padding: 12, borderWidth: 1, borderColor: '#d0d5dd', borderRadius: 14 },
  pollHelper: { fontSize: 12, lineHeight: 17, color: '#667085', marginBottom: 8 },
  pollOptionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  pollOptionInput: { flex: 1, minHeight: 42, borderWidth: 1, borderColor: '#d0d5dd', borderRadius: 9, paddingHorizontal: 10, color: '#101828', fontSize: 14 },
  pollRemoveButton: { width: 32, height: 36, alignItems: 'center', justifyContent: 'center' },
  pollAddOption: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, paddingVertical: 8 },
  pollDurationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
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
