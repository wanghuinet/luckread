import React, { useEffect, useRef, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import { QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query';
import * as Network from 'expo-network';

import { useAuthStore } from '~/store/auth-store';
import { queryClient } from './query-client';

function QueryLifecycle({ children }: { children: ReactNode }) {
  const viewerId = useAuthStore((state) => state.user?.id ?? null);
  const previousViewerId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (previousViewerId.current !== undefined && previousViewerId.current !== viewerId) {
      // Following feed entries are viewer-scoped. Never retain one account's
      // cached timeline after logout or an account switch.
      queryClient.removeQueries({ queryKey: ['native-feed', 'following'] });
    }
    previousViewerId.current = viewerId;
  }, [viewerId]);

  useEffect(() => {
    if (Platform.OS === 'web') return undefined;

    focusManager.setFocused(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', (state) => {
      focusManager.setFocused(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    onlineManager.setEventListener((setOnline) => {
      let receivedInitialState = false;
      const applyState = (state: Network.NetworkState) => {
        const online = state.isInternetReachable ?? state.isConnected;
        if (typeof online === 'boolean') {
          receivedInitialState = true;
          setOnline(online);
        }
      };

      const subscription = Network.addNetworkStateListener(applyState);
      void Network.getNetworkStateAsync()
        .then((state) => {
          if (!receivedInitialState) applyState(state);
        })
        .catch(() => {
          // Unknown connectivity should not permanently block API requests.
          if (!receivedInitialState) setOnline(true);
        });

      return () => subscription.remove();
    });

    return () => {
      // Replacing the listener lets TanStack Query dispose the active Expo
      // Network subscription through the cleanup returned above.
      onlineManager.setEventListener(() => () => undefined);
    };
  }, []);

  return <>{children}</>;
}

export function QueryProvider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <QueryLifecycle>{children}</QueryLifecycle>
    </QueryClientProvider>
  );
}
