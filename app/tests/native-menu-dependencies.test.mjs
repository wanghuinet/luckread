import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const appConfig = JSON.parse(
  readFileSync(new URL('../app.json', import.meta.url), 'utf8'),
);
const feedItem = readFileSync(
  new URL('../components/FeedItem.tsx', import.meta.url),
  'utf8',
);

test('declares the native Android menu peer required by Zeego 3', () => {
  expect(packageJson.dependencies.zeego).toBe('^3.0.6');
  expect(packageJson.dependencies['@react-native-menu/menu']).toBe('1.2.2');
  expect(packageJson.dependencies['react-native-ios-context-menu']).toBe('3.1.0');
  expect(packageJson.dependencies['react-native-ios-utilities']).toBe('5.1.2');
  expect(appConfig.expo.newArchEnabled).toBe(true);
});

test('uses Zeego native menus from the feed item tree', () => {
  expect(feedItem).toContain("from 'zeego/context-menu'");
  expect(feedItem).toContain("from 'zeego/dropdown-menu'");
  expect(feedItem).toContain('<ContextMenu.Root>');
  expect(feedItem).toContain('<DropdownMenu.Root>');
});
