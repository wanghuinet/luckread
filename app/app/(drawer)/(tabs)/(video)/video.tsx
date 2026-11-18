import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { FlashList, type ViewToken } from '@shopify/flash-list';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useEvent } from 'expo';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'nativewind';
import * as SecureStore from 'expo-secure-store';

import Comment from '~/assets/svg/comment.svg';
import Views from '~/assets/svg/views.svg';
import LikeButton from '~/components/LikeButton';
import FollowButton from '~/components/FollowButton';
import RepostButton from '~/components/RepostButton';
import BookmarkButton from '~/components/BookmarkButton';
import ShareButton from '~/components/ShareButton';
import {
  mapContentToFeedContent,
  readContentAuthor,
  readContentBody,
  readContentSocial,
  resolveNativeMediaSource,
  unwrapApiData,
  type ApiContentPage,
  type ApiContentRecord,
} from '~/lib/content-adapter';
import { getMediaPlayback } from '~/lib/publish-api';
import { settleVideoFeedEnrichment, type VideoPlaybackResult } from '~/lib/video-feed-enrichment';
import { readSessionToken } from '~/lib/secure-session';
import { fetchVideoFeedPage } from '~/lib/video-feed-api';
import { getApiErrorMessage } from '~/lib/api-client';
import { readVideoFeedAutoplayEnabled } from '~/lib/video-feed-autoplay-preference';
import { useAuthStore } from '~/store/auth-store';
import type { FeedContent } from '~/components/FeedItem';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const PAGE_SIZE = 12;
const PRIMARY = '#1d9bf0';

type VideoFeedItem = FeedContent & {
  contentId: string;
  videoSource: VideoPlaybackResult['source'];
  mediaError?: string;
  mediaLoading?: boolean;
  mediaSourceVersion?: number;
};

async function resolveVideoSource(
  item: ApiContentRecord,
  sessionToken: string | null,
  signal?: AbortSignal,
): Promise<VideoPlaybackResult> {
  const reference = item.mediaRefs?.find((value) => typeof value === 'string' && value.trim())?.trim();
  if (!reference) return { source: null, error: 'This video has no playable media attached.' };

  // Published media references may already be absolute URLs or same-origin delivery
  // paths. Resolve them using the existing trusted media adapter, never by guessing
  // a public R2 URL from a storage key.
  const directSource = resolveNativeMediaSource(reference, sessionToken);
  if (directSource) return { source: directSource };

  if (/^(?:r2|s3):\/\//i.test(reference)) {
    return { source: null, error: 'This video references private storage and has no public playback URL.' };
  }

  // Opaque media IDs must use the existing playback authorization endpoint.
  try {
    const playback = await getMediaPlayback(reference, signal);
    const source = resolveNativeMediaSource(playback.url, sessionToken);
    return source
      ? { source }
      : { source: null, error: 'The playback service did not return a usable video URL.' };
  } catch (cause) {
    return {
      source: null,
      error: cause instanceof Error ? cause.message : 'Unable to authorize video playback.',
    };
  }
}

function formatCount(value: number | undefined): string {
  if (value === undefined || value === null) return '0';
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1) + 'M';
  if (value >= 1_000) return (value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1) + 'K';
  return String(value);
}

function VideoPlayerSurface({
  source,
  isVisible,
  isFocused,
  muted,
  autoPlayEnabled,
  onRetry,
}: {
  source: NonNullable<VideoPlaybackResult['source']>;
  isVisible: boolean;
  isFocused: boolean;
  muted: boolean;
  autoPlayEnabled: boolean;
  onRetry: () => void;
}) {
  const player = useVideoPlayer(source, (instance) => {
    instance.loop = true;
  });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const { status, error } = useEvent(player, 'statusChange', { status: player.status });
  const [manualPlaybackOverride, setManualPlaybackOverride] = useState<'play' | 'pause' | null>(null);

  useEffect(() => {
    if (!isFocused || !isVisible) {
      player.pause();
      setManualPlaybackOverride(null);
      return;
    }

    const shouldPlay = manualPlaybackOverride === 'play' ||
      (manualPlaybackOverride === null && autoPlayEnabled);
    if (!shouldPlay) {
      player.pause();
      return;
    }

    player.muted = muted;
    try {
      player.play();
    } catch {
      // Playback can be interrupted while the user changes tabs.
    }
  }, [autoPlayEnabled, isFocused, isVisible, manualPlaybackOverride, muted, player]);

  const togglePlayPause = useCallback(() => {
    if (isPlaying) {
      setManualPlaybackOverride('pause');
      player.pause();
    } else {
      setManualPlaybackOverride('play');
      player.muted = muted;
      player.play();
    }
  }, [isPlaying, muted, player]);
  const playbackFailed = status === 'error';

  return (
    <>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? 'Pause video' : 'Play video'}
        activeOpacity={1}
        onPress={togglePlayPause}
        style={StyleSheet.absoluteFill}
      >
        <VideoView
          player={player}
          style={styles.videoPlayer}
          contentFit="cover"
          fullscreenOptions={{ enable: false }}
          allowsPictureInPicture={false}
          nativeControls={false}
        />
      </TouchableOpacity>

      {status === 'loading' ? (
        <ActivityIndicator size="large" color="#ffffff" style={styles.loadingIndicator} />
      ) : null}

      {!isPlaying && status === 'readyToPlay' && !playbackFailed ? (
        <Pressable accessibilityRole="button" onPress={togglePlayPause} style={styles.playPauseIndicator}>
          <Feather name="play" size={50} color="#ffffff" />
        </Pressable>
      ) : null}

      {status === 'error' ? (
        <View style={styles.playbackError} pointerEvents="box-none">
          <Feather name="alert-triangle" size={30} color="#ffffff" />
          <Text style={styles.unavailableMessage}>{error?.message || 'Unable to play this video.'}</Text>
          <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Retry feed</Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}

function VideoItem({
  item,
  isVisible,
  isFocused,
  muted,
  autoPlayEnabled,
  onToggleMute,
  onOpenPost,
  onRetry,
}: {
  item: VideoFeedItem;
  isVisible: boolean;
  isFocused: boolean;
  muted: boolean;
  autoPlayEnabled: boolean;
  onToggleMute: () => void;
  onOpenPost: () => void;
  onRetry: () => void;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const currentUserId = useAuthStore((state) => state.user?.id);
  const authorId = item.creatorId || item.ownerUserId;


  const openAuthor = useCallback(() => {
    const identifier = item.poster_id && item.poster_id !== 'unknown'
      ? item.poster_id
      : item.authorHandle;
    if (identifier) router.push(('/profile/' + encodeURIComponent(identifier)) as never);
  }, [item.authorHandle, item.poster_id, router]);

  return (
    <View style={styles.videoContainer}>
      {item.videoSource ? (
        <VideoPlayerSurface
          key={item.contentId + ':' + String(item.mediaSourceVersion ?? 0)}
          source={item.videoSource}
          isVisible={isVisible}
          isFocused={isFocused}
          muted={muted}
          autoPlayEnabled={autoPlayEnabled}
          onRetry={onRetry}
        />
      ) : item.mediaLoading ? (
        <View style={styles.unavailableVideo}>
          <ActivityIndicator size="large" color="#ffffff" />
          <Text style={styles.unavailableMessage}>Loading video…</Text>
        </View>
      ) : (
        <View style={styles.unavailableVideo}>
          <Feather name="video-off" size={42} color="#ffffff" />
          <Text style={styles.unavailableTitle}>Video unavailable</Text>
          <Text style={styles.unavailableMessage}>{item.mediaError || 'This post has no playable media.'}</Text>
          <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </Pressable>
        </View>
      )}

      <LinearGradient
        pointerEvents="box-none"
        colors={['rgba(0,0,0,0.26)', 'transparent', 'rgba(0,0,0,0.82)']}
        style={[styles.overlayGradient, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 18 }]}
      >
        <View style={styles.topBar}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => router.back()}
            style={styles.iconButton}
          >
            <Feather name="arrow-left" size={23} color="#ffffff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Videos</Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={muted ? 'Unmute video' : 'Mute video'}
            onPress={onToggleMute}
            style={styles.iconButton}
          >
            <Feather name={muted ? 'volume-x' : 'volume-2'} size={22} color="#ffffff" />
          </TouchableOpacity>
        </View>

        <View style={styles.bottomContent}>
          <View style={styles.authorRow}>
            <TouchableOpacity accessibilityRole="button" onPress={openAuthor} style={styles.avatarButton}>
              {item.authorImageUrl ? (
                <Image
                  source={{ uri: item.authorImageUrl, headers: item.authorImageHeaders }}
                  style={styles.avatar}
                />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Feather name="user" size={20} color="#ffffff" />
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" onPress={openAuthor} style={styles.authorText}>
              <Text numberOfLines={1} style={styles.authorName}>{item.authorName || 'LuckRead 用户'}</Text>
              <Text numberOfLines={1} style={styles.authorHandle}>
                @{item.authorHandle || 'unknown'}
              </Text>
            </TouchableOpacity>
            {authorId && authorId !== currentUserId ? <FollowButton targetUserId={authorId} /> : null}
          </View>

          {item.message ? (
            <TouchableOpacity activeOpacity={0.9} onPress={onOpenPost}>
              <Text numberOfLines={4} style={styles.videoCaption}>{item.message}</Text>
            </TouchableOpacity>
          ) : null}

          <View style={styles.engagementRow}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Open comments"
              onPress={onOpenPost}
              style={styles.engagementButton}
            >
              <Comment width={19} height={19} fill="#ffffff" />
              <Text style={styles.engagementText}>{formatCount(item.reply_count)}</Text>
            </TouchableOpacity>
            <RepostButton
              contentId={item.contentId}
              initialCount={item.retweet_count}
              iconColor="#ffffff"
              textColor="text-xs text-white"
            />
            <LikeButton
              contentId={item.contentId}
              likes={item.like_count}
              iconColor="#ffffff"
              textColor="text-xs text-white"
            />
            <View style={styles.engagementButton}>
              <Views width={19} height={19} fill="#ffffff" />
              <Text style={styles.engagementText}>{formatCount(item.view_count === undefined ? undefined : Number(item.view_count))}</Text>
            </View>
            <BookmarkButton contentId={item.contentId} iconColor="#ffffff" />
            <ShareButton contentId={item.contentId} contentText={item.message} iconColor="#ffffff" />
          </View>
        </View>
      </LinearGradient>
    </View>
  );
}

export default function VideoFeed() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const router = useRouter();
  const isFocused = useIsFocused();
  const [items, setItems] = useState<VideoFeedItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [muted, setMuted] = useState(true);
  const [autoPlayEnabled, setAutoPlayEnabled] = useState(false);
  const requestIdRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const pageControllerRef = useRef<AbortController | null>(null);
  const hydrationControllerRef = useRef<AbortController | null>(null);
  const hydrationGenerationRef = useRef(0);
  const recordsByIdRef = useRef<Map<string, ApiContentRecord>>(new Map());
  const hydratedIdsRef = useRef<Set<string>>(new Set());
  const [hydrationRetryVersion, setHydrationRetryVersion] = useState(0);

  useEffect(() => {
    if (!isFocused) return;
    let active = true;
    void readVideoFeedAutoplayEnabled(SecureStore).then((enabled) => {
      if (active) setAutoPlayEnabled(enabled);
    });
    return () => {
      active = false;
    };
  }, [isFocused]);

  const loadPage = useCallback(async (nextCursor: string | null = null, append = false) => {
    if (append && loadingMoreRef.current) return;
    const requestId = ++requestIdRef.current;
    pageControllerRef.current?.abort();
    const controller = new AbortController();
    pageControllerRef.current = controller;
    loadingMoreRef.current = append;

    if (append) setLoadingMore(true);
    else {
      hydrationControllerRef.current?.abort();
      hydrationGenerationRef.current += 1;
      hydratedIdsRef.current.clear();
      recordsByIdRef.current.clear();
      setCurrentId(null);
      setLoading(true);
    }
    setErrorMessage('');

    try {
      const result = await fetchVideoFeedPage({ cursor: nextCursor, limit: PAGE_SIZE, signal: controller.signal });
      if (requestId !== requestIdRef.current || controller.signal.aborted) return;
      const page = unwrapApiData<ApiContentPage>(result.data);
      if (!result.response.ok || !page || !Array.isArray(page.items)) {
        throw new Error(getApiErrorMessage(result.data, 'Could not load LuckRead videos.', result.response.status));
      }

      const videoRecords = page.items.filter(
        (item): item is ApiContentRecord & { id: string } =>
          Boolean(item && typeof item.id === 'string' && item.id.length > 0 && item.contentType === 'video'),
      );
      const nextRecords = append ? new Map(recordsByIdRef.current) : new Map<string, ApiContentRecord>();
      for (const record of videoRecords) nextRecords.set(record.id, record);
      recordsByIdRef.current = nextRecords;

      const visibleItems = videoRecords.flatMap((record): VideoFeedItem[] => {
        try {
          return [{
            ...mapContentToFeedContent(record, undefined, record.social, record.creator ?? record.author),
            contentId: record.id,
            videoSource: null,
            mediaLoading: false,
          }];
        } catch {
          return [];
        }
      });
      if (videoRecords.length > 0 && visibleItems.length === 0) {
        throw new Error('Videos were returned, but could not be displayed. Please retry.');
      }
      if (append) {
        setItems((current) => {
          const known = new Set(current.map((item) => item.contentId));
          return [...current, ...visibleItems.filter((item) => !known.has(item.contentId))];
        });
      } else setItems(visibleItems);

      setCurrentId((current) => append
        ? current ?? visibleItems[0]?.contentId ?? null
        : visibleItems[0]?.contentId ?? null);

      // Canonical page cursor is committed before optional enrichment begins.
      setCursor(page.nextCursor || null);
      setHasMore(page.hasMore === true);
    } catch (cause) {
      if (requestId !== requestIdRef.current || controller.signal.aborted) return;
      setErrorMessage(cause instanceof Error ? cause.message : 'Could not load LuckRead videos.');
    } finally {
      if (requestId === requestIdRef.current) {
        pageControllerRef.current = null;
        loadingMoreRef.current = false;
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
      }
    }
  }, []);

  // Only the active card performs optional reads and obtains playback authority.
  useEffect(() => {
    if (!currentId || !isFocused) {
      hydrationControllerRef.current?.abort();
      hydrationControllerRef.current = null;
      hydrationGenerationRef.current += 1;
      return;
    }
    const record = recordsByIdRef.current.get(currentId);
    if (!record || hydratedIdsRef.current.has(currentId)) return;

    hydrationControllerRef.current?.abort();
    const controller = new AbortController();
    hydrationControllerRef.current = controller;
    const generation = ++hydrationGenerationRef.current;
    setItems((current) => current.map((item) => item.contentId === currentId
      ? { ...item, mediaLoading: true, mediaError: undefined }
      : item));

    void (async () => {
      const sessionToken = await readSessionToken().catch(() => null);
      if (controller.signal.aborted || generation !== hydrationGenerationRef.current) return;
      const { body, social, author, playback } = await settleVideoFeedEnrichment(
        {
          body: () => readContentBody(record, controller.signal, sessionToken),
          social: () => readContentSocial(record.id, controller.signal),
          author: () => readContentAuthor(record, controller.signal),
          playback: () => resolveVideoSource(record, sessionToken, controller.signal),
        },
        { social: record.social ?? null, author: record.creator ?? record.author ?? null },
      );
      if (controller.signal.aborted || generation !== hydrationGenerationRef.current) return;

      const hydrated: VideoFeedItem = {
        ...mapContentToFeedContent(record, body, social, author, sessionToken),
        contentId: record.id,
        videoSource: playback.source,
        mediaError: playback.source ? undefined : playback.error || 'This video has no playable media source.',
        mediaLoading: false,
        mediaSourceVersion: generation,
      };
      hydratedIdsRef.current.add(currentId);
      setItems((current) => current.map((item) => item.contentId === currentId ? hydrated : item));
    })().catch((cause) => {
      if (controller.signal.aborted || generation !== hydrationGenerationRef.current) return;
      hydratedIdsRef.current.add(currentId);
      setItems((current) => current.map((item) => item.contentId === currentId
        ? { ...item, mediaLoading: false, mediaError: cause instanceof Error ? cause.message : 'Unable to load video details.' }
        : item));
    });

    return () => {
      controller.abort();
      if (hydrationControllerRef.current === controller) hydrationControllerRef.current = null;
    };
  }, [currentId, isFocused, hydrationRetryVersion]);
  useEffect(() => {
    void loadPage();
    return () => {
      requestIdRef.current += 1;
      pageControllerRef.current?.abort();
      hydrationControllerRef.current?.abort();
    };
  }, [loadPage]);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: Array<ViewToken<VideoFeedItem>> }) => {
      const mostVisible = viewableItems.find((token) => token.isViewable && token.item?.contentId);
      setCurrentId(mostVisible?.item?.contentId ?? null);
    },
  ).current;
  const viewabilityConfig = useMemo(() => ({ itemVisiblePercentThreshold: 65 }), []);

  const currentIndex = items.findIndex((item) => item.contentId === currentId);
  const retry = useCallback(() => {
    if (currentId) {
      hydratedIdsRef.current.delete(currentId);
      setHydrationRetryVersion((value) => value + 1);
      return;
    }
    setItems([]);
    setCursor(null);
    setCurrentId(null);
    void loadPage();
  }, [currentId, loadPage]);

  const openPost = useCallback((contentId?: string) => {
    if (contentId) router.push(('/post/' + encodeURIComponent(contentId)) as never);
  }, [router]);

  if (loading && items.length === 0) {
    return (
      <View style={[styles.stateContainer, { backgroundColor: isDark ? '#000000' : '#ffffff' }]}>
        <ActivityIndicator color={PRIMARY} size="large" />
        <Text style={[styles.stateDescription, { color: isDark ? '#9ca3af' : '#667085' }]}>Loading LuckRead videos…</Text>
      </View>
    );
  }

  if (errorMessage && items.length === 0) {
    return (
      <View style={[styles.stateContainer, { backgroundColor: isDark ? '#000000' : '#ffffff' }]}>
        <Feather name="wifi-off" size={36} color={isDark ? '#9ca3af' : '#667085'} />
        <Text style={[styles.stateTitle, { color: isDark ? '#f9fafb' : '#101828' }]}>Unable to load videos</Text>
        <Text style={[styles.stateDescription, { color: isDark ? '#9ca3af' : '#667085' }]}>{errorMessage}</Text>
        <Pressable accessibilityRole="button" onPress={retry} style={styles.retryButtonLight}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!loading && items.length === 0) {
    return (
      <View style={[styles.stateContainer, { backgroundColor: isDark ? '#000000' : '#ffffff' }]}>
        <Feather name="video" size={36} color={isDark ? '#9ca3af' : '#667085'} />
        <Text style={[styles.stateTitle, { color: isDark ? '#f9fafb' : '#101828' }]}>No videos yet</Text>
        <Text style={[styles.stateDescription, { color: isDark ? '#9ca3af' : '#667085' }]}>
          Videos published on LuckRead will appear here. Sample videos are not shown.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/publish' as never)}
          style={styles.retryButtonLight}
        >
          <Text style={styles.retryButtonText}>Publish a video</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {errorMessage ? (
        <View style={styles.inlineError}>
          <Text style={styles.inlineErrorText}>{errorMessage}</Text>
          <Pressable accessibilityRole="button" onPress={retry}>
            <Text style={styles.inlineRetryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
      <FlashList
        data={items}
        renderItem={({ item }) => (
          <VideoItem
            item={item}
            isVisible={item.contentId === currentId && currentIndex >= 0}
            isFocused={isFocused}
            muted={muted}
            autoPlayEnabled={autoPlayEnabled}
            onToggleMute={() => setMuted((value) => !value)}
            onOpenPost={() => openPost(item.contentId)}
            onRetry={retry}
          />
        )}
        keyExtractor={(item, index) => item.contentId || 'video-' + index}
        pagingEnabled
        snapToInterval={SCREEN_HEIGHT}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        onRefresh={() => {
          setRefreshing(true);
          void loadPage();
        }}
        refreshing={refreshing}
        onEndReached={() => {
          if (hasMore && cursor && !loadingMoreRef.current) void loadPage(cursor, true);
        }}
        onEndReachedThreshold={0.5}
        ListFooterComponent={loadingMore ? <ActivityIndicator color={PRIMARY} style={styles.footerLoader} /> : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  videoContainer: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  videoPlayer: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000000',
  },
  overlayGradient: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
  },
  iconButton: {
    minWidth: 42,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  bottomContent: {
    paddingBottom: 8,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarButton: { marginRight: 10 },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#394150',
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  authorText: { flex: 1, marginRight: 10 },
  authorName: { color: '#ffffff', fontWeight: '800', fontSize: 15 },
  authorHandle: { color: '#e5e7eb', fontSize: 12, marginTop: 3 },
  videoCaption: {
    color: '#ffffff',
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 14,
  },
  engagementRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 38,
  },
  engagementButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 34,
    gap: 5,
  },
  engagementText: { color: '#ffffff', fontSize: 12, fontWeight: '700', marginLeft: 3 },
  loadingIndicator: { position: 'absolute', top: '45%', alignSelf: 'center' },
  playPauseIndicator: {
    position: 'absolute',
    top: '42%',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 2,
  },
  playbackError: {
    position: 'absolute',
    top: '35%',
    left: 26,
    right: 26,
    zIndex: 4,
    alignItems: 'center',
    gap: 8,
  },
  unavailableVideo: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
    gap: 10,
    backgroundColor: '#111827',
  },
  unavailableTitle: { color: '#ffffff', fontSize: 18, fontWeight: '800' },
  unavailableMessage: { color: '#e5e7eb', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  retryButton: {
    marginTop: 6,
    borderRadius: 999,
    backgroundColor: '#ffffff',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  retryButtonText: { color: '#111827', fontWeight: '800', fontSize: 14 },
  stateContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingVertical: 32,
  },
  stateTitle: { color: '#101828', fontSize: 18, fontWeight: '800', textAlign: 'center', marginTop: 12 },
  stateDescription: { color: '#667085', fontSize: 14, lineHeight: 21, marginTop: 10, textAlign: 'center' },
  retryButtonLight: {
    marginTop: 18,
    alignItems: 'center',
    backgroundColor: PRIMARY,
    borderRadius: 999,
    minWidth: 130,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  inlineError: {
    backgroundColor: '#991b1b',
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  inlineErrorText: { flex: 1, color: '#ffffff', fontSize: 12 },
  inlineRetryText: { color: '#ffffff', fontWeight: '800', paddingLeft: 10 },
  footerLoader: { paddingVertical: 18 },
});
