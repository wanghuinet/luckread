import { QueryClient } from '@tanstack/react-query';

/**
 * The app-wide in-memory query cache. W01 remains the source of truth;
 * this cache only improves native read latency and stale-while-revalidate UX.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
