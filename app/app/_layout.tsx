import '../global.css';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack, usePathname, useRouter } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import AnimatedSplash from 'react-native-animated-splash-screen';
import { getCurrentSession, getSessionToken } from '~/lib/luckread-api';

export const unstable_settings = {
  initialRouteName: 'login',
};

export default function RootLayout() {
  const [isLoaded, setIsLoaded] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => { if (active) setIsLoaded(true); }, 500);
    const checkSession = async () => {
      try {
        const token = await getSessionToken();
        if (token) {
          await getCurrentSession();
          if (active && (pathname === '/login' || pathname === '/')) router.replace('/real-feed');
        } else if (active && pathname !== '/login') {
          router.replace('/login');
        }
      } catch {
        if (active && pathname !== '/login') router.replace('/login');
      } finally {
        if (active) setAuthChecked(true);
      }
    };
    void checkSession();
    return () => { active = false; clearTimeout(timer); };
  }, [pathname, router]);

  return (
    <AnimatedSplash
      translucent
      isLoaded={isLoaded && authChecked}
      logoImage={{ uri: 'https://upload.wikimedia.org/wikipedia/commons/5/57/X_logo_2023_%28white%29.png' }}
      backgroundColor="#000000"
      logoHeight={120}
      logoWidth={120}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <BottomSheetModalProvider>
          <Stack>
            <Stack.Screen name="login" options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="real-feed" options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
            <Stack.Screen name="modal" options={{ title: 'Modal', presentation: 'modal' }} />
            <Stack.Screen name="edit-accounts" options={{ headerShown: false, presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
          </Stack>
        </BottomSheetModalProvider>
      </GestureHandlerRootView>
    </AnimatedSplash>
  );
}
