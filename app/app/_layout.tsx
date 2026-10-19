import '../global.css';
import { useEffect, useState } from 'react';

import { Stack, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import AnimatedSplash from 'react-native-animated-splash-screen';

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
    const timer = setTimeout(() => setIsLoaded(true), 700);
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
    <AnimatedSplash
      translucent
      isLoaded={isLoaded && status !== 'loading'}
      logoImage={{ uri: 'https://upload.wikimedia.org/wikipedia/commons/5/57/X_logo_2023_%28white%29.png' }}
      backgroundColor="#000000"
      logoHeight={120}
      logoWidth={120}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <BottomSheetModalProvider>
          <Stack>
            <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
            <Stack.Screen name="login" options={{ headerShown: false, gestureEnabled: false }} />
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
        </BottomSheetModalProvider>
      </GestureHandlerRootView>
    </AnimatedSplash>
  );
}
