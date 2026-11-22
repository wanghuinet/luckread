import { expect, test } from 'bun:test';
import {
  addSearchHistoryEntry,
  clearSearchHistory,
  MAX_SEARCH_HISTORY_ITEMS,
  normalizeSearchHistoryTerm,
  readSearchHistory,
  removeSearchHistoryEntry,
  searchHistoryStorageKey,
} from '../lib/search-history.ts';

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => { values.set(key, value); },
    read: (key) => values.get(key) ?? null,
  };
}

test('normalizes search input and rejects empty or non-string values', () => {
  expect(normalizeSearchHistoryTerm('  ＬｕｃｋRead   Neon  ')).toBe('LuckRead Neon');
  expect(normalizeSearchHistoryTerm('  ')).toBeNull();
  expect(normalizeSearchHistoryTerm(null)).toBeNull();
  expect(normalizeSearchHistoryTerm('a'.repeat(300))).toHaveLength(256);
});

test('stores search history in a separate secure-store key for each viewer', async () => {
  const storage = createStorage();
  expect(searchHistoryStorageKey('viewer-a')).not.toBe(searchHistoryStorageKey('viewer-b'));
  expect(searchHistoryStorageKey(null)).toContain(':anonymous');

  await addSearchHistoryEntry(storage, 'viewer-a', 'Alice');
  await addSearchHistoryEntry(storage, 'viewer-b', 'Bob');

  await expect(readSearchHistory(storage, 'viewer-a')).resolves.toEqual(['Alice']);
  await expect(readSearchHistory(storage, 'viewer-b')).resolves.toEqual(['Bob']);
  await expect(readSearchHistory(storage, null)).resolves.toEqual([]);
});

test('moves new terms to the front, deduplicates case-insensitively, and caps history', async () => {
  const storage = createStorage();
  await addSearchHistoryEntry(storage, 'viewer-a', '  X   Threads ');
  await addSearchHistoryEntry(storage, 'viewer-a', 'Neon');
  await addSearchHistoryEntry(storage, 'viewer-a', 'x threads');

  let entries = await readSearchHistory(storage, 'viewer-a');
  expect(entries).toEqual(['x threads', 'Neon']);

  for (let index = 0; index < MAX_SEARCH_HISTORY_ITEMS + 3; index += 1) {
    entries = await addSearchHistoryEntry(storage, 'viewer-a', 'term-' + index);
  }
  expect(entries).toHaveLength(MAX_SEARCH_HISTORY_ITEMS);
  expect(entries[0]).toBe('term-' + (MAX_SEARCH_HISTORY_ITEMS + 2));
});

test('serializes concurrent history updates rather than losing one search', async () => {
  const storage = createStorage();
  await Promise.all([
    addSearchHistoryEntry(storage, 'viewer-a', 'first'),
    addSearchHistoryEntry(storage, 'viewer-a', 'second'),
  ]);
  await expect(readSearchHistory(storage, 'viewer-a')).resolves.toEqual(['second', 'first']);
});

test('removes one term and clears only the selected viewer history', async () => {
  const storage = createStorage();
  await addSearchHistoryEntry(storage, 'viewer-a', 'first');
  await addSearchHistoryEntry(storage, 'viewer-a', 'second');
  await addSearchHistoryEntry(storage, 'viewer-b', 'other');

  await expect(removeSearchHistoryEntry(storage, 'viewer-a', 'FIRST')).resolves.toEqual(['second']);
  await expect(clearSearchHistory(storage, 'viewer-a')).resolves.toEqual([]);
  await expect(readSearchHistory(storage, 'viewer-a')).resolves.toEqual([]);
  await expect(readSearchHistory(storage, 'viewer-b')).resolves.toEqual(['other']);
});

test('malformed or inaccessible local history reads as empty without blocking search', async () => {
  const key = searchHistoryStorageKey('viewer-a');
  const corrupted = createStorage({ [key]: '{invalid json' });
  await expect(readSearchHistory(corrupted, 'viewer-a')).resolves.toEqual([]);

  const unavailable = {
    getItemAsync: async () => { throw new Error('SecureStore unavailable'); },
    setItemAsync: async () => undefined,
  };
  await expect(readSearchHistory(unavailable, 'viewer-a')).resolves.toEqual([]);
});
