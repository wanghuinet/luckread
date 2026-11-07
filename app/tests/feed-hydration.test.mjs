import { expect, test } from 'bun:test';
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
