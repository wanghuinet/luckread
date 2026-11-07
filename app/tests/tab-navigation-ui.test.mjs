import { expect, test } from 'bun:test';
import { createExpoRouterTabBarNavigation } from '../lib/expo-router-tab-bar-adapter';
import { existsSync, readFileSync } from 'node:fs';

const tabLayoutSource = readFileSync(
  new URL('../app/(drawer)/(tabs)/_layout.tsx', import.meta.url),
  'utf8',
);
const upstreamGrokRoute = new URL(
  '../app/(drawer)/(tabs)/(grok)/grok.tsx',
  import.meta.url,
);

const tabBarScrollSource = readFileSync(
  new URL('../components/TabBarScroll.tsx', import.meta.url),
  'utf8',
);

const appPackage = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

test('uses the pinned upstream floating glass tab bar without replacing LuckRead routes', () => {
  expect(appPackage.dependencies['react-native-floating-glass-tabbar']).toBe('0.1.0');
  expect(tabLayoutSource).toContain("from 'react-native-floating-glass-tabbar'");
  expect(tabLayoutSource).toContain('<FloatingGlassTabBar');
  expect(tabLayoutSource).toContain('tabs={LuckReadTabs}');
  expect(tabLayoutSource).toContain('labelMode="none"');
  expect(tabLayoutSource).toContain('floatGap={10}');
  expect(tabLayoutSource).toContain('glassTint:');
  expect(tabLayoutSource).toContain('blurTint:');
  expect(tabLayoutSource).toContain('style={tabBarAnimationStyle}');

  for (const routeName of ['(index)', '(search)', '(video)', '(notifications)', '(messages)']) {
    expect(tabLayoutSource).toContain(`'${routeName}':`);
    expect(tabLayoutSource).toContain(`name="${routeName}"`);
  }

  // The immersive video route stays full-screen; all other registered routes share the glass bar.
  expect(tabLayoutSource).toContain("if (props.state.routes[props.state.index]?.name === '(video)') return null;");
});

test('uses the upstream tab-bar integration without wrapping route scenes in custom native views', () => {
  // Match the upstream Expo Router example: the tab bar receives the navigator
  // props directly; route scenes remain owned by Expo Router / React Navigation.
  expect(tabLayoutSource).toContain('tabBar={(props) => {');
  expect(tabLayoutSource).toContain('createExpoRouterTabBarNavigation({');
  expect(tabLayoutSource).toContain('emitter: props.emitter');
  expect(tabLayoutSource).toContain('navigateToTab: props.navigateToTab');
  expect(tabLayoutSource).toContain('<FloatingGlassTabBar');
  expect(tabLayoutSource).toContain('{...props}');
  expect(tabLayoutSource).toContain('navigation={navigation}');
  expect(tabLayoutSource).not.toContain('navigation: TabBarNavigation');
  expect(tabLayoutSource).not.toContain('screenLayout=');
  expect(tabLayoutSource).not.toContain('BlurTargetView');
  expect(tabLayoutSource).not.toContain('TabBlurTargetScene');
  expect(tabLayoutSource).not.toContain('blurProps=');
  expect(tabLayoutSource).not.toContain('blurTargets');
});

test('adapts Expo Router 58 tab events to the glass tab bar emitter contract', () => {
  const events = [];
  const routes = [
    { key: 'home-key', name: '(index)' },
    { key: 'search-key', name: '(search)' },
  ];
  const navigation = createExpoRouterTabBarNavigation({
    routes,
    emitter: {
      emit(event) {
        events.push(event);
        return { type: event.type, defaultPrevented: true };
      },
    },
    navigateToTab() {},
  });
  const event = { type: 'tabPress', target: 'search-key', canPreventDefault: true };

  const result = navigation.emit(event);

  expect(events).toEqual([event]);
  expect(result).toEqual({ type: 'tabPress', defaultPrevented: true });
});

test('maps glass tab route-name navigation to Expo Router route-key navigation', () => {
  const navigatedRouteKeys = [];
  const navigation = createExpoRouterTabBarNavigation({
    routes: [
      { key: 'home-key', name: '(index)' },
      { key: 'search-key', name: '(search)' },
    ],
    emitter: {
      emit(event) {
        return { type: event.type };
      },
    },
    navigateToTab(routeKey) {
      navigatedRouteKeys.push(routeKey);
    },
  });

  navigation.navigate('(search)');
  navigation.navigate('(missing)');

  expect(navigatedRouteKeys).toEqual(['search-key']);
});

test('does not mount the Android home PagerView and feed inside a native BlurView', () => {
  const homeScreen = readFileSync(
    new URL('../app/(drawer)/(tabs)/(index)/index.tsx', import.meta.url),
    'utf8',
  );

  expect(homeScreen).toContain("if (Platform.OS === 'android')");
  expect(homeScreen).toContain('<View style={style} className="flex-1">{children}</View>');
  expect(homeScreen).toContain('<HomeScreenSurface isDark={isDark}>');
  expect(homeScreen).toContain('<BlurView');
  expect(homeScreen).toContain('intensity={80}');
});

test('does not register or ship the upstream Grok demo route', () => {
  expect(tabLayoutSource).not.toContain('name="(grok)"');
  expect(existsSync(upstreamGrokRoute)).toBe(false);
});

test('keeps the five LuckRead primary tabs available', () => {
  for (const routeName of ['(index)', '(search)', '(video)', '(notifications)', '(messages)']) {
    expect(tabLayoutSource).toContain(`name="${routeName}"`);
  }
});

test('home feed renders first-page projections while optional detail hydration runs independently', () => {
  const homeScreen = readFileSync(
    new URL('../app/(drawer)/(tabs)/(index)/index.tsx', import.meta.url),
    'utf8',
  );

  // The first page is mapped directly from the W01 list projection.
  expect(homeScreen).toContain('const visibleItems = useMemo(() => records.flatMap(');
  expect(homeScreen).toContain('mapContentToFeedContent(item, undefined, item.social, item.creator ?? item.author)');
  expect(homeScreen).toContain('const items = useMemo(');
  expect(homeScreen).toContain('visibleItems.map((item) => item.contentId ? hydratedById[item.contentId] ?? item : item)');
  expect(homeScreen).toContain('<Tabs.FlatList');
  expect(homeScreen).toContain('data={items}');

  // Body, social and author reads are optional, independent enrichment.
  expect(homeScreen).toContain('const pendingRecords = records.filter((item) => !hydratedIdsRef.current.has(item.id));');
  expect(homeScreen).toContain('const results = await Promise.allSettled(pendingRecords.map(async (item) => {');
  expect(homeScreen).toContain('readContentBody(item, undefined, sessionToken)');
  expect(homeScreen).toContain('readContentSocial(item.id)');
  expect(homeScreen).toContain('readContentAuthor(item)');
  expect(homeScreen).toContain('generation !== hydrationGenerationRef.current');
  expect(homeScreen).not.toContain('setItems(visibleItems)');
  expect(homeScreen).not.toContain('!loading && !loadingMore');
});

test('home route exposes an actionable error boundary instead of an unhandled blank screen', () => {
  const homeScreen = readFileSync(
    new URL('../app/(drawer)/(tabs)/(index)/index.tsx', import.meta.url),
    'utf8',
  );

  expect(homeScreen).toContain('export function ErrorBoundary({ error, retry }: ErrorBoundaryProps)');
  expect(homeScreen).toContain('onPress={retry}');
});


test('root route boundary catches render failures across all native app pages', () => {
  const rootLayout = readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8');

  expect(rootLayout).toContain('export function ErrorBoundary({ error, retry }: ErrorBoundaryProps)');
  expect(rootLayout).toContain('LuckRead 页面暂时无法显示');
  expect(rootLayout).toContain('onPress={retry}');
});


test('hides the same floating bottom navigation and publish action on downward scroll, then restores them on upward scroll', () => {
  const homeScreen = readFileSync(
    new URL('../app/(drawer)/(tabs)/(index)/index.tsx', import.meta.url),
    'utf8',
  );

  expect(tabLayoutSource).toContain('TabBarScrollProvider');
  expect(tabLayoutSource).toContain('transform: [{ translateY: tabBarTranslateY }]');
  expect(homeScreen).toContain('transform: [{ translateY: tabBarTranslateY }]');
  expect(tabBarScrollSource).toContain('HIDE_SCROLL_THRESHOLD');
  expect(tabBarScrollSource).toContain('SHOW_SCROLL_THRESHOLD');
  expect(tabBarScrollSource).toContain('setTabBarVisible(direction < 0)');
  expect(tabBarScrollSource).toContain('duration: 210');
  expect(tabBarScrollSource).toContain('useNativeDriver: true');
});

test('connects the existing home, search, notifications, content, profile and interaction scroll containers', () => {
  const homeScreen = readFileSync(
    new URL('../app/(drawer)/(tabs)/(index)/index.tsx', import.meta.url),
    'utf8',
  );
  const searchScreen = readFileSync(
    new URL('../app/(drawer)/(tabs)/(search)/search.tsx', import.meta.url),
    'utf8',
  );
  const notificationsScreen = readFileSync(
    new URL('../app/(drawer)/(tabs)/(notifications)/notifications.tsx', import.meta.url),
    'utf8',
  );
  const postDetail = readFileSync(
    new URL('../app/(drawer)/(tabs)/(index,search,messages,grok,video,notifications)/post/[id].tsx', import.meta.url),
    'utf8',
  );
  const profile = readFileSync(
    new URL('../app/(drawer)/(tabs)/(index,search,messages,grok,video,notifications)/profile/[id].tsx', import.meta.url),
    'utf8',
  );
  const relationships = readFileSync(
    new URL('../app/(drawer)/(tabs)/(index,search,messages,grok,video,notifications)/profile/relationships/[id].tsx', import.meta.url),
    'utf8',
  );
  const interactions = readFileSync(
    new URL('../app/(drawer)/(tabs)/(index,search,messages,grok,video,notifications)/post-interactions/[id].tsx', import.meta.url),
    'utf8',
  );

  expect(homeScreen).toContain('useCurrentTabScrollY()');
  expect(homeScreen).toContain('useTabBarVisibilityOnAnimatedScroll(currentTabScrollY)');
  expect(searchScreen).toContain('onScroll={tabBarScroll.onScroll}');
  expect(notificationsScreen).toContain('onScroll={tabBarScroll.onScroll}');
  expect(postDetail).toContain('onScroll={tabBarScroll.onScroll}');
  expect(profile).toContain('useTabBarVisibilityOnAnimatedScroll(scrollOffset)');
  expect(relationships).toContain('onScroll={tabBarScroll.onScroll}');
  expect(interactions).toContain('onScroll={tabBarScroll.onScroll}');
});
