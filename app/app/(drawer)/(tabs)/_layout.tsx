import type { ComponentType } from 'react';
import { Tabs } from 'expo-router';
import { type StyleProp, type ViewStyle } from 'react-native';
import Foundation from '@expo/vector-icons/Foundation';
import { useColorScheme } from 'nativewind';
import type { SvgProps } from 'react-native-svg';
import { createExpoRouterTabBarNavigation } from '~/lib/expo-router-tab-bar-adapter';
import {
  FloatingGlassTabBar,
  type TabBarIconComponent,
  type TabsConfig,
} from 'react-native-floating-glass-tabbar';

import Home from '~/assets/svg/tabs/home.svg';
import FilledHome from '~/assets/svg/tabs/filled/home.svg';
import Search from '~/assets/svg/tabs/search.svg';
import FilledSearch from '~/assets/svg/tabs/filled/search.svg';
import Notifications from '~/assets/svg/tabs/notifications.svg';
import FilledNotifications from '~/assets/svg/tabs/filled/notifications.svg';
import Messages from '~/assets/svg/tabs/messages.svg';
import FilledMessages from '~/assets/svg/tabs/filled/messages.svg';

import { TabBarScrollProvider, useTabBarScrollState } from '~/components/TabBarScroll';

type SvgTabIcon = ComponentType<SvgProps>;
function createSvgTabIcon(outline: SvgTabIcon, filled: SvgTabIcon): TabBarIconComponent {
  return ({ color, size = 26, filled: isFilled }) => {
    const Icon = isFilled ? filled : outline;
    return <Icon width={size} height={size} color={color} />;
  };
}

const LuckReadTabs: TabsConfig = {
  '(index)': { icon: createSvgTabIcon(Home, FilledHome), label: '首页' },
  '(search)': { icon: createSvgTabIcon(Search, FilledSearch), label: '搜索' },
  '(video)': {
    icon: ({ color, size = 26 }) => (
      <Foundation name="play-circle" size={size} color={color} />
    ),
    label: '视频',
  },
  '(notifications)': {
    icon: createSvgTabIcon(Notifications, FilledNotifications),
    label: '通知',
  },
  '(messages)': {
    icon: createSvgTabIcon(Messages, FilledMessages),
    label: '私信',
  },
};

function TabNavigator() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { tabBarTranslateY } = useTabBarScrollState();
  // Keep LuckRead's proven full hide/reveal behavior. The upstream component
  // owns the floating glass UI; this animated style only supplies app scroll state.
  const tabBarAnimationStyle = {
    transform: [{ translateY: tabBarTranslateY }],
  } as unknown as StyleProp<ViewStyle>;

  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => {
        // Preserve the existing immersive video route behavior.
        if (props.state.routes[props.state.index]?.name === '(video)') return null;

        // Expo Router 58 provides emitter + route-key navigation rather than
        // the legacy React Navigation `navigation` object expected by this bar.
        const navigation = createExpoRouterTabBarNavigation({
          routes: props.state.routes,
          emitter: props.emitter,
          navigateToTab: props.navigateToTab,
        });
        return (
          <FloatingGlassTabBar
            {...props}
            navigation={navigation}
            tabs={LuckReadTabs}
            labelMode="none"
            iconSize={26}
            floatGap={10}
            theme={{
              primary: '#1d9bf0',
              iconColor: '#ffffff',
              inactiveIconColor: isDark ? '#d1d5db' : '#536471',
              background: isDark ? '#000000' : '#ffffff',
              glassTint: isDark
                ? 'rgba(28,28,30,0.78)'
                : 'rgba(255,255,255,0.82)',
              glassOpacity: 1,
              glassBorder: isDark
                ? 'rgba(255,255,255,0.14)'
                : 'rgba(15,20,25,0.12)',
              blurIntensity: 40,
              blurTint: isDark ? 'dark' : 'light',
              badgeText: '#ffffff',
              badgeRing: isDark ? '#1c1c1e' : '#ffffff',
              shadowColor: '#000000',
              shadowOpacity: isDark ? 0.28 : 0.12,
              labelColor: isDark ? '#d1d5db' : '#536471',
              activeLabelColor: '#ffffff',
            }}
            style={tabBarAnimationStyle}
          />
        );
      }}
    >
      <Tabs.Screen name="(index)" />
      <Tabs.Screen name="(search)" />
      <Tabs.Screen name="(video)" />
      <Tabs.Screen name="(notifications)" />
      <Tabs.Screen name="(messages)" />
    </Tabs>
  );
}

export default function TabLayout() {
  return (
    <TabBarScrollProvider>
      <TabNavigator />
    </TabBarScrollProvider>
  );
}
