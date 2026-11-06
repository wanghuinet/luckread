import '../global.css';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { type ErrorBoundaryProps, Stack, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { QueryProvider } from '~/lib/query-provider';
import * as Notifications from 'expo-notifications';
import { useColorScheme } from 'nativewind';
import { StatusBar } from 'expo-status-bar';

import { useAuthStore } from '../store/auth-store';
import { ReplyComposerProvider } from '../components/ReplyComposerProvider';
import { NetworkStatusBanner } from '../components/NetworkStatusBanner';
import { useThemePreferenceStore } from '../lib/theme-preference-store';
import { syncPushEndpointForAuthenticatedUser } from '../lib/push-notifications';
import { PostHogDiagnosticsProvider, posthog } from '../lib/posthog';

export const unstable_settings = {
  initialRouteName: '(drawer)',
};

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const { colorScheme } = useColorScheme();

  useEffect(() => {
    posthog?.captureException(error);
  }, [error]);
  const isDark = colorScheme === 'dark';
  return (
    <View style={[styles.errorContainer, isDark && { backgroundColor: '#000000' }]}>
      <Text style={[styles.errorTitle, isDark && { color: "#f9fafb" }]}>LuckRead 页面暂时无法显示</Text>
      <Text style={[styles.errorDescription, isDark && { color: "#9ca3af" }]}>
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
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const bootstrap = useAuthStore((state) => state.bootstrap);
  const { colorScheme, setColorScheme } = useColorScheme();
  const themePreference = useThemePreferenceStore((state) => state.preference);
  const hydrateThemePreference = useThemePreferenceStore((state) => state.hydrate);
  const isDark = colorScheme === 'dark';
  const segments = useSegments();
  const router = useRouter();
  const navigationState = useRootNavigationState();
  const lastNotificationResponse = Notifications.useLastNotificationResponse();
  const handledNotificationResponseRef = useRef<string | null>(null);

  useEffect(() => {
    void bootstrap();
    const timer = setTimeout(() => setIsLoaded(true), 350);
    return () => clearTimeout(timer);
  }, [bootstrap]);

  useEffect(() => {
    let active = true;
    void hydrateThemePreference().then(() => {
      if (!active) return;
      setColorScheme(useThemePreferenceStore.getState().preference);
      setIsThemeLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [hydrateThemePreference, setColorScheme]);

  useEffect(() => {
    if (!isThemeLoaded) return;
    setColorScheme(themePreference);
  }, [isThemeLoaded, setColorScheme, themePreference]);

  useEffect(() => {
    if (status !== 'authenticated' || !userId || Platform.OS === 'web') return;

    let active = true;
    let syncInFlight = false;
    let syncQueued = false;
    let queuedDevicePushToken: Notifications.DevicePushToken | undefined;
    const syncPushEndpoint = (devicePushToken?: Notifications.DevicePushToken) => {
      if (!active) return;
      if (syncInFlight) {
        syncQueued = true;
        if (devicePushToken) queuedDevicePushToken = devicePushToken;
        return;
      }
      syncInFlight = true;
      // Permission reconciliation never displays a system prompt.
      void syncPushEndpointForAuthenticatedUser(userId, devicePushToken)
        .catch(() => undefined)
        .finally(() => {
          syncInFlight = false;
          if (active && syncQueued) {
            syncQueued = false;
            const nextDevicePushToken = queuedDevicePushToken;
            queuedDevicePushToken = undefined;
            syncPushEndpoint(nextDevicePushToken);
          }
        });
    };

    syncPushEndpoint();
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') syncPushEndpoint();
    });
    const tokenSubscription = Notifications.addPushTokenListener((devicePushToken) => {
      // Reuse the SDK's new native token instead of fetching it a second time.
      syncPushEndpoint(devicePushToken);
    });

    return () => {
      active = false;
      appStateSubscription.remove();
      tokenSubscription.remove();
    };
  }, [status, userId]);

  useEffect(() => {
    if (!lastNotificationResponse) {
      handledNotificationResponseRef.current = null;
      return;
    }
    if (!navigationState?.key || Platform.OS === 'web') return;

    const responseKey = [
      lastNotificationResponse.notification.request.identifier,
      lastNotificationResponse.actionIdentifier,
    ].join(':');
    if (handledNotificationResponseRef.current === responseKey) return;
    handledNotificationResponseRef.current = responseKey;

    const payload = lastNotificationResponse.notification.request.content.data;
    const rawNotificationId = payload?.notificationId;
    const notificationId = typeof rawNotificationId === 'string' &&
      /^[A-Za-z0-9_-]{1,128}$/.test(rawNotificationId)
      ? rawNotificationId
      : null;

    // Only the notification ID is accepted as a lookup hint. Target IDs and URLs
    // in push data are untrusted and never determine the destination.
    if (notificationId) {
      router.push({ pathname: '/notifications', params: { notificationId } } as never);
    } else {
      router.push('/notifications' as never);
    }
    Notifications.clearLastNotificationResponse();
  }, [lastNotificationResponse, navigationState?.key, router]);

  useEffect(() => {
    if (!navigationState?.key || !isLoaded || status === 'loading') return;
    const isAuthEntryRoute = ['login', 'register', 'forgot-password', 'verify-email'].includes(String(segments[0] ?? ''));
    if (status === 'authenticated' && isAuthEntryRoute) {
      router.replace('/' as never);
    }
  }, [isLoaded, navigationState?.key, router, segments, status]);

  return (
    <PostHogDiagnosticsProvider>
      <GestureHandlerRootView style={styles.flex}>
      <QueryProvider>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <BottomSheetModalProvider>
        <ReplyComposerProvider>
          <View style={styles.flex}>
          <NetworkStatusBanner />
          <Stack>
            <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
            <Stack.Screen name="login" options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="register" options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="forgot-password" options={{ headerShown: false }} />
            <Stack.Screen name="verify-email" options={{ headerShown: false }} />
            <Stack.Screen name="publish" options={{ headerShown: false, presentation: 'modal', animation: 'slide_from_bottom' }} />
          </Stack>
          {(!isLoaded || !isThemeLoaded || status === 'loading') ? (
            <View className="flex-1" style={[styles.splash, { backgroundColor: isDark ? '#080808' : '#ffffff' }]} pointerEvents="auto">
              <Text style={[styles.brand, { color: isDark ? '#ffffff' : '#111827' }]}>LuckRead</Text>
            </View>
          ) : null}
          </View>
        </ReplyComposerProvider>
      </BottomSheetModalProvider>
      </QueryProvider>
      </GestureHandlerRootView>
    </PostHogDiagnosticsProvider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  splash: {
    ...StyleSheet.absoluteFill,
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
