import { fetchJson } from './client-api.js'

export type PublicProfile = {
  id: string
  username?: string
  displayName?: string | null
  avatar?: string | null
}

type CacheEntry<T> = {
  expiresAt: number
  promise: Promise<T>
}

type TtlPromiseCacheOptions = {
  ttlMs?: number
  maxEntries?: number
  now?: () => number
}

/**
 * Shares concurrent lookups and briefly caches successful values.
 * Rejections are evicted so transient failures can be retried.
 */
export function createTtlPromiseCache<K, V>(options: TtlPromiseCacheOptions = {}) {
  const ttlMs = Math.max(1, options.ttlMs ?? 30_000)
  const maxEntries = Math.max(1, Math.floor(options.maxEntries ?? 200))
  const now = options.now ?? Date.now
  const entries = new Map<K, CacheEntry<V>>()

  return {
    get(key: K, loader: () => Promise<V>): Promise<V> {
      const current = entries.get(key)
      if (current && current.expiresAt > now()) {
        // Move recently-used entries to the end for bounded LRU eviction.
        entries.delete(key)
        entries.set(key, current)
        return current.promise
      }
      if (current) entries.delete(key)

      while (entries.size >= maxEntries) {
        const oldestKey = entries.keys().next()
        if (oldestKey.done) break
        entries.delete(oldestKey.value)
      }

      const entry: CacheEntry<V> = {
        expiresAt: Number.POSITIVE_INFINITY,
        promise: Promise.resolve()
          .then(loader)
          .then(
            (value) => {
              if (entries.get(key) === entry) entry.expiresAt = now() + ttlMs
              return value
            },
            (error: unknown) => {
              if (entries.get(key) === entry) entries.delete(key)
              throw error
            },
          ),
      }
      entries.set(key, entry)
      return entry.promise
    },
    clear(): void {
      entries.clear()
    },
    get size(): number {
      return entries.size
    },
  }
}

const publicProfileCache = createTtlPromiseCache<string, PublicProfile>({
  ttlMs: 30_000,
  maxEntries: 200,
})

/**
 * Public profile data is viewer-independent, so it is safe to coalesce/cache
 * briefly across post cards. Viewer-specific likes are deliberately not cached.
 */
export function getCachedPublicProfile(userId: string): Promise<PublicProfile> {
  const normalizedId = userId.trim()
  if (!normalizedId || normalizedId.length > 128) {
    return Promise.reject(new Error('Invalid public profile id'))
  }

  return publicProfileCache.get(normalizedId, async () => {
    const { response, data } = await fetchJson<PublicProfile>(
      '/api/v1/users/' + encodeURIComponent(normalizedId),
      {
        credentials: 'omit',
        headers: { accept: 'application/json' },
        cache: 'no-store',
      },
    )

    if (!response.ok || !data || typeof data.id !== 'string' || data.id !== normalizedId) {
      throw new Error('Public profile unavailable')
    }
    return data
  })
}
