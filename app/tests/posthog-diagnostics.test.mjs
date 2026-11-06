import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const appPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const diagnostics = readFileSync(new URL('../lib/posthog.tsx', import.meta.url), 'utf8');
const rootLayout = readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
const envExample = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');

test('pins the PostHog native crash capture SDK and Expo peer dependencies', () => {
  expect(appPackage.dependencies['posthog-react-native']).toBe('4.85.3');
  expect(appPackage.dependencies['@posthog/react-native-plugin']).toBe('2.13.0');
  expect(appPackage.dependencies['expo-device']).toBe('~58.0.5');
  expect(appPackage.dependencies['expo-localization']).toBe('~58.0.4');
});

test('initializes diagnostics only when a valid public project key and supported host are configured', () => {
  expect(diagnostics).toContain("Platform.OS === 'android' || Platform.OS === 'ios'");
  expect(diagnostics).toContain('EXPO_PUBLIC_POSTHOG_API_KEY');
  expect(diagnostics).toContain('EXPO_PUBLIC_POSTHOG_HOST');
  expect(diagnostics).toContain("allowedHosts.has(apiHost)");
  expect(diagnostics).toContain("return <>{children}</>");
  expect(diagnostics).toContain('https://us.i.posthog.com');
  expect(diagnostics).toContain('https://eu.i.posthog.com');
});

test('captures exceptions only and disables product analytics, session replay and push telemetry', () => {
  expect(diagnostics).toContain('uncaughtExceptions: true');
  expect(diagnostics).toContain('unhandledRejections: true');
  expect(diagnostics).toContain('nativeCrashes: true');
  expect(diagnostics).toContain('androidNdkCrashes: true');
  expect(diagnostics).toContain('console: []');
  expect(diagnostics).toContain('captureScreens: false');
  expect(diagnostics).toContain('captureTouches: false');
  expect(diagnostics).toContain('captureAppLifecycleEvents: false');
  expect(diagnostics).toContain('enableSessionReplay: false');
  expect(diagnostics).toContain('capturePushNotificationSubscriptions: false');
  expect(diagnostics).toContain('capturePushNotificationOpened: false');
  expect(diagnostics).not.toContain('.identify(');
  expect(diagnostics).not.toContain('.capture(');
});

test('captures Expo Router root-boundary exceptions without collecting route or user data', () => {
  expect(rootLayout).toContain('<PostHogDiagnosticsProvider>');
  expect(rootLayout).toContain('posthog?.captureException(error)');
});

test('documents only the public ingestion key and never a personal CLI credential', () => {
  expect(envExample).toContain('EXPO_PUBLIC_POSTHOG_API_KEY=');
  expect(envExample).toContain('EXPO_PUBLIC_POSTHOG_HOST=');
  expect(envExample).toContain('Do not put a personal PostHog API key / CLI token');
  expect(envExample).not.toContain('POSTHOG_CLI_TOKEN=');
});
