import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const appConfig = JSON.parse(
  readFileSync(new URL('../app.json', import.meta.url), 'utf8'),
);
const nativeConfig = require('../react-native.config.js');
const feedItem = readFileSync(
  new URL('../components/FeedItem.tsx', import.meta.url),
  'utf8',
);
const postDetail = readFileSync(
  new URL('../app/(drawer)/(tabs)/(index,search,messages,grok,video,notifications)/post/[id].tsx', import.meta.url),
  'utf8',
);

test('uses the Expo SDK 58 native menu package instead of the legacy community module', () => {
  expect(packageJson.dependencies['@expo/ui']).toBe('~58.0.26');
  expect(packageJson.dependencies['@react-native-menu/menu']).toBeUndefined();
  expect(packageJson.dependencies.zeego).toBeUndefined();
  expect(packageJson.dependencies['react-native-ios-context-menu']).toBeUndefined();
  expect(packageJson.dependencies['react-native-ios-utilities']).toBeUndefined();
  expect(nativeConfig.dependencies ?? {}).not.toHaveProperty('@react-native-menu/menu');
  // SDK 58 / React Native 0.88 requires the New Architecture; SDK 58 removes the
  // obsolete app.json toggle, so native Prebuild verifies the generated flag.
  expect(appConfig.expo).not.toHaveProperty('newArchEnabled');
});

test('uses Expo MenuView for native post overflow actions on both platforms', () => {
  expect(feedItem).toContain("from '@expo/ui/community/menu'");
  expect(feedItem).toContain('actions={dropdownMenuActions}');
  expect(feedItem).toContain('onPressAction={({ nativeEvent }) => runMenuAction(nativeEvent.event)}');
  expect(feedItem).toContain("colorScheme={colorScheme === 'dark' ? 'dark' : 'light'}");
  expect(feedItem).not.toContain("from '@react-native-menu/menu'");
  expect(feedItem).not.toContain('isAnchoredToRight');
  expect(feedItem).not.toContain('ActionSheetIOS');
  expect(postDetail).toContain("from '@expo/ui/community/menu'");
  expect(postDetail).toContain('actions={actions}');
  expect(postDetail).toContain('onPressAction={({ nativeEvent }) => runMenuAction(nativeEvent.event)}');
  expect(postDetail).not.toContain("from '@react-native-menu/menu'");
  expect(postDetail).not.toContain('isAnchoredToRight');
  expect(postDetail).not.toContain('ActionSheetIOS');
});

test('uses the native long-press context menu on iOS without wrapping Android feed taps', () => {
  expect(feedItem).toContain("Platform.OS === 'ios' ? (");
  expect(feedItem).toContain('actions={contextMenuActions}');
  expect(feedItem).toContain('shouldOpenOnLongPress');
  expect(feedItem).toContain('{Platform.OS === \'ios\' ? (');
});
