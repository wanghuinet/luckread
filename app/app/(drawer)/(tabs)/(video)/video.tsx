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
  type ViewToken,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useEvent } from 'expo';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
import { readSessionToken } from '~/lib/secure-session';
import { fetchVideoFeedPage } from '~/lib/video-feed-api';
import { getApiErrorMessage } from '~/lib/api-client';
import { useAuthStore } from '~/store/auth-store';
import type { FeedContent } from '~/components/FeedItem';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const PAGE_SIZE = 12;
const PRIMARY = '#1d9bf0';

type NativeVideoSource = {
  uri: string;
  headers?: Record<string, string>;
};

type VideoFeedItem = FeedContent & {
  videoSource: NativeVideoSource | null;
  mediaError?: string;
};

async function resolveVideoSource(
  item: ApiContentRecord,
  sessionToken: string | null,
): Promise<{ source: NativeVideoSource | null; error?: string }> {
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
    const playback = await getMediaPlayback(reference);
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

function VideoItem({
  item,
  isVisible,
  isFocused,
  muted,
  onToggleMute,
  onOpenPost,
  onRetry,
}: {
  item: VideoFeedItem;
  isVisible: boolean;
  isFocused: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onOpenPost: () => void;
  onRetry: () => void;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const currentUserId = useAuthStore((state) => state.user?.id);
  const authorId = item.creatorId || item.ownerUserId;
  const player = useVideoPlayer(item.videoSource, (instance) => {
    instance.loop = true;
  });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const { status, error } = useEvent(player, 'statusChange', { status: player.status });

  useEffect(() => {
    if (!isFocused || !isVisible || !item.videoSource) {
      player.pause();
      return;
    }
    player.muted = muted;
    try {
      player.play();
    } catch {
      // Playback can be interrupted while the user changes tabs.
    }
  }, [isFocused, isVisible, item.videoSource, muted, player]);

  const togglePlayPause = useCallback(() => {
    if (!item.videoSource) return;
    if (isPlaying) player.pause();
    else {
      player.muted = muted;
      player.play();
    }
  }, [isPlaying, item.videoSource, muted, player]);

  const openAuthor = useCallback(() => {
    const identifier = item.poster_id && item.poster_id !== 'unknown'
      ? item.poster_id
      : item.authorHandle;
    if (identifier) router.push(('/profile/' + encodeURIComponent(identifier)) as never);
  }, [item.authorHandle, item.poster_id, router]);

  const playbackFailed = Boolean(item.mediaError) || status === 'error';

  return (
    <View style={styles.videoContainer}>
      {item.videoSource ? (
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
            allowsFullscreen={false}
            allowsPictureInPicture={false}
            nativeControls={false}
          />
        </TouchableOpacity>
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

      {item.videoSource && status === 'loading' ? (
        <ActivityIndicator size="large" color="#ffffff" style={styles.loadingIndicator} />
      ) : null}

      {item.videoSource && !isPlaying && status === 'readyToPlay' && !playbackFailed ? (
        <Pressable accessibilityRole="button" onPress={togglePlayPause} style={styles.playPauseIndicator}>
          <Feather name="play" size={50} color="#ffffff" />
        </Pressable>
      ) : null}

      {item.videoSource && status === 'error' ? (
        <View style={styles.playbackError} pointerEvents="box-none">
          <Feather name="alert-triangle" size={30} color="#ffffff" />
          <Text style={styles.unavailableMessage}>{error?.message || 'Unable to play this video.'}</Text>
          <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Retry feed</Text>
          </Pressable>
        </View>
      ) : null}

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
  const requestIdRef = useRef(0);
  const loadingMoreRef = useRef(false);

  const loadPage = useCallback(async (nextCursor: string | null = null, append = false) => {
    if (append && loadingMoreRef.current) return;
    const requestId = ++requestIdRef.current;
    loadingMoreRef.current = append;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setErrorMessage('');

    try {
      const result = await fetchVideoFeedPage({
        cursor: nextCursor,
        limit: PAGE_SIZE,
      });
      if (requestId !== requestIdRef.current) return;
      const page = unwrapApiData<ApiContentPage>(result.data);
      if (!result.response.ok || !page || !Array.isArray(page.items)) {
        throw new Error(getApiErrorMessage(result.data, 'Could not load LuckRead videos.', result.response.status));
      }

      const sessionToken = await readSessionToken().catch(() => null);
      const videoRecords = page.items.filter((item): item is ApiContentRecord =>
        Boolean(item && typeof item.id === 'string' && item.contentType === 'video'),
      );
      const mapped = await Promise.all(videoRecords.map(async (record): Promise<VideoFeedItem> => {
        const [body, social, author, playback] = await Promise.all([
          readContentBody(record, undefined, sessionToken),
          readContentSocial(record.id),
          readContentAuthor(record),
          resolveVideoSource(record, sessionToken),
        ]);
        return {
          ...mapContentToFeedContent(record, body, social, author, sessionToken),
          videoSource: playback.source,
          mediaError: playback.error,
        };
      }));
      if (requestId !== requestIdRef.current) return;

      setItems((current) => {
        if (!append) return mapped;
        const known = new Set(current.map((item) => item.contentId));
        return [...current, ...mapped.filter((item) => !known.has(item.contentId))];
      });
      setCursor(page.nextCursor || null);
      setHasMore(page.hasMore === true);
      setCurrentId((current) => current ?? mapped[0]?.contentId ?? null);
    } catch (cause) {
      if (requestId !== requestIdRef.current) return;
      setErrorMessage(cause instanceof Error ? cause.message : 'Could not load LuckRead videos.');
    } finally {
      if (requestId === requestIdRef.current) {
        loadingMoreRef.current = false;
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadPage();
    return () => {
      requestIdRef.current += 1;
    };
  }, [loadPage]);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: Array<ViewToken<VideoFeedItem>> }) => {
      const mostVisible = viewableItems.find((token) => token.isViewable && token.item?.contentId);
      if (mostVisible?.item?.contentId) setCurrentId(mostVisible.item.contentId);
    },
  ).current;
  const viewabilityConfig = useMemo(() => ({ itemVisiblePercentThreshold: 65 }), []);

  const currentIndex = items.findIndex((item) => item.contentId === currentId);
  const retry = useCallback(() => {
    setItems([]);
    setCursor(null);
    setCurrentId(null);
    void loadPage();
  }, [loadPage]);

  const openPost = useCallback((contentId?: string) => {
    if (contentId) router.push(('/post/' + encodeURIComponent(contentId)) as never);
  }, [router]);

  if (loading && items.length === 0) {
    return (
      <View style={styles.stateContainer}>
        <ActivityIndicator color={PRIMARY} size="large" />
        <Text style={styles.stateDescription}>Loading LuckRead videos…</Text>
      </View>
    );
  }

  if (errorMessage && items.length === 0) {
    return (
      <View style={styles.stateContainer}>
        <Feather name="wifi-off" size={36} color="#667085" />
        <Text style={styles.stateTitle}>Unable to load videos</Text>
        <Text style={styles.stateDescription}>{errorMessage}</Text>
        <Pressable accessibilityRole="button" onPress={retry} style={styles.retryButtonLight}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!loading && items.length === 0) {
    return (
      <View style={styles.stateContainer}>
        <Feather name="video" size={36} color="#667085" />
        <Text style={styles.stateTitle}>No videos yet</Text>
        <Text style={styles.stateDescription}>
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
            onToggleMute={() => setMuted((value) => !value)}
            onOpenPost={() => openPost(item.contentId)}
            onRetry={retry}
          />
        )}
        keyExtractor={(item, index) => item.contentId || 'video-' + index}
        estimatedItemSize={SCREEN_HEIGHT}
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
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
  },
  overlayGradient: {
    ...StyleSheet.absoluteFillObject,
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
    ...StyleSheet.absoluteFillObject,
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
