import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const feedItem = readFileSync(new URL('../components/FeedItem.tsx', import.meta.url), 'utf8');

test('authenticated feed image viewer trigger exposes its image description and action', () => {
  const triggerStart = feedItem.indexOf('accessibilityLabel={`查看图片：${media.alt}`}');
  expect(triggerStart).toBeGreaterThan(-1);

  const triggerEnd = feedItem.indexOf('</TouchableOpacity>', triggerStart);
  const trigger = feedItem.slice(feedItem.lastIndexOf('<TouchableOpacity', triggerStart), triggerEnd);

  expect(trigger).toContain('accessibilityRole="button"');
  expect(trigger).toContain('accessibilityHint="打开图片查看器"');
  expect(trigger).toContain('setViewerStartIndex(currentImageIndex)');
  expect(trigger).toContain('setViewerIndex(currentImageIndex)');
});
