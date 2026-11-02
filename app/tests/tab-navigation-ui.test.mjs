import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';

const tabLayoutSource = readFileSync(
  new URL('../app/(drawer)/(tabs)/_layout.tsx', import.meta.url),
  'utf8',
);
const upstreamGrokRoute = new URL(
  '../app/(drawer)/(tabs)/(grok)/grok.tsx',
  import.meta.url,
);

test('does not register or ship the upstream Grok demo route', () => {
  expect(tabLayoutSource).not.toContain('name="(grok)"');
  expect(existsSync(upstreamGrokRoute)).toBe(false);
});

test('keeps the five LuckRead primary tabs available', () => {
  for (const routeName of ['(index)', '(search)', '(video)', '(notifications)', '(messages)']) {
    expect(tabLayoutSource).toContain(`name="${routeName}"`);
  }
});


test('home feed renders first-page posts before optional detail enrichment completes', () => {
  const homeScreen = readFileSync(
    new URL('../app/(drawer)/(tabs)/(index)/index.tsx', import.meta.url),
    'utf8',
  );

  expect(homeScreen).toContain('setItems(visibleItems)');
  expect(homeScreen).toContain('Promise.allSettled(');
  expect(homeScreen).toContain('const hydrationResults = await Promise.allSettled(');
  expect(homeScreen).toContain('!loading && !loadingMore');
});

test('home route exposes an actionable error boundary instead of an unhandled blank screen', () => {
  const homeScreen = readFileSync(
    new URL('../app/(drawer)/(tabs)/(index)/index.tsx', import.meta.url),
    'utf8',
  );

  expect(homeScreen).toContain('export function ErrorBoundary({ error, retry }: ErrorBoundaryProps)');
  expect(homeScreen).toContain('onPress={retry}');
});
