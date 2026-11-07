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
const bottomTabBarSource = readFileSync(
  new URL('../components/XBottomTabBar.tsx', import.meta.url),
  'utf8',
);
const publishScreenSource = readFileSync(new URL('../app/publish.tsx', import.meta.url), 'utf8');
const profileScreenSource = readFileSync(
  new URL('../app/(drawer)/(tabs)/(index,search,messages,grok,video,notifications)/profile/[id].tsx', import.meta.url),
  'utf8',
);

const appPackage = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

test('uses a flat X-style bottom navigation without the floating glass dependency', () => {
  expect(appPackage.dependencies['react-native-floating-glass-tabbar']).toBeUndefined();
  expect(tabLayoutSource).toContain("import XBottomTabBar from '~/components/XBottomTabBar';");
  expect(tabLayoutSource).toContain('tabBar={(props) => <XBottomTabBar {...props} />}');
  expect(bottomTabBarSource).toContain("backgroundColor: palette.background");
  expect(bottomTabBarSource).toContain('borderTopColor: palette.border');
  expect(bottomTabBarSource).toContain('position: \'absolute\'');
  expect(bottomTabBarSource).toContain('height: 56');
  expect(bottomTabBarSource).toContain('minWidth: 48');
  expect(bottomTabBarSource).toContain('accessibilityRole="tab"');
  expect(bottomTabBarSource).toContain('accessibilityState={{ selected: isFocused }}');
  expect(bottomTabBarSource).not.toContain('BlurView');
  expect(bottomTabBarSource).not.toContain('glassTint');
  expect(bottomTabBarSource).not.toContain('borderRadius');

  for (const routeName of ['(index)', '(search)', '(video)', '(notifications)', '(messages)']) {
    expect(tabLayoutSource).toContain(`name="${routeName}"`);
    expect(bottomTabBarSource).toContain(`routeName: '${routeName}'`);
  }

  // The immersive video route remains full-screen.
  expect(bottomTabBarSource).toContain("state.routes[state.index]?.name === '(video)'");
});

test('extends the flat X navigation background through device safe areas', () => {
  expect(bottomTabBarSource).toContain('bottom: 0');
  expect(bottomTabBarSource).toContain('paddingBottom: insets.bottom');
  expect(bottomTabBarSource).toContain('borderTopWidth: StyleSheet.hairlineWidth');
  expect(bottomTabBarSource).toContain('height: 56');
  expect(bottomTabBarSource).toContain('minHeight: 48');
});

test('keeps Expo Router tab scenes inside their native navigation context', () => {
  // Keep scene ownership with Expo Router and bridge only the tabPress events
  // needed by the custom native tab surface.
  expect(tabLayoutSource).toContain('tabBar={(props) => <XBottomTabBar {...props} />}');
  expect(bottomTabBarSource).toContain('createExpoRouterTabBarNavigation({');
  expect(bottomTabBarSource).toContain('state, emitter, navigateToTab');
  expect(bottomTabBarSource).toContain("type: 'tabPress'");
  expect(bottomTabBarSource).toContain("type: 'tabLongPress'");
  expect(bottomTabBarSource).toContain('navigation.navigate(tab.routeName)');
  expect(tabLayoutSource).not.toContain('screenLayout=');
  expect(tabLayoutSource).not.toContain('Platform.OS');
  expect(tabBarScrollSource).toContain("import { useFocusEffect } from 'expo-router';");
  expect(tabBarScrollSource).not.toContain("import { useFocusEffect } from '@react-navigation/native';");
});

test('uses Expo Router navigation context for composer and profile screens', () => {
  expect(publishScreenSource).toContain("import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';");
  expect(publishScreenSource).not.toContain("import { useNavigation, usePreventRemove");
  expect(profileScreenSource).toContain("import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';");
  expect(profileScreenSource).not.toContain("from '@react-navigation/native'");
});

test('does not crash tab presses when the Expo Router emitter is absent', () => {
  const navigation = createExpoRouterTabBarNavigation({
    routes: [{ key: 'search-key', name: '(search)' }],
    emitter: undefined,
    navigateToTab() {},
  });

  expect(navigation.emit({ type: 'tabPress', target: 'search-key', canPreventDefault: true })).toEqual({
    type: 'tabPress',
    defaultPrevented: false,
  });
});

test('adapts Expo Router 58 tab events to the native X-style tab bar contract', () => {
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

test('maps X-style tab route-name navigation to Expo Router route-key navigation', () => {
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

test('keeps native BlurView as an isolated background layer behind the Android home feed', () => {
  const homeScreen = readFileSync(
    new URL('../app/(drawer)/(tabs)/(index)/index.tsx', import.meta.url),
    'utf8',
  );
  const surfaceStart = homeScreen.indexOf('function HomeScreenSurface');
  const surfaceEnd = homeScreen.indexOf('const Header =', surfaceStart);
  const homeSurface = homeScreen.slice(surfaceStart, surfaceEnd);

  expect(homeScreen).toContain('<HomeScreenSurface isDark={isDark}>');
  expect(homeSurface).toContain('<View style={style} className="flex-1">');
  expect(homeSurface).toContain('<BlurView');
  expect(homeSurface).toContain('pointerEvents="none"');
  expect(homeSurface).toContain('style={StyleSheet.absoluteFill}');
  expect(homeSurface).toContain('intensity={80}');
  expect(homeSurface.indexOf('<BlurView')).toBeLessThan(homeSurface.indexOf('{children}'));
  expect(homeScreen).not.toContain("if (Platform.OS === 'android')");
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

  // Hydration is limited to cards that entered the visible list window.
  expect(homeScreen).toContain('const pendingRecords = selectVisibleFeedHydrationRecords(');
  expect(homeScreen).toContain('const visibleContentIds = hydrationTargets.scope === hydrationScope ? hydrationTargets.ids : [];');
  expect(homeScreen).toContain('onViewableItemsChanged={onViewableItemsChanged}');
  expect(homeScreen).toContain('viewabilityConfig={viewabilityConfig}');
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


test('hides and restores the X-style bottom navigation and publish action during scrolling', () => {
  const homeScreen = readFileSync(
    new URL('../app/(drawer)/(tabs)/(index)/index.tsx', import.meta.url),
    'utf8',
  );

  expect(tabLayoutSource).toContain('TabBarScrollProvider');
  expect(bottomTabBarSource).toContain('transform: [{ translateY: tabBarTranslateY }]');
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

const xDesignTokensSource = readFileSync(
  new URL('../constants/x-design-tokens.ts', import.meta.url),
  'utf8',
);
const feedItemUiSource = readFileSync(
  new URL('../components/FeedItem.tsx', import.meta.url),
  'utf8',
);
const engagementUiSource = readFileSync(
  new URL('../components/EngagementActions.tsx', import.meta.url),
  'utf8',
);
const homeUiSource = readFileSync(
  new URL('../app/(drawer)/(tabs)/(index)/index.tsx', import.meta.url),
  'utf8',
);

test('centralizes X-inspired light/dark social surface tokens and type scale', () => {
  expect(xDesignTokensSource).toContain("background: '#ffffff'");
  expect(xDesignTokensSource).toContain("background: '#000000'");
  expect(xDesignTokensSource).toContain("text: '#0f1419'");
  expect(xDesignTokensSource).toContain("text: '#e7e9ea'");
  expect(xDesignTokensSource).toContain("primary: '#1d9bf0'");
  expect(xDesignTokensSource).toContain("border: '#eff3f4'");
  expect(xDesignTokensSource).toContain("border: '#2f3336'");
  expect(xDesignTokensSource).toContain('author: 15');
  expect(xDesignTokensSource).toContain('body: 15');
  expect(xDesignTokensSource).toContain('bodyLineHeight: 20');
  expect(xDesignTokensSource).toContain('metadata: 13');
  expect(xDesignTokensSource).toContain('feedHorizontal: 12');
});

test('home feed cards use the shared compact X-style author, body and metadata scale', () => {
  const start = feedItemUiSource.indexOf('const feedCard = (');
  const end = feedItemUiSource.indexOf('\n    return (\n        <>', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const card = feedItemUiSource.slice(start, end);

  expect(feedItemUiSource).toContain("import { getXDesignColors, X_DESIGN_TOKENS } from '~/constants/x-design-tokens';");
  expect(card).toContain('paddingHorizontal: X_DESIGN_TOKENS.spacing.feedHorizontal');
  expect(card).toContain('borderBottomColor: palette.border');
  expect(card).toContain('X_DESIGN_TOKENS.typography.author');
  expect(card).toContain('X_DESIGN_TOKENS.typography.metadata');
  expect(card).toContain('X_DESIGN_TOKENS.typography.body');
  expect(card).toContain('X_DESIGN_TOKENS.typography.bodyLineHeight');
  expect(card).not.toContain('text-lg');
  expect(card).toContain('color: palette.text');
});

test('home timeline tabs use the shared X blue and neutral surface system', () => {
  expect(homeUiSource).toContain("import { getXDesignColors, X_DESIGN_TOKENS } from '~/constants/x-design-tokens';");
  expect(homeUiSource).toContain('const APP_PRIMARY_COLOR = X_DESIGN_TOKENS.colors.light.primary;');
  expect(homeUiSource).toContain('activeColor={palette.text}');
  expect(homeUiSource).toContain('borderBottomColor: palette.border');
  expect(homeUiSource).toContain('backgroundColor: palette.surface');
  expect(homeUiSource).toContain('height: 4, borderRadius: 2');
});

test('feed engagement controls use the shared muted palette and denser action typography', () => {
  expect(engagementUiSource).toContain("import { getXDesignColors } from '~/constants/x-design-tokens';");
  expect(engagementUiSource).toContain('const iconColor = palette.muted;');
  expect(engagementUiSource).toContain('text-[13px] leading-4');
  expect(engagementUiSource).toContain('justify-between mt-3');
  expect(engagementUiSource).toContain('style={{ minHeight: 36, minWidth: 36 }}');
});
