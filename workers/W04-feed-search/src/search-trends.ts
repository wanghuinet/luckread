export type SearchTrend = {
  term: string
  count: number
  lastSeenAt: string
}

type SearchTrendState = {
  version: 1
  items: SearchTrend[]
}

type SearchTrendCache = Pick<Cache, 'match' | 'put'>

const CACHE_TTL_SECONDS = 60 * 60
const RETENTION_MS = 24 * 60 * 60 * 1000
const MAX_TERMS = 50
const MAX_COUNT = 1_000_000

const cacheKey = () => new Request(
  'https://cache.luckread.internal/__w04-search-trending?v=1',
  { method: 'GET' },
)

const defaultCache = (): SearchTrendCache | null => {
  if (typeof globalThis.caches === 'undefined') return null
  return (globalThis.caches as unknown as { default?: SearchTrendCache }).default ?? null
}

/**
 * Store only bounded, normalized, aggregate terms. Punctuation-heavy inputs,
 * numeric-only queries, identifiers such as email/URL strings, and long text
 * are excluded so the cache is a trend projection rather than a query log.
 */
export const normalizeSearchTrendTerm = (value: string): string | null => {
  const term = value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()
  const length = Array.from(term).length
  if (
    length < 2 ||
    length > 64 ||
    !/^[\p{L}\p{N}_ -]+$/u.test(term) ||
    /^\p{N}[\p{N}_ -]*$/u.test(term)
  ) return null
  return term
}

const isTrend = (value: unknown, now: number): value is SearchTrend => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Partial<SearchTrend>
  return typeof item.term === 'string' &&
    normalizeSearchTrendTerm(item.term) === item.term &&
    typeof item.count === 'number' &&
    Number.isSafeInteger(item.count) &&
    item.count > 0 &&
    item.count <= MAX_COUNT &&
    typeof item.lastSeenAt === 'string' &&
    Number.isFinite(Date.parse(item.lastSeenAt)) &&
    Date.parse(item.lastSeenAt) <= now + 60_000 &&
    now - Date.parse(item.lastSeenAt) <= RETENTION_MS
}

const sortTrends = (items: SearchTrend[]): SearchTrend[] => items
  .sort((left, right) =>
    right.count - left.count ||
    Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt) ||
    left.term.localeCompare(right.term),
  )
  .slice(0, MAX_TERMS)

const readState = async (cache: SearchTrendCache): Promise<SearchTrend[]> => {
  try {
    const response = await cache.match(cacheKey())
    if (!response) return []
    const value: unknown = await response.json()
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const state = value as Partial<SearchTrendState>
    if (state.version !== 1 || !Array.isArray(state.items) || state.items.length > MAX_TERMS) return []
    const now = Date.now()
    return state.items.filter((item): item is SearchTrend => isTrend(item, now))
  } catch {
    return []
  }
}

const writeState = async (cache: SearchTrendCache, items: SearchTrend[]): Promise<void> => {
  await cache.put(cacheKey(), Response.json(
    { version: 1, items: sortTrends(items) } satisfies SearchTrendState,
    {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=' + CACHE_TTL_SECONDS,
      },
    },
  ))
}

/**
 * Best-effort edge-cache aggregation only. Cache API read/modify/write is not
 * an atomic counter and caches can be POP-local/evicted, so this is strictly
 * approximate discovery ranking, never analytics evidence or business state.
 */
export async function recordSearchTrend(
  query: string,
  cache: SearchTrendCache | null = defaultCache(),
): Promise<void> {
  const term = normalizeSearchTrendTerm(query)
  if (!term || !cache) return
  try {
    const items = await readState(cache)
    const now = new Date().toISOString()
    const byTerm = new Map(items.map((item) => [item.term, item]))
    const existing = byTerm.get(term)
    byTerm.set(term, {
      term,
      count: Math.min(MAX_COUNT, (existing?.count ?? 0) + 1),
      lastSeenAt: now,
    })
    await writeState(cache, [...byTerm.values()])
  } catch {
    // Search results must stay available when this optional cache is unhealthy.
  }
}

export async function listTrendingSearches(
  limit = 10,
  cache: SearchTrendCache | null = defaultCache(),
): Promise<SearchTrend[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20 || !cache) return []
  const items = await readState(cache)
  return sortTrends(items).slice(0, limit)
}
