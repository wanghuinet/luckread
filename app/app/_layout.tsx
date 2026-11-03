import '../global.css';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { type ErrorBoundaryProps, Stack, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import * as SecureStore from 'expo-secure-store';
import { useColorScheme } from 'nativewind';
import { StatusBar } from 'expo-status-bar';

import { useAuthStore } from '../store/auth-store';
import { isThemePreference, THEME_PREFERENCE_KEY } from '../lib/theme-preference';

export const unstable_settings = {
  initialRouteName: '(drawer)',
};

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={styles.errorContainer}>
      <Text style={styles.errorTitle}>LuckRead 页面暂时无法显示</Text>
      <Text style={styles.errorDescription}>
        {error.message || '页面发生异常，请重新加载。'}
      </Text>
      <Pressable accessibilityRole="button" onPress={retry} style={styles.errorButton}>
        <Text style={styles.errorButtonText}>重新加载页面</Text>
      </Pressable>
    </View>
  );
}

export default function RootLayout() {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isThemeLoaded, setIsThemeLoaded] = useState(false);
  const status = useAuthStore((state) => state.status);
  const bootstrap = useAuthStore((state) => state.bootstrap);
  const { colorScheme, setColorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const segments = useSegments();
  const router = useRouter();
  const navigationState = useRootNavigationState();

  useEffect(() => {
    void bootstrap();
    const timer = setTimeout(() => setIsLoaded(true), 350);
    return () => clearTimeout(timer);
  }, [bootstrap]);

  useEffect(() => {
    let active = true;
    void SecureStore.getItemAsync(THEME_PREFERENCE_KEY)
      .then((savedPreference) => {
        if (active && isThemePreference(savedPreference)) setColorScheme(savedPreference);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setIsThemeLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [setColorScheme]);

  useEffect(() => {
    if (!navigationState?.key || !isLoaded || status === 'loading') return;
    const isAuthEntryRoute = ['login', 'register', 'forgot-password', 'verify-email'].includes(String(segments[0] ?? ''));
    if (status === 'authenticated' && isAuthEntryRoute) {
      router.replace('/' as never);
    }
  }, [isLoaded, navigationState?.key, router, segments, status]);

  return (
    <GestureHandlerRootView style={styles.flex}>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={isDark ? '#000000' : '#ffffff'} />
      <BottomSheetModalProvider>
        <View style={styles.flex}>
          <Stack>
            <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
            <Stack.Screen name="login" options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="register" options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="forgot-password" options={{ headerShown: false }} />
            <Stack.Screen name="verify-email" options={{ headerShown: false }} />
            <Stack.Screen name="publish" options={{ headerShown: false, presentation: 'modal', animation: 'slide_from_bottom' }} />
          </Stack>
          {(!isLoaded || !isThemeLoaded || status === 'loading') ? (
            <View className="flex-1" style={styles.splash} pointerEvents="auto">
              <Text style={styles.brand}>LuckRead</Text>
            </View>
          ) : null}
        </View>
      </BottomSheetModalProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  splash: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: '#080808',
    justifyContent: 'center',
  },
  errorContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff', paddingHorizontal: 28, paddingVertical: 32 },
  errorTitle: { color: '#101828', fontSize: 19, fontWeight: '800', textAlign: 'center' },
  errorDescription: { color: '#667085', fontSize: 14, lineHeight: 21, marginTop: 10, textAlign: 'center' },
  errorButton: { alignItems: 'center', backgroundColor: '#1769aa', borderRadius: 999, marginTop: 18, minWidth: 150, paddingHorizontal: 22, paddingVertical: 12 },
  errorButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  brand: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
});
