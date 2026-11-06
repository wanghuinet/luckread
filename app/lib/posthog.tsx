import type { PropsWithChildren } from 'react';
import PostHog, { PostHogProvider } from 'posthog-react-native';

const apiKey = process.env.EXPO_PUBLIC_POSTHOG_API_KEY?.trim();
const apiHost = process.env.EXPO_PUBLIC_POSTHOG_HOST?.trim();

const allowedHosts = new Set([
  'https://us.i.posthog.com',
  'https://eu.i.posthog.com',
]);

// This optional client only starts when both public project settings are supplied.
// The project token is an ingestion key, not a personal PostHog API key.
export const posthog =
  apiKey && apiHost && allowedHosts.has(apiHost)
    ? new PostHog(apiKey, {
        host: apiHost,
        captureAppLifecycleEvents: false,
        capturePushNotificationSubscriptions: false,
        capturePushNotificationOpened: false,
        disableGeoip: true,
        enableSessionReplay: false,
        errorTracking: {
          autocapture: {
            uncaughtExceptions: true,
            unhandledRejections: true,
            console: [],
            nativeCrashes: true,
            androidNdkCrashes: true,
          },
        },
      })
    : null;

export function PostHogDiagnosticsProvider({ children }: PropsWithChildren) {
  if (!posthog) return <>{children}</>;

  return (
    <PostHogProvider
      client={posthog}
      autocapture={{
        captureScreens: false,
        captureTouches: false,
      }}
    >
      {children}
    </PostHogProvider>
  );
}
