import React, { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  runOnJS,
  useAnimatedReaction,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { advanceTabBarScrollState } from '~/lib/tab-bar-scroll-state';

const TAB_BAR_HIDE_DISTANCE = 128;

type TabBarScrollContextValue = {
  tabBarTranslateY: Animated.Value;
  reportScrollOffset: (offset: number) => void;
  setTabBarVisible: (visible: boolean) => void;
  resetTabBar: () => void;
};

const TabBarScrollContext = createContext<TabBarScrollContextValue | null>(null);

export function TabBarScrollProvider({ children }: { children: React.ReactNode }) {
  const tabBarTranslateY = useRef(new Animated.Value(0)).current;
  const isHiddenRef = useRef(false);
  const lastOffsetRef = useRef<number | null>(null);
  const lastDirectionRef = useRef<1 | -1 | 0>(0);
  const accumulatedDistanceRef = useRef(0);

  const setTabBarVisible = useCallback((visible: boolean) => {
    const shouldHide = !visible;
    if (isHiddenRef.current === shouldHide) return;

    isHiddenRef.current = shouldHide;
    Animated.timing(tabBarTranslateY, {
      toValue: shouldHide ? TAB_BAR_HIDE_DISTANCE : 0,
      duration: 210,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [tabBarTranslateY]);

  const resetTabBar = useCallback(() => {
    lastOffsetRef.current = null;
    lastDirectionRef.current = 0;
    accumulatedDistanceRef.current = 0;
    setTabBarVisible(true);
  }, [setTabBarVisible]);

  const reportScrollOffset = useCallback((offset: number) => {
    const transition = advanceTabBarScrollState({
      lastOffset: lastOffsetRef.current,
      direction: lastDirectionRef.current,
      accumulatedDistance: accumulatedDistanceRef.current,
    }, offset);

    lastOffsetRef.current = transition.state.lastOffset;
    lastDirectionRef.current = transition.state.direction;
    accumulatedDistanceRef.current = transition.state.accumulatedDistance;
    if (transition.visibility !== null) setTabBarVisible(transition.visibility);
  }, [setTabBarVisible]);

  const value = useMemo(() => ({
    tabBarTranslateY,
    reportScrollOffset,
    setTabBarVisible,
    resetTabBar,
  }), [reportScrollOffset, resetTabBar, setTabBarVisible, tabBarTranslateY]);

  return (
    <TabBarScrollContext.Provider value={value}>
      {children}
    </TabBarScrollContext.Provider>
  );
}

export function useTabBarScrollState(): TabBarScrollContextValue {
  const context = useContext(TabBarScrollContext);
  if (!context) {
    throw new Error('Tab bar scroll hooks must be used inside TabBarScrollProvider.');
  }
  return context;
}

/** Attach to a native ScrollView, FlatList, or FlashList screen. */
export function useTabBarScroll() {
  const { tabBarTranslateY, reportScrollOffset, resetTabBar } = useTabBarScrollState();

  useFocusEffect(useCallback(() => {
    resetTabBar();
    return resetTabBar;
  }, [resetTabBar]));

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    reportScrollOffset(event.nativeEvent.contentOffset.y);
  }, [reportScrollOffset]);

  return useMemo(() => ({
    onScroll,
    scrollEventThrottle: 16 as const,
    tabBarTranslateY,
  }), [onScroll, tabBarTranslateY]);
}

/** Observe a Reanimated scroll value without replacing the list's own scroll handler. */
export function useTabBarVisibilityOnAnimatedScroll(scrollY: SharedValue<number>) {
  const { setTabBarVisible, resetTabBar } = useTabBarScrollState();
  const lastOffset = useSharedValue<number | null>(null);
  const direction = useSharedValue<1 | -1 | 0>(0);
  const accumulatedDistance = useSharedValue(0);

  useFocusEffect(useCallback(() => {
    lastOffset.value = null;
    direction.value = 0;
    accumulatedDistance.value = 0;
    resetTabBar();
    return () => {
      lastOffset.value = null;
      direction.value = 0;
      accumulatedDistance.value = 0;
      resetTabBar();
    };
  }, [accumulatedDistance, direction, lastOffset, resetTabBar]));

  useAnimatedReaction(
    () => scrollY.value,
    (current) => {
      const transition = advanceTabBarScrollState({
        lastOffset: lastOffset.value,
        direction: direction.value,
        accumulatedDistance: accumulatedDistance.value,
      }, current);

      lastOffset.value = transition.state.lastOffset;
      direction.value = transition.state.direction;
      accumulatedDistance.value = transition.state.accumulatedDistance;
      if (transition.visibility !== null) {
        runOnJS(setTabBarVisible)(transition.visibility);
      }
    },
    [accumulatedDistance, direction, lastOffset, setTabBarVisible],
  );
}
