import React, { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  runOnJS,
  useAnimatedReaction,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

const TAB_BAR_HIDE_DISTANCE = 128;
const HIDE_SCROLL_THRESHOLD = 18;
const SHOW_SCROLL_THRESHOLD = 12;
const TOP_RESET_OFFSET = 16;

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
    if (!Number.isFinite(offset)) return;

    if (offset <= TOP_RESET_OFFSET) {
      lastOffsetRef.current = offset;
      lastDirectionRef.current = 0;
      accumulatedDistanceRef.current = 0;
      setTabBarVisible(true);
      return;
    }

    const previousOffset = lastOffsetRef.current;
    lastOffsetRef.current = offset;
    if (previousOffset === null) return;

    const delta = offset - previousOffset;
    if (Math.abs(delta) < 0.1) return;

    const direction: 1 | -1 = delta > 0 ? 1 : -1;
    if (direction !== lastDirectionRef.current) {
      lastDirectionRef.current = direction;
      accumulatedDistanceRef.current = 0;
    }

    accumulatedDistanceRef.current += Math.abs(delta);
    const threshold = direction > 0 ? HIDE_SCROLL_THRESHOLD : SHOW_SCROLL_THRESHOLD;
    if (accumulatedDistanceRef.current < threshold) return;

    setTabBarVisible(direction < 0);
    accumulatedDistanceRef.current = 0;
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
  const direction = useSharedValue<1 | -1 | 0>(0);
  const accumulatedDistance = useSharedValue(0);
  const isHidden = useSharedValue(false);

  useFocusEffect(useCallback(() => {
    direction.value = 0;
    accumulatedDistance.value = 0;
    isHidden.value = false;
    resetTabBar();
    return () => {
      direction.value = 0;
      accumulatedDistance.value = 0;
      isHidden.value = false;
      resetTabBar();
    };
  }, [accumulatedDistance, direction, isHidden, resetTabBar]));

  useAnimatedReaction(
    () => scrollY.value,
    (current, previous) => {
      if (current <= TOP_RESET_OFFSET) {
        direction.value = 0;
        accumulatedDistance.value = 0;
        if (isHidden.value) {
          isHidden.value = false;
          runOnJS(setTabBarVisible)(true);
        }
        return;
      }

      if (previous === null) return;
      const delta = current - previous;
      if (Math.abs(delta) < 0.1) return;

      const nextDirection: 1 | -1 = delta > 0 ? 1 : -1;
      if (nextDirection !== direction.value) {
        direction.value = nextDirection;
        accumulatedDistance.value = 0;
      }
      accumulatedDistance.value += Math.abs(delta);

      const threshold = nextDirection > 0 ? HIDE_SCROLL_THRESHOLD : SHOW_SCROLL_THRESHOLD;
      if (accumulatedDistance.value < threshold) return;

      accumulatedDistance.value = 0;
      if (nextDirection > 0 && !isHidden.value) {
        isHidden.value = true;
        runOnJS(setTabBarVisible)(false);
      } else if (nextDirection < 0 && isHidden.value) {
        isHidden.value = false;
        runOnJS(setTabBarVisible)(true);
      }
    },
    [accumulatedDistance, direction, isHidden, setTabBarVisible],
  );
}
