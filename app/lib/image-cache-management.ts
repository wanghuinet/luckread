export type ImageCacheApi = {
  clearMemoryCache: () => Promise<boolean>;
  clearDiskCache: () => Promise<boolean>;
};

export type ImageCacheClearResult = {
  memoryCacheCleared: boolean;
  diskCacheCleared: boolean;
  complete: boolean;
};

async function attemptCacheClear(clear: () => Promise<boolean>): Promise<boolean> {
  try {
    return (await clear()) === true;
  } catch {
    return false;
  }
}

/**
 * Clears only expo-image's managed in-memory and on-disk image caches.
 * It does not touch app documents, upload drafts, video cache, or server data.
 */
export async function clearImageCaches(api: ImageCacheApi): Promise<ImageCacheClearResult> {
  const [memoryCacheCleared, diskCacheCleared] = await Promise.all([
    attemptCacheClear(api.clearMemoryCache),
    attemptCacheClear(api.clearDiskCache),
  ]);

  return {
    memoryCacheCleared,
    diskCacheCleared,
    complete: memoryCacheCleared && diskCacheCleared,
  };
}
