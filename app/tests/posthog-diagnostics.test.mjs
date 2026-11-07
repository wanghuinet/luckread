import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const appPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const diagnostics = readFileSync(new URL('../lib/posthog.tsx', import.meta.url), 'utf8');
const rootLayout = readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
const envExample = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
const appConfigSource = readFileSync(new URL('../app.config.js', import.meta.url), 'utf8');
const metroConfigSource = readFileSync(new URL('../metro.config.js', import.meta.url), 'utf8');
const androidBetaWorkflow = readFileSync(
  new URL('../../.github/workflows/app-android-beta-release.yml', import.meta.url),
  'utf8',
);
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const appConfigFactory = require('../app.config.js');

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

test('injects PostHog debug IDs while preserving LuckRead Metro transformers', () => {
  expect(metroConfigSource).toContain("require('posthog-react-native/metro')");
  expect(metroConfigSource).toContain('getPostHogExpoConfig(__dirname)');
  expect(metroConfigSource).toContain("react-native-svg-transformer/expo");
  expect(metroConfigSource).toContain("withNativeWind(config, { input: './global.css' })");
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
  expect(envExample).toContain('Personal API Key / CLI token in any EXPO_PUBLIC_* variable');
  expect(envExample).not.toContain('POSTHOG_CLI_TOKEN=');
});

test('keeps native symbol upload disabled until the private CI CLI credential exists', () => {
  const previous = {
    apiKey: process.env.POSTHOG_CLI_API_KEY,
    projectId: process.env.POSTHOG_CLI_PROJECT_ID,
    host: process.env.POSTHOG_CLI_HOST,
  };

  try {
    delete process.env.POSTHOG_CLI_API_KEY;
    delete process.env.POSTHOG_CLI_PROJECT_ID;
    delete process.env.POSTHOG_CLI_HOST;

    const baseConfig = { name: 'LuckRead', plugins: ['expo-router'] };
    const withoutCredentials = appConfigFactory({ config: baseConfig });
    expect(withoutCredentials.plugins).toEqual(['expo-router']);

    process.env.POSTHOG_CLI_API_KEY = 'test-personal-key';
    process.env.POSTHOG_CLI_PROJECT_ID = '715723';
    process.env.POSTHOG_CLI_HOST = 'https://us.posthog.com';

    const withCredentials = appConfigFactory({ config: baseConfig });
    const symbolPlugin = withCredentials.plugins.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === 'posthog-react-native/expo',
    );

    expect(symbolPlugin).toBeDefined();
    expect(symbolPlugin[1].uploadNativeSymbols).toBe(true);
    expect(symbolPlugin[1].skipOnConflict).toBe(true);
    expect(symbolPlugin[1].patchMainActivityNewIntent).toBe(false);
  } finally {
    if (previous.apiKey === undefined) delete process.env.POSTHOG_CLI_API_KEY;
    else process.env.POSTHOG_CLI_API_KEY = previous.apiKey;
    if (previous.projectId === undefined) delete process.env.POSTHOG_CLI_PROJECT_ID;
    else process.env.POSTHOG_CLI_PROJECT_ID = previous.projectId;
    if (previous.host === undefined) delete process.env.POSTHOG_CLI_HOST;
    else process.env.POSTHOG_CLI_HOST = previous.host;
  }
});

test('documents and wires the separate private PostHog CLI credentials for native symbol uploads', () => {
  expect(appConfigSource).toContain('POSTHOG_CLI_API_KEY');
  expect(appConfigSource).toContain('POSTHOG_CLI_PROJECT_ID');
  expect(appConfigSource).toContain('uploadNativeSymbols: true');
  expect(appConfigSource).toContain('patchMainActivityNewIntent: false');
  expect(envExample).toContain('POSTHOG_CLI_PROJECT_ID=715723');
  expect(envExample).toContain('POSTHOG_CLI_HOST=https://us.posthog.com');
  expect(envExample).toContain('Configure POSTHOG_CLI_API_KEY as a GitHub Actions repository secret');
  expect(androidBetaWorkflow).toContain('EXPO_PUBLIC_POSTHOG_API_KEY: ${{ secrets.EXPO_PUBLIC_POSTHOG_API_KEY }}');
  expect(androidBetaWorkflow).toContain('Verify PostHog project ingestion key is available');
  expect(androidBetaWorkflow).toContain('POSTHOG_CLI_API_KEY: ${{ secrets.POSTHOG_CLI_API_KEY }}');
  expect(androidBetaWorkflow).toContain('POSTHOG_CLI_PROJECT_ID: "715723"');
  expect(androidBetaWorkflow).toContain('POSTHOG_CLI_HOST: "https://us.posthog.com"');
  expect(androidBetaWorkflow).toContain('EXPO_PUBLIC_POSTHOG_HOST: "https://us.i.posthog.com"');
  expect(androidBetaWorkflow).toContain('npm install --global @posthog/cli@0.19.0');
  expect(androidBetaWorkflow).toContain('command -v posthog-cli');
  expect(envExample).not.toContain('POSTHOG_CLI_API_KEY=phx_');
});
