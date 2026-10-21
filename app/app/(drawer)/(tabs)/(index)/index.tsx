import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { DrawerActions } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Tabs, MaterialTabBar } from 'react-native-collapsible-tab-view';
import { BlurView } from 'expo-blur';

import { FeedContent, FeedItem } from '~/components/FeedItem';
import X from '~/assets/svg/aside/x.svg';
import { apiRequest, getApiErrorMessage } from '~/lib/api-client';
import { mapContentToFeedContent, readContentBody, readContentSocial, readContentAuthor, type ApiContentPage, type ApiContentRecord } from '~/lib/content-adapter';
import { useAuthStore } from '~/store/auth-store';
import { readSessionToken } from '~/lib/secure-session';

type FeedKind = 'for-you' | 'following';

type ContentPageResponse = {
  data?: ApiContentPage;
  error?: {
    code?: string;
    message?: string;
  };
};

const APP_PRIMARY_COLOR = '#1769aa';
const API_PAGE_SIZE = '20';

const Header = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const user = useAuthStore((state) => state.user);

  const openDrawer = useCallback(() => {
    // This screen is nested inside the tab navigator; the drawer action bubbles
    // to the containing drawer without coupling the screen to a route name.
    navigation.dispatch(DrawerActions.openDrawer());
  }, [navigation]);

  return (
    <View style={[styles.headerContainer, { paddingTop: insets.top }]}>
      <View style={styles.headerRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="打开导航菜单"
          onPress={openDrawer}
          style={styles.profileButton}
          hitSlop={8}
        >
          {user?.image ? (
            <Image source={{ uri: user.image }} style={styles.profileAvatar} />
          ) : (
            <Feather name="user" size={22} color="#667085" />
          )}
        </Pressable>
        <View pointerEvents="none" style={styles.headerLogoWrap}>
          <X width={28} height={28} fill="#000000" />
        </View>
        <View style={styles.headerRightSpacer} />
      </View>
    </View>
  );
};

function FeedTimeline({ kind, refreshSignal = '' }: { kind: FeedKind; refreshSignal?: string }) {
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

      const sessionToken = await readSessionToken().catch(() => null);
      const mapped = await Promise.all(
        page.items
          .filter((item): item is ApiContentRecord => Boolean(item && typeof item.id === 'string'))
          .map(async (item) => {
            const [body, social, author] = await Promise.all([
              readContentBody(item, undefined, sessionToken),
              readContentSocial(item.id),
              readContentAuthor(item),
            ]);
            return mapContentToFeedContent(item, body, social, author, sessionToken);
          }),
      );

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
  }, [loadPage, refreshKey, refreshSignal]);

  const openLogin = () => router.push('/login' as never);

  const renderItem = useCallback(({ item }: { item: FeedContent }) => (
    <FeedItem itemData={item} onDeleted={(contentId) => {
      setItems((current) => current.filter((post) => post.contentId !== contentId));
    }} onPress={() => {
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
      contentContainerStyle={{ paddingBottom: insets.bottom + 88 }}
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
  const router = useRouter();
  const params = useLocalSearchParams<{ published?: string; refresh?: string }>();
  const refreshSignal = (typeof params.published === 'string' ? params.published : '') + ':' + (typeof params.refresh === 'string' ? params.refresh : '');

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
          <FeedTimeline kind="for-you" refreshSignal={refreshSignal} />
        </Tabs.Tab>
        <Tabs.Tab name="Following">
          <FeedTimeline kind="following" refreshSignal={refreshSignal} />
        </Tabs.Tab>
      </Tabs.Container>
      <View style={{ height: Math.max(0, insets.bottom - 8) }} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="发布动态"
        onPress={() => router.push('/publish' as never)}
        style={[styles.floatingCompose, { bottom: insets.bottom + 72 }]}
      >
        <Feather name="plus" size={28} color="#ffffff" />
      </Pressable>
    </BlurView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'white', width: '100%', height: '100%' },
  headerContainer: { width: '100%', backgroundColor: 'white' },
  headerRow: { height: 48, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', position: 'relative' },
  profileButton: { width: 36, height: 36, borderRadius: 18, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f2f4f7', zIndex: 1 },
  profileAvatar: { width: 36, height: 36, borderRadius: 18 },
  headerLogoWrap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  headerRightSpacer: { width: 36, height: 36 },
  floatingCompose: { position: 'absolute', right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: APP_PRIMARY_COLOR, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000000', shadowOpacity: 0.22, shadowRadius: 5, shadowOffset: { width: 0, height: 3 }, zIndex: 20 },
  stateContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28, paddingVertical: 32 },
  stateTitle: { color: '#101828', fontSize: 18, fontWeight: '800', textAlign: 'center' },
  stateDescription: { color: '#667085', fontSize: 14, lineHeight: 21, marginTop: 10, textAlign: 'center' },
  primaryButton: { alignItems: 'center', backgroundColor: APP_PRIMARY_COLOR, borderRadius: 999, marginTop: 18, minWidth: 130, paddingHorizontal: 22, paddingVertical: 12 },
  primaryButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  loadMore: { alignItems: 'center', paddingVertical: 16 },
  loadMoreText: { color: APP_PRIMARY_COLOR, fontSize: 14, fontWeight: '700' },
  footer: { paddingVertical: 18 },
});
