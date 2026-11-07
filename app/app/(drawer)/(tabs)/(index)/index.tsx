import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Pressable,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { type ErrorBoundaryProps, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { DrawerActions } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Tabs, MaterialTabBar, useCurrentTabScrollY } from 'react-native-collapsible-tab-view';
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useTabBarScrollState, useTabBarVisibilityOnAnimatedScroll } from '~/components/TabBarScroll';
import { BlurView } from 'expo-blur';
import { useColorScheme } from 'nativewind';

import { FeedContent, FeedItem } from '~/components/FeedItem';
import X from '~/assets/svg/aside/x.svg';
import { mapContentToFeedContent, readContentBody, readContentSocial, readContentAuthor, type ApiContentRecord } from '~/lib/content-adapter';
import { fetchNativeFeedPage, incrementNativeFeedReplyCount, nativeFeedQueryKey, type NativeFeedKind, type NativeFeedPage } from '~/lib/feed-query';
import { useAuthStore } from '~/store/auth-store';
import { readSessionToken } from '~/lib/secure-session';

type FeedKind = NativeFeedKind;

const APP_PRIMARY_COLOR = '#1769aa';

function HomeScreenSurface({ children, isDark }: { children: React.ReactNode; isDark: boolean }) {
  const style = [styles.container, { backgroundColor: isDark ? '#000000' : '#ffffff' }];

  // Android's nested collapsible PagerView/FlatList tree should not be mounted
  // inside a native BlurView. Keep the existing visual treatment on iOS.
  if (Platform.OS === 'android') {
    return <View style={style} className="flex-1">{children}</View>;
  }

  return (
    <BlurView
      style={style}
      className="flex-1"
      intensity={80}
      tint={isDark ? 'dark' : 'light'}
    >
      {children}
    </BlurView>
  );
}

const Header = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const user = useAuthStore((state) => state.user);
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  const openDrawer = useCallback(() => {
    // This screen is nested inside the tab navigator; the drawer action bubbles
    // to the containing drawer without coupling the screen to a route name.
    navigation.dispatch(DrawerActions.openDrawer());
  }, [navigation]);

  return (
    <View style={[styles.headerContainer, { paddingTop: insets.top, backgroundColor: isDark ? '#000000' : '#ffffff' }]}>
      <View style={styles.headerRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="打开导航菜单"
          onPress={openDrawer}
          style={[styles.profileButton, { backgroundColor: isDark ? '#171717' : '#f2f4f7' }]}
          hitSlop={8}
        >
          {user?.image ? (
            <Image source={{ uri: user.image }} style={styles.profileAvatar} />
          ) : (
            <Feather name="user" size={22} color={isDark ? '#9ca3af' : '#667085'} />
          )}
        </Pressable>
        <View pointerEvents="none" style={styles.headerLogoWrap}>
          <X width={28} height={28} fill={isDark ? '#ffffff' : '#000000'} />
        </View>
        <View style={styles.headerRightSpacer} />
      </View>
    </View>
  );
};

function FeedTimeline({ kind, refreshSignal = '' }: { kind: FeedKind; refreshSignal?: string }) {
  const currentTabScrollY = useCurrentTabScrollY();
  useTabBarVisibilityOnAnimatedScroll(currentTabScrollY);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const authStatus = useAuthStore((state) => state.status);
  const viewerId = useAuthStore((state) => state.user?.id ?? null);
  const invalidateSession = useAuthStore((state) => state.invalidateSession);
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => nativeFeedQueryKey(kind, viewerId), [kind, viewerId]);
  const hydrationScope = kind + ':' + (viewerId || 'anonymous');

  const feedQuery = useInfiniteQuery({
    queryKey,
    enabled: kind === 'for-you' || (authStatus === 'authenticated' && Boolean(viewerId)),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => fetchNativeFeedPage({
      kind,
      cursor: pageParam,
      signal,
      invalidateSession,
    }),
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextCursor ?? undefined : undefined,
    staleTime: 30_000,
  });
  const refresh = feedQuery.refetch;

  const records = useMemo(() => {
    const known = new Set<string>();
    const result: ApiContentRecord[] = [];
    for (const page of feedQuery.data?.pages ?? []) {
      for (const item of page.items) {
        if (!known.has(item.id)) {
          known.add(item.id);
          result.push(item);
        }
      }
    }
    return result;
  }, [feedQuery.data?.pages]);

  const visibleItems = useMemo(() => records.flatMap((item) => {
    try {
      return [mapContentToFeedContent(item, undefined, item.social, item.creator ?? item.author)];
    } catch {
      // Keep other valid posts visible if one list projection is malformed.
      return [];
    }
  }), [records]);

  const [hydratedState, setHydratedState] = useState<{
    scope: string;
    byId: Record<string, FeedContent>;
  }>({ scope: hydrationScope, byId: {} });
  // For You list pages remain public/shared, but hydrated social.viewer state is viewer-specific.
  // The scope guard prevents even a one-frame flash from a previous account during switches.
  const hydratedById = hydratedState.scope === hydrationScope ? hydratedState.byId : {};
  const hydratedIdsRef = useRef<Set<string>>(new Set());
  const hydrationScopeRef = useRef(hydrationScope);
  const hydrationGenerationRef = useRef(0);
  const mountedRef = useRef(false);
  const previousRefreshSignal = useRef(refreshSignal);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      hydrationGenerationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (hydrationScopeRef.current === hydrationScope) return;
    hydrationScopeRef.current = hydrationScope;
    hydrationGenerationRef.current += 1;
    hydratedIdsRef.current.clear();
    setHydratedState({ scope: hydrationScope, byId: {} });
  }, [hydrationScope]);

  useEffect(() => {
    const pendingRecords = records.filter((item) => !hydratedIdsRef.current.has(item.id));
    if (pendingRecords.length === 0) return;

    for (const item of pendingRecords) hydratedIdsRef.current.add(item.id);
    const generation = hydrationGenerationRef.current;

    void (async () => {
      const sessionToken = await readSessionToken().catch(() => null);
      const results = await Promise.allSettled(pendingRecords.map(async (item) => {
        const [bodyResult, socialResult, authorResult] = await Promise.allSettled([
          readContentBody(item, undefined, sessionToken),
          readContentSocial(item.id),
          readContentAuthor(item),
        ]);

        const body = bodyResult.status === 'fulfilled' ? bodyResult.value : undefined;
        const social = socialResult.status === 'fulfilled' ? socialResult.value : item.social ?? null;
        const author = authorResult.status === 'fulfilled' ? authorResult.value : null;

        try {
          return mapContentToFeedContent(item, body, social, author, sessionToken);
        } catch {
          return null;
        }
      }));

      if (
        !mountedRef.current ||
        generation !== hydrationGenerationRef.current ||
        hydrationScopeRef.current !== hydrationScope
      ) return;

      const hydrated: Record<string, FeedContent> = {};
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value?.contentId) {
          hydrated[result.value.contentId] = result.value;
        }
      }
      if (Object.keys(hydrated).length > 0) {
        setHydratedState((current) => ({
          scope: hydrationScope,
          byId: {
            ...(current.scope === hydrationScope ? current.byId : {}),
            ...hydrated,
          },
        }));
      }
    })();
  }, [records, hydrationScope]);

  useEffect(() => {
    if (previousRefreshSignal.current !== refreshSignal && refreshSignal) {
      void queryClient.invalidateQueries({ queryKey });
    }
    previousRefreshSignal.current = refreshSignal;
  }, [queryClient, queryKey, refreshSignal]);

  const items = useMemo(
    () => visibleItems.map((item) => item.contentId ? hydratedById[item.contentId] ?? item : item),
    [hydratedById, visibleItems],
  );
  const authRequired = kind === 'following' && authStatus === 'anonymous';
  const waitingForFollowingIdentity = kind === 'following' && authStatus === 'authenticated' && !viewerId;
  const projectionError = records.length > 0 && visibleItems.length === 0
    ? 'Posts were returned, but could not be displayed. Please retry.'
    : '';
  const errorMessage = feedQuery.error instanceof Error
    ? feedQuery.error.message
    : projectionError;

  const openLogin = () => router.push('/login' as never);

  const loadMore = useCallback(() => {
    if (feedQuery.hasNextPage && !feedQuery.isFetchingNextPage && !feedQuery.isFetching) {
      void feedQuery.fetchNextPage();
    }
  }, [feedQuery.fetchNextPage, feedQuery.hasNextPage, feedQuery.isFetching, feedQuery.isFetchingNextPage]);

  const renderItem = useCallback(({ item }: { item: FeedContent }) => (
    <FeedItem itemData={item} onDeleted={(contentId) => {
      queryClient.setQueryData<InfiniteData<NativeFeedPage, string | null>>(queryKey, (current) => {
        if (!current) return current;
        return {
          ...current,
          pages: current.pages.map((page) => ({
            ...page,
            items: page.items.filter((post) => post.id !== contentId),
          })),
        };
      });
      setHydratedState((current) => {
        if (current.scope !== hydrationScope || !Object.prototype.hasOwnProperty.call(current.byId, contentId)) return current;
        const next = { ...current.byId };
        delete next[contentId];
        return { scope: hydrationScope, byId: next };
      });
    }} onPress={() => {
      if (item.contentId) router.push(('/post/' + encodeURIComponent(item.contentId)) as never);
    }} onReplySubmitted={(contentId) => {
      let nextReplyCount = (item.reply_count ?? 0) + 1;
      queryClient.setQueryData<InfiniteData<NativeFeedPage, string | null>>(queryKey, (current) => {
        if (!current) return current;
        return {
          ...current,
          pages: current.pages.map((page) => ({
            ...page,
            items: page.items.map((post) => {
              if (post.id !== contentId) return post;
              const updated = incrementNativeFeedReplyCount(post, item.reply_count ?? 0);
              nextReplyCount = updated.reply_count ?? nextReplyCount;
              return updated;
            }),
          })),
        };
      });
      setHydratedState((current) => {
        const currentById = current.scope === hydrationScope ? current.byId : {};
        return {
          scope: hydrationScope,
          byId: {
            ...currentById,
            [contentId]: {
              ...(currentById[contentId] ?? item),
              reply_count: nextReplyCount,
            },
          },
        };
      });
    }} />
  ), [hydrationScope, queryClient, queryKey, router]);

  const footer = useMemo(() => {
    if (feedQuery.isFetchingNextPage) {
      return <ActivityIndicator style={styles.footer} color={APP_PRIMARY_COLOR} />;
    }
    if (feedQuery.isFetchNextPageError) {
      return (
        <Pressable style={styles.loadMore} onPress={loadMore}>
          <Text style={styles.loadMoreText}>Retry loading posts</Text>
        </Pressable>
      );
    }
    if (feedQuery.isRefetchError && items.length > 0) {
      return (
        <Pressable style={styles.loadMore} onPress={() => void refresh()}>
          <Text style={styles.loadMoreText}>Refresh failed. Tap to retry.</Text>
        </Pressable>
      );
    }
    if (!feedQuery.hasNextPage || feedQuery.isPending || authRequired || errorMessage) {
      return <View style={{ height: 20 }} />;
    }
    return (
      <Pressable style={styles.loadMore} onPress={loadMore}>
        <Text style={styles.loadMoreText}>Load more</Text>
      </Pressable>
    );
  }, [
    authRequired,
    errorMessage,
    feedQuery.hasNextPage,
    feedQuery.isFetchingNextPage,
    feedQuery.isFetchNextPageError,
    feedQuery.isPending,
    feedQuery.isRefetchError,
    items.length,
    loadMore,
    refresh,
  ]);

  if (authRequired) {
    return (
      <View style={[styles.stateContainer, { backgroundColor: isDark ? '#000000' : '#ffffff' }]}>
        <Text style={[styles.stateTitle, { color: isDark ? '#f9fafb' : '#101828' }]}>Sign in to see your Following timeline</Text>
        <Text style={[styles.stateDescription, { color: isDark ? '#9ca3af' : '#667085' }]}>Your followed creators’ posts will appear here after you sign in.</Text>
        <Pressable accessibilityRole="button" onPress={openLogin} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Sign in</Text>
        </Pressable>
      </View>
    );
  }

  if ((waitingForFollowingIdentity || feedQuery.isPending) && items.length === 0) {
    return (
      <View style={[styles.stateContainer, { backgroundColor: isDark ? '#000000' : '#ffffff' }]}>
        <ActivityIndicator color={APP_PRIMARY_COLOR} size="large" />
        <Text style={[styles.stateDescription, { color: isDark ? '#9ca3af' : '#667085' }]}>Loading LuckRead posts…</Text>
      </View>
    );
  }

  if (errorMessage && items.length === 0) {
    return (
      <View style={[styles.stateContainer, { backgroundColor: isDark ? '#000000' : '#ffffff' }]}>
        <Text style={[styles.stateTitle, { color: isDark ? '#f9fafb' : '#101828' }]}>Unable to load posts</Text>
        <Text style={[styles.stateDescription, { color: isDark ? '#9ca3af' : '#667085' }]}>{errorMessage}</Text>
        <Pressable accessibilityRole="button" onPress={() => void refresh()} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!feedQuery.isPending && !errorMessage && items.length === 0) {
    return (
      <View style={[styles.stateContainer, { backgroundColor: isDark ? '#000000' : '#ffffff' }]}>
        <Text style={[styles.stateTitle, { color: isDark ? '#f9fafb' : '#101828' }]}>{kind === 'following' ? 'No posts from followed creators yet' : 'No public posts yet'}</Text>
        <Text style={[styles.stateDescription, { color: isDark ? '#9ca3af' : '#667085' }]}>
          {kind === 'following' ? 'Follow creators on LuckRead to build your timeline.' : 'Public LuckRead posts will appear here.'}
        </Text>
      </View>
    );
  }

  return (
    <Tabs.FlatList
      data={items}
      style={{ backgroundColor: isDark ? '#000000' : '#ffffff' }}
      renderItem={renderItem}
      keyExtractor={(item, index) => item.contentId || 'content-' + index}
      contentContainerStyle={{ paddingBottom: insets.bottom + 88 }}
      ListFooterComponent={footer}
      onRefresh={() => { void refresh(); }}
      refreshing={feedQuery.isRefetching}
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
    />
  );
}
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  return (
    <View style={[styles.errorBoundaryContainer, { backgroundColor: isDark ? '#000000' : '#ffffff' }]}>
      <Text style={[styles.stateTitle, { color: isDark ? '#f9fafb' : '#101828' }]}>首页暂时无法显示</Text>
      <Text style={[styles.stateDescription, { color: isDark ? '#9ca3af' : '#667085' }]}>
        {error.message || '页面发生异常，请重试。'}
      </Text>
      <Pressable accessibilityRole="button" onPress={retry} style={styles.primaryButton}>
        <Text style={styles.primaryButtonText}>重新加载首页</Text>
      </Pressable>
    </View>
  );
}

export default function HomeScreen() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ published?: string; refresh?: string }>();
  const refreshSignal = (typeof params.published === 'string' ? params.published : '') + ':' + (typeof params.refresh === 'string' ? params.refresh : '');
  const { tabBarTranslateY } = useTabBarScrollState();

  const renderTabBar = (props: any) => (
    <MaterialTabBar
      {...props}
      indicatorStyle={{ backgroundColor: APP_PRIMARY_COLOR, height: 3, borderRadius: 50 }}
      activeColor={isDark ? '#ffffff' : '#000000'}
      scrollEnabled={false}
      style={{
        paddingHorizontal: 16,
        elevation: 0,
        shadowOpacity: 0,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: isDark ? '#262626' : '#e4e7ec',
        backgroundColor: isDark ? '#000000' : '#ffffff',
      }}
      labelStyle={{
        marginHorizontal: 10,
        fontWeight: '700',
        textTransform: 'none',
        textAlign: 'center',
        fontSize: 15,
        color: isDark ? '#9ca3af' : '#475467',
      }}
    />
  );

  return (
    <HomeScreenSurface isDark={isDark}>
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
      <View style={{ height: Math.max(0, insets.bottom - 8), backgroundColor: isDark ? '#000000' : '#ffffff' }} />
      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.floatingCompose,
          { bottom: insets.bottom + 72 },
          { transform: [{ translateY: tabBarTranslateY }] },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="发布动态"
          onPress={() => router.push('/publish' as never)}
          style={styles.floatingComposeButton}
        >
          <Feather name="plus" size={28} color="#ffffff" />
        </Pressable>
      </Animated.View>
    </HomeScreenSurface>
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
  floatingCompose: { position: 'absolute', right: 20, width: 56, height: 56, zIndex: 20 },
  floatingComposeButton: { flex: 1, borderRadius: 28, backgroundColor: APP_PRIMARY_COLOR, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000000', shadowOpacity: 0.22, shadowRadius: 5, shadowOffset: { width: 0, height: 3 } },
  stateContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28, paddingVertical: 32 },
  errorBoundaryContainer: { flex: 1, backgroundColor: 'white', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28, paddingVertical: 32 },
  stateTitle: { color: '#101828', fontSize: 18, fontWeight: '800', textAlign: 'center' },
  stateDescription: { color: '#667085', fontSize: 14, lineHeight: 21, marginTop: 10, textAlign: 'center' },
  primaryButton: { alignItems: 'center', backgroundColor: APP_PRIMARY_COLOR, borderRadius: 999, marginTop: 18, minWidth: 130, paddingHorizontal: 22, paddingVertical: 12 },
  primaryButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  loadMore: { alignItems: 'center', paddingVertical: 16 },
  loadMoreText: { color: APP_PRIMARY_COLOR, fontSize: 14, fontWeight: '700' },
  footer: { paddingVertical: 18 },
});
