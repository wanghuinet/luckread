import { expect, test } from 'bun:test';
import {
  VIDEO_FEED_AUTOPLAY_PREFERENCE_KEY,
  readVideoFeedAutoplayEnabled,
  writeVideoFeedAutoplayEnabled,
} from '../lib/video-feed-autoplay-preference.ts';
import { readFileSync } from 'node:fs';

const settings = readFileSync(new URL('../app/(drawer)/settings.tsx', import.meta.url), 'utf8');
const videoFeed = readFileSync(new URL('../app/(drawer)/(tabs)/(video)/video.tsx', import.meta.url), 'utf8');

function createStorage(initialValue = null) {
  let value = initialValue;
  return {
    getItemAsync: async (key) => {
      expect(key).toBe(VIDEO_FEED_AUTOPLAY_PREFERENCE_KEY);
      return value;
    },
    setItemAsync: async (key, nextValue) => {
      expect(key).toBe(VIDEO_FEED_AUTOPLAY_PREFERENCE_KEY);
      value = nextValue;
    },
    read: () => value,
  };
}

test('a fresh install preserves the current video-feed autoplay behavior', async () => {
  const storage = createStorage();
  await expect(readVideoFeedAutoplayEnabled(storage)).resolves.toBe(true);
});

test('the persisted disabled choice is restored as manual playback', async () => {
  const storage = createStorage('disabled');
  await expect(readVideoFeedAutoplayEnabled(storage)).resolves.toBe(false);
});

test('the persisted enabled choice restores autoplay', async () => {
  const storage = createStorage('enabled');
  await expect(readVideoFeedAutoplayEnabled(storage)).resolves.toBe(true);
});

test('invalid or unreadable device preference fails closed to manual playback', async () => {
  await expect(readVideoFeedAutoplayEnabled(createStorage('unexpected'))).resolves.toBe(false);
  await expect(readVideoFeedAutoplayEnabled({
    getItemAsync: async () => { throw new Error('secure storage unavailable'); },
    setItemAsync: async () => undefined,
  })).resolves.toBe(false);
});

test('writes only the explicit enabled or disabled device-local value', async () => {
  const storage = createStorage();
  await writeVideoFeedAutoplayEnabled(storage, false);
  expect(storage.read()).toBe('disabled');
  await writeVideoFeedAutoplayEnabled(storage, true);
  expect(storage.read()).toBe('enabled');
  expect(VIDEO_FEED_AUTOPLAY_PREFERENCE_KEY).toBe('luckread.video-feed-autoplay');
});

test('Settings exposes a device-local video-feed autoplay switch with save-failure feedback', () => {
  expect(settings).toContain('视频信息流自动播放');
  expect(settings).toContain('仅保存在当前设备');
  expect(settings).toContain('readVideoFeedAutoplayEnabled(SecureStore)');
  expect(settings).toContain('writeVideoFeedAutoplayEnabled(SecureStore, enabled)');
  expect(settings).toContain('保存失败。此设备的视频自动播放设置未更改，请重试。');
  expect(settings).toContain('disabled={!videoAutoPlayLoaded || videoAutoPlaySaving}');
});

test('video-feed autoplay obeys the device preference while preserving manual play and pause', () => {
  expect(videoFeed).toContain('readVideoFeedAutoplayEnabled(SecureStore)');
  expect(videoFeed).toContain('autoPlayEnabled={autoPlayEnabled}');
  expect(videoFeed).toContain("manualPlaybackOverride === 'play'");
  expect(videoFeed).toContain('manualPlaybackOverride === null && autoPlayEnabled');
  expect(videoFeed).toContain("setManualPlaybackOverride('pause')");
  expect(videoFeed).toContain("setManualPlaybackOverride('play')");
  expect(videoFeed).toContain('player.pause();');
});
