import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const feedItem = readFileSync(new URL('../components/FeedItem.tsx', import.meta.url), 'utf8');

test('feed post action menu trigger exposes an accessible name and purpose', () => {
  const menuStart = feedItem.indexOf('<MenuView\n                                actions={dropdownMenuActions}');
  expect(menuStart).toBeGreaterThan(-1);

  const menuEnd = feedItem.indexOf('</MenuView>', menuStart);
  const menu = feedItem.slice(menuStart, menuEnd);

  expect(menu).toContain('accessible');
  expect(menu).toContain('accessibilityRole="button"');
  expect(menu).toContain('accessibilityLabel="更多动态操作"');
  expect(menu).toContain('accessibilityHint="打开动态操作菜单"');
  expect(menu).toContain('onPressAction={({ nativeEvent }) => runMenuAction(nativeEvent.event)}');
});


test('post edit and delete handlers reject stale account identity after async boundaries', () => {
  expect(feedItem).toContain('const assertActiveOwner = () =>');
  expect(feedItem).toContain("useAuthStore.getState().user?.id !== currentUser.id");
  expect(feedItem).toContain('assertActiveOwner();');
});
