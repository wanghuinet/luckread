import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { selectVisibleFeedHydrationRecords } from '../lib/feed-hydration.ts';

test('hydrates only feed records whose cards are visible', () => {
  const records = [
    { id: 'post-1' },
    { id: 'post-2' },
    { id: 'post-3' },
    { id: 'post-4' },
  ];

  expect(selectVisibleFeedHydrationRecords(records, ['post-2', 'post-3'], new Set()))
    .toEqual([{ id: 'post-2' }, { id: 'post-3' }]);
});

test('preserves feed order and de-duplicates visible IDs across paginated records', () => {
  const records = [
    { id: 'post-1' },
    { id: 'post-2' },
    { id: 'post-1' },
    { id: 'post-3' },
  ];

  expect(selectVisibleFeedHydrationRecords(records, ['post-3', 'post-1', 'post-3'], new Set()))
    .toEqual([{ id: 'post-1' }, { id: 'post-3' }]);
});

test('does not rehydrate records already processed or IDs outside the viewport', () => {
  const records = [
    { id: 'post-1' },
    { id: 'post-2' },
    { id: 'post-3' },
  ];

  expect(selectVisibleFeedHydrationRecords(
    records,
    ['post-1', 'post-2'],
    new Set(['post-1']),
  )).toEqual([{ id: 'post-2' }]);
});

test('ignores blank visible IDs and blank record IDs', () => {
  const records = [{ id: '' }, { id: 'post-1' }];
  expect(selectVisibleFeedHydrationRecords(records, ['', '   ', 'post-1'], new Set()))
    .toEqual([{ id: 'post-1' }]);
});

test('home feed hydration is cancellable per visible card and never fans out for offscreen records', () => {
  const screen = readFileSync(
    new URL('../app/(drawer)/(tabs)/(index)/index.tsx', import.meta.url),
    'utf8',
  );

  expect(screen).toContain('hydrationControllersRef = useRef<Map<string, AbortController>>');
  expect(screen).toContain('if (!visibleIdSet.has(contentId))');
  expect(screen).toContain('readContentBody(item, controller.signal, sessionToken)');
  expect(screen).toContain('const socialBatchPromise = readContentSocialBatch(');
  expect(screen).toContain('pendingRecords.map((item) => item.id)');
  expect(screen).toContain('const cardControllers = new Map<string, AbortController>();');
  expect(screen).toContain('socialBatchController.abort();');
  expect(screen).toContain('for (const [contentId, controller] of cardControllers)');
  expect(screen).toContain('controller.abort();');
  expect(screen).toContain('hydrationControllersRef.current.get(contentId) === controller');
  expect(screen).toContain('hydrationControllersRef.current.delete(contentId)');
  expect(screen).toContain('readContentAuthor(item, controller.signal)');
  expect(screen).toContain('hydrationControllersRef.current.clear()');
  expect(screen).not.toContain('Promise.allSettled(pendingRecords.map(async (item)');
});
