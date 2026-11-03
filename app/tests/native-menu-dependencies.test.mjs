import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const appConfig = JSON.parse(
  readFileSync(new URL('../app.json', import.meta.url), 'utf8'),
);
const feedItem = readFileSync(
  new URL('../components/FeedItem.tsx', import.meta.url),
  'utf8',
);
const postDetail = readFileSync(
  new URL('../app/(drawer)/(tabs)/(index,search,messages,grok,video,notifications)/post/[id].tsx', import.meta.url),
  'utf8',
);

test('declares the SDK 58 native Android menu dependency', () => {
  expect(packageJson.dependencies.zeego).toBeUndefined();
  expect(packageJson.dependencies['@react-native-menu/menu']).toBe('2.0.0');
  expect(packageJson.dependencies['react-native-ios-context-menu']).toBeUndefined();
  expect(packageJson.dependencies['react-native-ios-utilities']).toBeUndefined();
  // SDK 58 / React Native 0.88 requires the New Architecture; SDK 58 removes the
  // obsolete app.json toggle, so the native Prebuild check verifies the generated flag.
  expect(appConfig.expo).not.toHaveProperty('newArchEnabled');
});

test('uses an RN 0.88-compatible Android native menu and the iOS system action sheet', () => {
  expect(feedItem).toContain("from '@react-native-menu/menu'");
  expect(feedItem).toContain('ActionSheetIOS.showActionSheetWithOptions');
  expect(feedItem).toContain("onLongPress={Platform.OS === 'ios'");
  expect(feedItem).not.toContain('zeego/');
  expect(postDetail).toContain("from '@react-native-menu/menu'");
  expect(postDetail).toContain('ActionSheetIOS.showActionSheetWithOptions');
  expect(postDetail).not.toContain('zeego/');
});

test('keeps the Android native menu out of the iOS CocoaPods build', () => {
  const nativeConfig = require('../react-native.config.js');
  expect(nativeConfig.dependencies['@react-native-menu/menu'].platforms.ios).toBeNull();
});
