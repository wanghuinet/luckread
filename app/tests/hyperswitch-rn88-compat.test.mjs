import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const packageRoot = new URL(
  '../node_modules/@juspay-tech/react-native-hyperswitch/',
  import.meta.url,
);
const packageJson = JSON.parse(
  readFileSync(new URL('package.json', packageRoot), 'utf8'),
);
const hyperModule = readFileSync(
  new URL('android/src/main/java/io/hyperswitch/react/HyperModule.kt', packageRoot),
  'utf8',
);
const hyperFragment = readFileSync(
  new URL('android/src/rn81/java/io/hyperswitch/react/HyperFragment.kt', packageRoot),
  'utf8',
);
const rnViewManager = readFileSync(
  new URL('ios/hyperswitchSDK/Core/NativeModule/RNViewManager.swift', packageRoot),
  'utf8',
);
const rnHeadlessManager = readFileSync(
  new URL('ios/hyperswitchSDK/Core/NativeModule/RNHeadlessManager.swift', packageRoot),
  'utf8',
);

test('pins the compatibility patch to the audited official Hyperswitch package', () => {
  expect(packageJson.version).toBe('1.3.6');
});

test('uses React Native 0.88 activity and root view tag methods', () => {
  expect(hyperModule.match(/getCurrentActivity\(\)/g) ?? []).toHaveLength(6);
  expect(hyperModule).not.toMatch(/\bcurrentActivity\b/);
  expect(hyperFragment).toContain(
    'reactDelegate.reactRootView?.getRootViewTag() ?: -1',
  );
  expect(hyperFragment).not.toContain('reactRootView?.rootViewTag');
  expect(rnViewManager).not.toContain('bridgelessEnabled');
  expect(rnHeadlessManager).not.toContain('bridgelessEnabled');
});
