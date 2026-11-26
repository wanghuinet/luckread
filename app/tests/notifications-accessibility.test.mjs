import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const screen = readFileSync(
  new URL('../app/(drawer)/(tabs)/(notifications)/notifications.tsx', import.meta.url),
  'utf8',
);
const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

test('notification rows announce read state and explain their navigation action', () => {
  expect(screen).toContain("accessibilityLabel={displayName + '，' + (item.readAt ? '已读' : '未读') + '，' + messageFor(item)}");
  expect(screen).toContain('accessibilityHint="打开相关动态或用户个人资料"');
});

test('single-notification read action has an explicit accessible name and hint', () => {
  expect(screen).toContain('accessibilityLabel="标记通知为已读"');
  expect(screen).toContain('accessibilityHint="仅将这条通知标记为已读"');
  expect(screen).toContain('accessibilityState={{ disabled: busyIds.has(item.id) }}');
});

test('mark-all-read action announces its scope and disabled state', () => {
  expect(screen).toContain('accessibilityLabel="全部标记已读"');
  expect(screen).toContain('accessibilityHint="将当前账号的所有未读通知标记为已读"');
  expect(screen).toContain('accessibilityState={{ disabled: currentUnreadCount === 0 || currentReadAllBusy }}');
});

test('notification accessibility contract is included in the existing required social-screen test command', () => {
  expect(packageJson.scripts['test:social-screen-api']).toContain('tests/notifications-accessibility.test.mjs');
});


test('notification deep-link fetch surfaces HTTP failures instead of treating them as missing items', () => {
  expect(screen).toContain('if (!result.response.ok)');
  expect(screen).toContain("getApiErrorMessage(result.data, '无法打开这条通知，请重试。', result.response.status)");
});
