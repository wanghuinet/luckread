/**
 * Device-local recent search history.
 *
 * History is scoped by the active LuckRead account ID and never sent to W01/W04.
 * Anonymous searches use a separate device-local bucket.
 */
export const SEARCH_HISTORY_STORAGE_PREFIX = 'luckread.search-history.v1:';
export const MAX_SEARCH_HISTORY_ITEMS = 10;
export const MAX_SEARCH_TERM_LENGTH = 256;

export interface SearchHistoryStorage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
}

const pendingMutations = new Map<string, Promise<string[]>>();

export function searchHistoryStorageKey(viewerId: string | null | undefined): string {
  const normalizedViewerId = typeof viewerId === 'string' ? viewerId.trim() : '';
  return SEARCH_HISTORY_STORAGE_PREFIX + (normalizedViewerId ? 'user:' + encodeURIComponent(normalizedViewerId) : 'anonymous');
}

export function normalizeSearchHistoryTerm(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ').slice(0, MAX_SEARCH_TERM_LENGTH);
  return normalized || null;
}

function dedupeKey(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US');
}

function normalizeEntries(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    const term = normalizeSearchHistoryTerm(candidate);
    if (!term) continue;
    const key = dedupeKey(term);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(term);
    if (result.length >= MAX_SEARCH_HISTORY_ITEMS) break;
  }
  return result;
}

async function readByKey(storage: SearchHistoryStorage, key: string): Promise<string[]> {
  try {
    const value = await storage.getItemAsync(key);
    if (!value) return [];
    return normalizeEntries(JSON.parse(value) as unknown);
  } catch {
    // Corrupted or temporarily unavailable local history must not break Search.
    return [];
  }
}

export function readSearchHistory(
  storage: SearchHistoryStorage,
  viewerId: string | null | undefined,
): Promise<string[]> {
  return readByKey(storage, searchHistoryStorageKey(viewerId));
}

function mutateHistory(
  storage: SearchHistoryStorage,
  viewerId: string | null | undefined,
  update: (current: string[]) => string[],
): Promise<string[]> {
  const key = searchHistoryStorageKey(viewerId);
  const previous = pendingMutations.get(key) ?? Promise.resolve([]);
  const next = previous
    .catch(() => [])
    .then(async () => {
      const current = await readByKey(storage, key);
      const updated = normalizeEntries(update(current));
      await storage.setItemAsync(key, JSON.stringify(updated));
      return updated;
    });
  pendingMutations.set(key, next);
  return next.finally(() => {
    if (pendingMutations.get(key) === next) pendingMutations.delete(key);
  });
}

/** Add a search to the front, deduplicate it, and retain only the ten newest terms. */
export function addSearchHistoryEntry(
  storage: SearchHistoryStorage,
  viewerId: string | null | undefined,
  value: string,
): Promise<string[]> {
  const term = normalizeSearchHistoryTerm(value);
  if (!term) return readSearchHistory(storage, viewerId);
  const key = dedupeKey(term);
  return mutateHistory(storage, viewerId, (current) => [
    term,
    ...current.filter((item) => dedupeKey(item) !== key),
  ]);
}

/** Remove one exact normalized term from the active viewer's history. */
export function removeSearchHistoryEntry(
  storage: SearchHistoryStorage,
  viewerId: string | null | undefined,
  value: string,
): Promise<string[]> {
  const term = normalizeSearchHistoryTerm(value);
  if (!term) return readSearchHistory(storage, viewerId);
  const key = dedupeKey(term);
  return mutateHistory(storage, viewerId, (current) =>
    current.filter((item) => dedupeKey(item) !== key),
  );
}

/** Clear only the active viewer's device-local search history. */
export function clearSearchHistory(
  storage: SearchHistoryStorage,
  viewerId: string | null | undefined,
): Promise<string[]> {
  return mutateHistory(storage, viewerId, () => []);
}
