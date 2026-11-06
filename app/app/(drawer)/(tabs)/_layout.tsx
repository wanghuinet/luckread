import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentRef, ComponentType, ReactNode, RefObject } from 'react';
import { Tabs } from 'expo-router';
import { Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import Foundation from '@expo/vector-icons/Foundation';
import { useColorScheme } from 'nativewind';
import { useIsFocused } from '@react-navigation/native';
import type { SvgProps } from 'react-native-svg';
import { BlurTargetView } from 'expo-blur';
import {
  FloatingGlassTabBar,
  type TabBarIconComponent,
  type TabBarNavigation,
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
type BlurTargetRef = RefObject<ComponentRef<typeof View> | null>;

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

/**
 * One BlurTargetView per tab scene ensures Android blurs the actual active
 * screen content, not the navigator container or the floating bar itself.
 */
function TabBlurTargetScene({
  routeKey,
  onTargetChange,
  children,
}: {
  routeKey: string;
  onTargetChange: (routeKey: string, target: BlurTargetRef | null) => void;
  children: ReactNode;
}) {
  const targetRef = useRef<ComponentRef<typeof View>>(null);
  const isFocused = useIsFocused();

  useEffect(() => {
    if (!isFocused) return;
    onTargetChange(routeKey, targetRef);
    return () => onTargetChange(routeKey, null);
  }, [isFocused, onTargetChange, routeKey]);

  return (
    <BlurTargetView ref={targetRef} style={{ flex: 1 }}>
      {children}
    </BlurTargetView>
  );
}

function TabNavigator() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { tabBarTranslateY } = useTabBarScrollState();
  const [blurTargets, setBlurTargets] = useState<Map<string, BlurTargetRef>>(
    () => new Map(),
  );

  const registerBlurTarget = useCallback(
    (routeKey: string, target: BlurTargetRef | null) => {
      setBlurTargets((current) => {
        if (target && current.get(routeKey) === target) return current;
        if (!target && !current.has(routeKey)) return current;
        const next = new Map(current);
        if (target) next.set(routeKey, target);
        else next.delete(routeKey);
        return next;
      });
    },
    [],
  );

  const screenLayout = useCallback(
    ({ route, children }: { route: { key: string }; children: ReactNode }) => {
      if (Platform.OS !== 'android') return <>{children}</>;
      return (
        <TabBlurTargetScene
          routeKey={route.key}
          onTargetChange={registerBlurTarget}
        >
          {children}
        </TabBlurTargetScene>
      );
    },
    [registerBlurTarget],
  );

  // Keep LuckRead's proven full hide/reveal behavior. The upstream component
  // owns the floating glass UI; this animated style only supplies app scroll state.
  const tabBarAnimationStyle = {
    transform: [{ translateY: tabBarTranslateY }],
  } as unknown as StyleProp<ViewStyle>;

  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      screenLayout={screenLayout}
      tabBar={(props) => {
        // Preserve the existing immersive video route behavior.
        if (props.state.routes[props.state.index]?.name === '(video)') return null;

        const activeRouteKey = props.state.routes[props.state.index]?.key;
        const activeBlurTarget = activeRouteKey
          ? blurTargets.get(activeRouteKey)
          : undefined;

        // Expo Router's SDK 58 tabBar callback type omits navigation even though
        // the underlying React Navigation bar supplies it at runtime.
        const tabBarProps = props as typeof props & { navigation: TabBarNavigation };

        return (
          <FloatingGlassTabBar
            {...tabBarProps}
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
            blurProps={
              Platform.OS === 'android' && activeBlurTarget
                ? {
                    blurMethod: 'dimezisBlurViewSdk31Plus',
                    blurTarget: activeBlurTarget,
                  }
                : undefined
            }
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
