import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const notFoundSource = readFileSync(new URL('../app/+not-found.tsx', import.meta.url), 'utf8');

test('provides a localized not-found message and a home recovery link', () => {
  expect(notFoundSource).toContain("title: '页面未找到'");
  expect(notFoundSource).toContain('找不到此页面，链接可能已失效或页面已移动。');
  expect(notFoundSource).toContain("href=\"/\"");
  expect(notFoundSource).toContain('返回首页');
});
