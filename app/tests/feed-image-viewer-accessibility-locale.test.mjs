import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const feedItem = readFileSync(new URL('../components/FeedItem.tsx', import.meta.url), 'utf8');

test('feed image viewer close control exposes a localized accessible name and hint', () => {
  const closeControlStart = feedItem.indexOf('accessibilityLabel="关闭图片查看器"');
  expect(closeControlStart).toBeGreaterThan(-1);

  const closeControlEnd = feedItem.indexOf('</TouchableOpacity>', closeControlStart);
  const closeControl = feedItem.slice(closeControlStart, closeControlEnd);

  expect(closeControl).toContain('accessibilityRole="button"');
  expect(closeControl).toContain('accessibilityHint="关闭图片查看器并返回动态"');
  expect(closeControl).toContain('onPress={() => setViewerStartIndex(null)}');
});
