import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const feedItem = readFileSync(new URL('../components/FeedItem.tsx', import.meta.url), 'utf8');
const cardStart = feedItem.indexOf('const feedCard = (');
const cardEnd = feedItem.indexOf('\n    return (\n        <>', cardStart);
const card = feedItem.slice(cardStart, cardEnd);

test('feed card does not wrap independent controls in one parent touch target', () => {
  expect(card).toContain('const feedCard = (\n        <View');
  expect(card).not.toContain('<TouchableOpacity\n            onPress={onPress}');
  expect(card).toContain('<EngagementActions');
  expect(card).toContain('<FeedMediaGallery');
  expect(card).toContain('accessibilityLabel="更多动态操作"');
  expect(card).toContain('accessibilityLabel={\x60查看作者 @\u0024{authorHandle}\x60}');
});

test('post navigation remains available through a dedicated accessible body target', () => {
  const bodyStart = card.indexOf('{onPress ? (');
  const bodyEnd = card.indexOf('{detailView && itemData.contentType', bodyStart);
  const bodyTarget = card.slice(bodyStart, bodyEnd);

  expect(bodyStart).toBeGreaterThan(-1);
  expect(bodyTarget).toContain('<TouchableOpacity');
  expect(bodyTarget).toContain('accessibilityRole="button"');
  expect(bodyTarget).toContain('accessibilityLabel="打开动态详情"');
  expect(bodyTarget).toContain('onPress={onPress}');
  expect(bodyTarget).toContain('{itemData.message}');
  expect(card.indexOf('<FeedMediaGallery')).toBeGreaterThan(bodyEnd);
  expect(card.indexOf('<EngagementActions')).toBeGreaterThan(bodyEnd);
});
