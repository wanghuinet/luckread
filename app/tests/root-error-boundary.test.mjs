import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const rootLayoutSource = readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8');

test('keeps root error details in diagnostics instead of rendering raw exception messages', () => {
  expect(rootLayoutSource).toContain('posthog?.captureException(error)');
  expect(rootLayoutSource).toContain('页面发生异常，可能是网络波动或服务暂时不可用。请重新加载页面。');
  expect(rootLayoutSource).not.toContain('{error.message ||');
  expect(rootLayoutSource).toContain('onPress={retry}');
});
