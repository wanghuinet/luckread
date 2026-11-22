import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const feedItem = readFileSync(new URL('../components/FeedItem.tsx', import.meta.url), 'utf8');

test('feed and post detail author profile links expose button semantics and destination context', () => {
  const authorLinks = feedItem.match(/accessibilityLabel=\{\x60查看作者 @\$\{authorHandle\}\x60\}/g) ?? [];
  const authorHints = feedItem.match(/accessibilityHint="打开作者个人资料"/g) ?? [];

  expect(authorLinks).toHaveLength(2);
  expect(authorHints).toHaveLength(2);
  expect(feedItem.match(/accessibilityRole="button"/g)?.length).toBeGreaterThanOrEqual(2);
  expect(feedItem).toContain("onPress={() => router.push('/profile/' + encodeURIComponent(profileIdentifier))}");
  expect(feedItem).toContain("onPress={() => router.push(`/profile/${encodeURIComponent(profileIdentifier)}`)}");
});
