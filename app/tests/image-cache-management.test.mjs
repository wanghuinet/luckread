import { expect, test } from 'bun:test';
import { clearImageCaches } from '../lib/image-cache-management.ts';
import { readFileSync } from 'node:fs';

const settings = readFileSync(new URL('../app/(drawer)/settings.tsx', import.meta.url), 'utf8');

test('clears both image cache layers when the native cache APIs confirm success', async () => {
  const calls = [];
  const result = await clearImageCaches({
    clearMemoryCache: async () => { calls.push('memory'); return true; },
    clearDiskCache: async () => { calls.push('disk'); return true; },
  });

  expect(calls.sort()).toEqual(['disk', 'memory']);
  expect(result).toEqual({
    memoryCacheCleared: true,
    diskCacheCleared: true,
    complete: true,
  });
});

test('still attempts disk cache cleanup when the memory cache operation throws', async () => {
  let diskAttempted = false;
  const result = await clearImageCaches({
    clearMemoryCache: async () => { throw new Error('memory cache unavailable'); },
    clearDiskCache: async () => { diskAttempted = true; return true; },
  });

  expect(diskAttempted).toBe(true);
  expect(result.memoryCacheCleared).toBe(false);
  expect(result.diskCacheCleared).toBe(true);
  expect(result.complete).toBe(false);
});

test('reports partial cleanup when one cache layer returns false', async () => {
  const result = await clearImageCaches({
    clearMemoryCache: async () => true,
    clearDiskCache: async () => false,
  });

  expect(result.memoryCacheCleared).toBe(true);
  expect(result.diskCacheCleared).toBe(false);
  expect(result.complete).toBe(false);
});

test('fails closed when both native cache operations reject or return false', async () => {
  const result = await clearImageCaches({
    clearMemoryCache: async () => false,
    clearDiskCache: async () => { throw new Error('disk cache unavailable'); },
  });

  expect(result).toEqual({
    memoryCacheCleared: false,
    diskCacheCleared: false,
    complete: false,
  });
});

test('Settings exposes confirmed, device-only image cache cleanup on Android and iOS', () => {
  expect(settings).toContain("Platform.OS === 'ios' || Platform.OS === 'android'");
  expect(settings).toContain('ExpoImage.clearMemoryCache()');
  expect(settings).toContain('ExpoImage.clearDiskCache()');
  expect(settings).toContain('clearImageCaches({');
  expect(settings).toContain("Alert.alert('清理图片缓存'");
  expect(settings).toContain("style: 'destructive'");
  expect(settings).toContain('imageCacheClearInFlight.current');
  expect(settings).toContain('图片内存和磁盘缓存清理未能确认完成');
  expect(settings).toContain('不会删除草稿、待上传文件、视频或账号数据');
  expect(settings).not.toContain('FileSystem.deleteAsync');
  expect(settings).not.toContain('deleteAccount');
});
