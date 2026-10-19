import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Tabs, MaterialTabBar } from 'react-native-collapsible-tab-view';
import { BlurView } from 'expo-blur';

import { FeedContent, FeedItem } from '~/components/FeedItem';
import X from '~/assets/svg/aside/x.svg';
import { apiRequest, getApiErrorMessage } from '~/lib/api-client';
import { useAuthStore } from '~/store/auth-store';

type FeedKind = 'for-you' | 'following';

type ApiContent = {
  id: string;
  ownerUserId?: string;
  creatorId?: string | null;
  contentType?: 'article' | 'post' | 'video';
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  coverRef?: string | null;
  mediaRefs?: string[];
  author?: {
    username?: string;
    displayName?: string;
    avatar?: string | null;
  };
  creator?: {
    username?: string;
    displayName?: string;
    avatar?: string | null;
  };
};

type ContentPage = {
  items: ApiContent[];
  nextCursor?: string | null;
  hasMore?: boolean;
  candidateWindowTruncated?: boolean;
};

type ContentPageResponse = {
  data?: ContentPage;
  error?: {
    code?: string;
    message?: string;
  };
};

const APP_PRIMARY_COLOR = '#1769aa';
const API_PAGE_SIZE = '20';

const mapContent = (item: ApiContent): FeedContent => {
  const userId = item.creatorId || item.ownerUserId || 'unknown';
  const createdAt = item.createdAt || item.updatedAt;
  const parsedTime = createdAt ? Date.parse(createdAt) : Number.NaN;
  const timestampSeconds = Number.isFinite(parsedTime)
    ? Math.floor(parsedTime / 1000)
    : Math.floor(Date.now() / 1000);
  const cover = item.coverRef || item.mediaRefs?.[0] || undefined;
  const mediaUrl = cover && /^https?:\/\//i.test(cover) ? cover : undefined;
  const creator = item.creator || item.author;

  return {
    contentId: item.id,
    poster_id: userId,
    authorName: creator?.displayName || creator?.username || 'LuckRead member',
    authorHandle: creator?.username || userId.slice(0, 16),
    authorImageUrl: creator?.avatar || undefined,
    posted_time: timestampSeconds,
    message: item.title || '',
    media_url: mediaUrl,
    like_count: 0,
    retweet_count: 0,
    reply_count: 0,
    view_count: '0',
  };
};

const Header = () => {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ paddingTop: insets.top }} className="w-full bg-white">
      <View className="w-full flex-row items-center justify-center py-3">
        <X width={26} height={26} fill="black" />
        <Text style={styles.headerLabel}>LuckRead</Text>
      </View>
    </View>
  );
};

function FeedTimeline({ kind }: { kind: FeedKind }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const authStatus = useAuthStore((state) => state.status);
  const invalidateSession = useAuthStore((state) => state.invalidateSession);
  const [items, setItems] = useState<FeedContent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [candidateWindowTruncated, setCandidateWindowTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [authRequired, setAuthRequired] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const endpoint = kind === 'following' ? '/feed/following' : '/contents';

  const loadPage = useCallback(async (nextCursor: string | null, append: boolean) => {
    if (kind === 'following' && authStatus !== 'authenticated') {
      setAuthRequired(true);
      setItems([]);
      setCursor(null);
      setHasMore(false);
      setLoading(false);
      setLoadingMore(false);
      return;
    }

    if (append) setLoadingMore(true);
    else setLoading(true);
    setErrorMessage('');

    try {
      const params = new URLSearchParams({ limit: API_PAGE_SIZE });
      if (nextCursor) params.set('cursor', nextCursor);
      if (kind === 'for-you') params.set('type', 'post');

      const { response, data } = await apiRequest<ContentPageResponse>(
        endpoint + '?' + params.toString(),
        { method: 'GET' },
      );

      if (response.status === 401 && kind === 'following') {
        if (authStatus === 'authenticated') await invalidateSession();
        setAuthRequired(true);
        setItems([]);
        setCursor(null);
        setHasMore(false);
        return;
      }

      const payload = data as ContentPageResponse | null;
      const page = payload?.data;
      if (!response.ok || !page || !Array.isArray(page.items)) {
        throw new Error(getApiErrorMessage(data, 'Could not load this timeline. Please retry.'));
      }

      const mapped = page.items
        .filter((item): item is ApiContent => Boolean(item && typeof item.id === 'string'))
        .map(mapContent);

      if (append) {
        setItems((current) => {
          const known = new Set(current.map((item) => item.contentId));
          return [...current, ...mapped.filter((item) => !known.has(item.contentId))];
        });
      } else {
        setItems(mapped);
      }

      setCursor(page.nextCursor || null);
      setHasMore(page.hasMore === true);
      setCandidateWindowTruncated(page.candidateWindowTruncated === true);
      setAuthRequired(false);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Could not load this timeline. Please retry.',
      );
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [authStatus, endpoint, invalidateSession, kind]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadPage(null, false);
    });
    return () => {
      active = false;
    };
  }, [loadPage, refreshKey]);

  const openLogin = () => router.push('/login' as never);

  const renderItem = useCallback(({ item }: { item: FeedContent }) => (
    <FeedItem itemData={item} onPress={() => {
      if (item.contentId) router.push(('/post/' + encodeURIComponent(item.contentId)) as never);
    }} />
  ), [router]);

  const footer = useMemo(() => {
    if (loadingMore) return <ActivityIndicator style={styles.footer} color={APP_PRIMARY_COLOR} />;
    if (!hasMore || loading || authRequired || errorMessage) return <View style={{ height: 20 }} />;
    return (
      <Pressable style={styles.loadMore} onPress={() => void loadPage(cursor, true)}>
        <Text style={styles.loadMoreText}>Load more</Text>
      </Pressable>
    );
  }, [authRequired, cursor, errorMessage, hasMore, loadPage, loading, loadingMore]);

  if (authRequired) {
    return (
      <View style={styles.stateContainer}>
        <Text style={styles.stateTitle}>Sign in to see your Following timeline</Text>
        <Text style={styles.stateDescription}>Your followed creators’ posts will appear here after you sign in.</Text>
        <Pressable accessibilityRole="button" onPress={openLogin} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Sign in</Text>
        </Pressable>
      </View>
    );
  }

  if (loading && items.length === 0) {
    return (
      <View style={styles.stateContainer}>
        <ActivityIndicator color={APP_PRIMARY_COLOR} size="large" />
        <Text style={styles.stateDescription}>Loading LuckRead posts…</Text>
      </View>
    );
  }

  if (errorMessage && items.length === 0) {
    return (
      <View style={styles.stateContainer}>
        <Text style={styles.stateTitle}>Unable to load posts</Text>
        <Text style={styles.stateDescription}>{errorMessage}</Text>
        <Pressable accessibilityRole="button" onPress={() => setRefreshKey((value) => value + 1)} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!loading && !errorMessage && items.length === 0) {
    return (
      <View style={styles.stateContainer}>
        <Text style={styles.stateTitle}>{kind === 'following' ? 'No posts from followed creators yet' : 'No public posts yet'}</Text>
        <Text style={styles.stateDescription}>
          {kind === 'following' ? 'Follow creators on LuckRead to build your timeline.' : 'Public LuckRead posts will appear here.'}
        </Text>
      </View>
    );
  }

  return (
    <Tabs.FlatList
      data={items}
      renderItem={renderItem}
      keyExtractor={(item, index) => item.contentId || 'content-' + index}
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      ListFooterComponent={footer}
      onRefresh={() => setRefreshKey((value) => value + 1)}
      refreshing={loading && items.length > 0}
      onEndReached={() => {
        if (hasMore && cursor && !loadingMore && !errorMessage) void loadPage(cursor, true);
      }}
      onEndReachedThreshold={0.5}
    />
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();

  const renderTabBar = (props: any) => (
    <MaterialTabBar
      {...props}
      indicatorStyle={{ backgroundColor: APP_PRIMARY_COLOR, height: 3, borderRadius: 50 }}
      activeColor="black"
      scrollEnabled={false}
      style={{
        paddingHorizontal: 16,
        elevation: 0,
        shadowOpacity: 0,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: '#e4e7ec',
        backgroundColor: 'white',
      }}
      labelStyle={{
        marginHorizontal: 10,
        fontWeight: '700',
        textTransform: 'none',
        textAlign: 'center',
        fontSize: 15,
        color: '#475467',
      }}
    />
  );

  return (
    <BlurView style={styles.container} className="flex-1" intensity={80} tint="light">
      <Tabs.Container
        renderHeader={Header}
        renderTabBar={renderTabBar}
        pagerProps={{ scrollEnabled: true }}
        initialTabName="For you"
        minHeaderHeight={-60}
        revealHeaderOnScroll
        headerContainerStyle={{
          backgroundColor: 'transparent',
          elevation: 0,
          shadowOpacity: 0,
        }}
      >
        <Tabs.Tab name="For you">
          <FeedTimeline kind="for-you" />
        </Tabs.Tab>
        <Tabs.Tab name="Following">
          <FeedTimeline kind="following" />
        </Tabs.Tab>
      </Tabs.Container>
      <View style={{ height: Math.max(0, insets.bottom - 8) }} />
    </BlurView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'white', width: '100%', height: '100%' },
  headerLabel: { color: '#101828', fontSize: 12, fontWeight: '800', marginLeft: 8 },
  stateContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28, paddingVertical: 32 },
  stateTitle: { color: '#101828', fontSize: 18, fontWeight: '800', textAlign: 'center' },
  stateDescription: { color: '#667085', fontSize: 14, lineHeight: 21, marginTop: 10, textAlign: 'center' },
  primaryButton: { alignItems: 'center', backgroundColor: APP_PRIMARY_COLOR, borderRadius: 999, marginTop: 18, minWidth: 130, paddingHorizontal: 22, paddingVertical: 12 },
  primaryButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  loadMore: { alignItems: 'center', paddingVertical: 16 },
  loadMoreText: { color: APP_PRIMARY_COLOR, fontSize: 14, fontWeight: '700' },
  footer: { paddingVertical: 18 },
});
