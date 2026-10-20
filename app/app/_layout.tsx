import '../global.css';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Stack, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';

import { useAuthStore } from '../store/auth-store';

export const unstable_settings = {
  initialRouteName: '(drawer)',
};

export default function RootLayout() {
  const [isLoaded, setIsLoaded] = useState(false);
  const status = useAuthStore((state) => state.status);
  const bootstrap = useAuthStore((state) => state.bootstrap);
  const segments = useSegments();
  const router = useRouter();
  const navigationState = useRootNavigationState();

  useEffect(() => {
    void bootstrap();
    const timer = setTimeout(() => setIsLoaded(true), 350);
    return () => clearTimeout(timer);
  }, [bootstrap]);

  useEffect(() => {
    if (!navigationState?.key || !isLoaded || status === 'loading') return;
    const isLoginRoute = segments[0] === 'login';
    if (status === 'authenticated' && isLoginRoute) {
      router.replace('/' as never);
    }
  }, [isLoaded, navigationState?.key, router, segments, status]);

  return (
    <GestureHandlerRootView style={styles.flex}>
      <BottomSheetModalProvider>
        <View style={styles.flex}>
          <Stack>
            <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
            <Stack.Screen name="login" options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="publish" options={{ headerShown: false, presentation: 'modal', animation: 'slide_from_bottom' }} />
            <Stack.Screen name="modal" options={{ title: 'Modal', presentation: 'modal' }} />
            <Stack.Screen
              name="edit-accounts"
              options={{
                headerShown: false,
                presentation: 'fullScreenModal',
                animation: 'slide_from_bottom',
              }}
            />
          </Stack>
          {(!isLoaded || status === 'loading') ? (
            <View style={styles.splash} pointerEvents="auto">
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
  brand: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
});
