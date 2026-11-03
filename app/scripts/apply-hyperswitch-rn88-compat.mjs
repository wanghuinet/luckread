import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const packageRoot = path.resolve(
  'node_modules/@juspay-tech/react-native-hyperswitch',
);
const packageJson = JSON.parse(
  await readFile(path.join(packageRoot, 'package.json'), 'utf8'),
);

if (packageJson.version !== '1.3.6') {
  throw new Error(
    'The RN 0.88 compatibility patch is pinned to @juspay-tech/react-native-hyperswitch@1.3.6; found ' +
      packageJson.version,
  );
}

async function patchFile(relativePath, before, after, expectedCount) {
  const filePath = path.join(packageRoot, relativePath);
  const source = await readFile(filePath, 'utf8');
  const count = (value, token) => value.split(token).length - 1;
  const remaining = count(source, before);
  const alreadyPatched = after ? count(source, after) : 0;

  if (remaining === expectedCount && alreadyPatched === 0) {
    await writeFile(filePath, source.replaceAll(before, after), 'utf8');
    console.log('Patched Hyperswitch RN 0.88 API usage: ' + relativePath);
    return;
  }

  if (remaining === 0 && (after ? alreadyPatched === expectedCount : !source.includes('bridgelessEnabled'))) {
    console.log('Hyperswitch RN 0.88 patch already present: ' + relativePath);
    return;
  }

  throw new Error(
    'Unexpected upstream Hyperswitch source in ' +
      relativePath +
      ': expected ' +
      expectedCount +
      ' occurrences of "' +
      before +
      '" or "' +
      after +
      '", found ' +
      remaining +
      ' unpatched and ' +
      alreadyPatched +
      ' patched.',
  );
}

await patchFile(
  'android/src/main/java/io/hyperswitch/react/HyperModule.kt',
  'currentActivity',
  'getCurrentActivity()',
  6,
);

await patchFile(
  'android/src/rn81/java/io/hyperswitch/react/HyperFragment.kt',
  'reactDelegate.reactRootView?.rootViewTag',
  'reactDelegate.reactRootView?.getRootViewTag()',
  1,
);

await patchFile(
  'ios/hyperswitchSDK/Core/NativeModule/RNHeadlessManager.swift',
  '    public override func bridgelessEnabled() -> Bool {\n        return true\n    }\n',
  '',
  1,
);

await patchFile(
  'ios/hyperswitchSDK/Core/NativeModule/RNViewManager.swift',
  '    public override func bridgelessEnabled() -> Bool {\n        return true\n    }\n',
  '',
  1,
);
