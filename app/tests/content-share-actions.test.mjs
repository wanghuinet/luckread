import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const shareButton = readFileSync(new URL('../components/ShareButton.tsx', import.meta.url), 'utf8');
const shareLink = readFileSync(new URL('../lib/content-share.ts', import.meta.url), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('uses the Expo SDK 58 Clipboard package and the React Native text share API', () => {
  expect(packageJson.dependencies['expo-clipboard']).toBe('~58.0.4');
  expect(shareButton).toContain("import * as Clipboard from 'expo-clipboard'");
  expect(shareButton).toContain('Clipboard.setStringAsync(url)');
  expect(shareButton).toContain("import {");
  expect(shareButton).toContain('Share,');
  expect(shareButton).not.toContain("from 'expo-sharing'");
});

test('copy and native share actions use the same authoritative public share URL', () => {
  expect(shareButton).toContain('createContentShareLink(contentId)');
  expect(shareButton).toContain("options: ['Copy link', 'More sharing options', 'Cancel']");
  expect(shareButton).toContain("text: 'Copy link'");
  expect(shareButton).toContain('Share.share({ message, title:');
  expect(shareLink).toContain("'/content/' + encodeURIComponent(id) + '/shares'");
  expect(shareLink).toContain("PUBLIC_SHARE_ORIGIN + '/s/' + encodeURIComponent(shareId)");
  expect(shareButton).not.toMatch(/\bfetch\s*\(/);
});

test('clipboard failures are surfaced instead of showing a false success state', () => {
  expect(shareButton).toContain('if (copied === false)');
  expect(shareButton).toContain("Alert.alert('Link copied'");
  expect(shareButton).toContain("'Copy failed'");
});
