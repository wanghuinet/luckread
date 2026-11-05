/**
 * Device-local autoplay preference for the dedicated vertical video feed.
 * It intentionally does not control inline post attachments or account-wide data.
 */
export const VIDEO_FEED_AUTOPLAY_PREFERENCE_KEY = 'luckread.video-feed-autoplay';

export interface VideoFeedAutoplayStorage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
}

/**
 * A fresh install preserves the current autoplay behavior. A storage read
 * failure or unrecognized value fails closed to manual playback to avoid
 * unexpected mobile-data usage.
 */
export async function readVideoFeedAutoplayEnabled(
  storage: VideoFeedAutoplayStorage,
): Promise<boolean> {
  try {
    const saved = await storage.getItemAsync(VIDEO_FEED_AUTOPLAY_PREFERENCE_KEY);
    if (saved === null || saved === 'enabled') return true;
    if (saved === 'disabled') return false;
    return false;
  } catch {
    return false;
  }
}

export async function writeVideoFeedAutoplayEnabled(
  storage: VideoFeedAutoplayStorage,
  enabled: boolean,
): Promise<void> {
  await storage.setItemAsync(
    VIDEO_FEED_AUTOPLAY_PREFERENCE_KEY,
    enabled ? 'enabled' : 'disabled',
  );
}
