import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const camera = readFileSync(new URL('../components/CameraCaptureModal.tsx', import.meta.url), 'utf8');
const composer = readFileSync(new URL('../app/publish.tsx', import.meta.url), 'utf8');
const mediaActionSheet = readFileSync(new URL('../components/PublishMediaActionSheet.tsx', import.meta.url), 'utf8');
const appConfig = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('uses the Expo SDK 58 camera package and only requests camera permission for photo capture', () => {
  expect(packageJson.dependencies['expo-camera']).toBe('~58.0.14');
  expect(camera).toContain('CameraView');
  expect(camera).toContain('useCameraPermissions');
  expect(camera).toContain('takePictureAsync');
  expect(camera).toContain('onCameraReady');
  expect(camera).toContain('permission.canAskAgain');
  expect(camera).not.toContain('useMicrophonePermissions');

  const plugin = appConfig.expo.plugins.find((entry) =>
    Array.isArray(entry) && entry[0] === 'expo-camera',
  );
  expect(plugin).toBeDefined();
  expect(plugin[1].cameraPermission).toContain('take photos for posts');
  expect(plugin[1].microphonePermission).toBe(false);
  expect(plugin[1].recordAudioAndroid).toBe(false);
  expect(plugin[1].barcodeScannerEnabled).toBe(false);
});

test('camera is mounted only while the user opens the capture surface', () => {
  expect(camera).toContain('if (!visible) return null;');
  expect(camera).toContain('onRequestClose={onClose}');
  expect(camera).toContain('onMountError');
  expect(composer).toContain('onTakePhoto={() => setCameraVisible(true)}');
  expect(mediaActionSheet).toContain("dismissForAction('camera')");
  expect(mediaActionSheet).toContain("if (pendingAction === 'camera') onTakePhoto();");
  expect(composer).toContain('<CameraCaptureModal');
  expect(composer).toContain('visible={cameraVisible}');
});

test('captured JPEGs enter the existing idempotent W01 media upload path', () => {
  expect(composer).toContain("filename: 'luckread-camera-' + localId + '.jpg'");
  expect(composer).toContain("mimeType: 'image/jpeg'");
  expect(composer).toContain('uploadKey: createIdempotencyKey()');
  expect(composer).toContain('const succeeded = await uploadAsset(asset)');
  expect(composer).toContain('onCapture={handleCameraCapture}');
  expect(composer).not.toMatch(/\bfetch\s*\(/);
});
