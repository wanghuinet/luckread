import type { ComponentType } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import Foundation from '@expo/vector-icons/Foundation';
import { useColorScheme } from 'nativewind';
import type { SvgProps } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Home from '~/assets/svg/tabs/home.svg';
import FilledHome from '~/assets/svg/tabs/filled/home.svg';
import Search from '~/assets/svg/tabs/search.svg';
import FilledSearch from '~/assets/svg/tabs/filled/search.svg';
import Notifications from '~/assets/svg/tabs/notifications.svg';
import FilledNotifications from '~/assets/svg/tabs/filled/notifications.svg';
import Messages from '~/assets/svg/tabs/messages.svg';
import FilledMessages from '~/assets/svg/tabs/filled/messages.svg';
import { getXDesignColors } from '~/constants/x-design-tokens';
import { createExpoRouterTabBarNavigation } from '~/lib/expo-router-tab-bar-adapter';
import { useTabBarScrollState } from './TabBarScroll';

type SvgTabIcon = ComponentType<SvgProps>;
type TabItem = {
  routeName: string;
  accessibilityLabel: string;
  outline?: SvgTabIcon;
  filled?: SvgTabIcon;
  video?: boolean;
};

// Only expose routes that are implemented in LuckRead. Grok is not registered
// as a tab until its native conversation experience is implemented.
const TAB_ITEMS: TabItem[] = [
  { routeName: '(index)', accessibilityLabel: '首页', outline: Home, filled: FilledHome },
  { routeName: '(search)', accessibilityLabel: '搜索', outline: Search, filled: FilledSearch },
  { routeName: '(video)', accessibilityLabel: '视频', video: true },
  { routeName: '(notifications)', accessibilityLabel: '通知', outline: Notifications, filled: FilledNotifications },
  { routeName: '(messages)', accessibilityLabel: '私信', outline: Messages, filled: FilledMessages },
];

export default function XBottomTabBar(props: any) {
  const { colorScheme } = useColorScheme();
  const palette = getXDesignColors(colorScheme);
  const insets = useSafeAreaInsets();
  const { tabBarTranslateY } = useTabBarScrollState();
  const { state, emitter, navigateToTab } = props;

  // Keep the video player immersive, matching X's full-screen media behavior.
  if (state.routes[state.index]?.name === '(video)') return null;

  const navigation = createExpoRouterTabBarNavigation({
    routes: state.routes,
    emitter,
    navigateToTab,
  });

  return (
    <Animated.View
      testID="x-bottom-tab-bar"
      pointerEvents="box-none"
      style={[
        styles.container,
        {
          backgroundColor: palette.background,
          borderTopColor: palette.border,
          paddingBottom: insets.bottom,
          transform: [{ translateY: tabBarTranslateY }],
        },
      ]}
    >
      <View style={styles.row}>
        {TAB_ITEMS.map((tab) => {
          const route = state.routes.find((candidate: { name: string }) => candidate.name === tab.routeName);
          if (!route) return null;

          const isFocused = state.routes[state.index]?.key === route.key;
          const iconColor = isFocused ? palette.text : palette.muted;
          const Icon = isFocused ? tab.filled ?? tab.outline : tab.outline ?? tab.filled;

          return (
            <Pressable
              key={tab.routeName}
              testID={'tab-' + tab.routeName.replace(/[()]/g, '')}
              accessibilityRole="tab"
              accessibilityLabel={tab.accessibilityLabel}
              accessibilityState={{ selected: isFocused }}
              onPress={() => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!isFocused && !event.defaultPrevented) {
                  navigation.navigate(tab.routeName);
                }
              }}
              onLongPress={() => {
                navigation.emit({ type: 'tabLongPress', target: route.key });
              }}
              android_ripple={{ color: palette.subtle, borderless: false }}
              hitSlop={4}
              style={styles.tabButton}
            >
              <View style={styles.iconFrame}>
                {tab.video ? (
                  <Foundation name="play-circle" size={24} color={iconColor} />
                ) : Icon ? (
                  <Icon width={24} height={24} color={iconColor} />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  row: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  tabButton: {
    flex: 1,
    minWidth: 48,
    minHeight: 48,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconFrame: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
