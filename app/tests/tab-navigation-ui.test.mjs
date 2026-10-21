import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const tabLayoutSource = readFileSync(
  new URL('../app/(drawer)/(tabs)/_layout.tsx', import.meta.url),
  'utf8',
);

test('hides the Grok route from LuckRead bottom navigation', () => {
  const grokScreen = tabLayoutSource.match(/<Tabs\.Screen\s+name="\(grok\)"[^>]*\/>/);

  expect(grokScreen).not.toBeNull();
  expect(grokScreen?.[0]).toContain('href: null');
  expect(tabLayoutSource).not.toMatch(/import\s+(?:Filled)?Grok\s+from/);
});

test('keeps the five LuckRead primary tabs available', () => {
  for (const routeName of ['(index)', '(search)', '(video)', '(notifications)', '(messages)']) {
    expect(tabLayoutSource).toContain(`name="${routeName}"`);
  }
});
