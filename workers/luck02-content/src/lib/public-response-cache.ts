const CACHE_VERSION = 'lr-public-v1-20261003'
const NEGATIVE_CACHE_TTL_SECONDS = 10
const inflight = new Map<string, Promise<Response>>()
const MAX_INFLIGHT = 128
const MAX_ORIGIN_CONCURRENCY = 16
const MAX_MEMORY_ENTRIES = 64
let originInFlight = 0
const originWaiters: Array<() => void> = []
const memoryFallback = new Map<string, { response: Response; expiresAt: number }>()
const CACHE_MISS_WINDOW_MS = 60_000
const CACHE_MISS_LIMIT_PER_KEY = 5
const CACHE_MISS_MAX_KEYS = 1024
const DEFAULT_CONTENT_LIST_GENERATION = '0'
const CONTENT_LIST_GENERATION_KEY = new Request(
  `https://cache.luckread.internal/__content-list-generation?v=${CACHE_VERSION}`,
)
const cacheMissHistory = new Map<string, number[]>()

const readMemoryFallback = (keyString: string): Response | null => {
  const entry = memoryFallback.get(keyString)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    memoryFallback.delete(keyString)
    return null
  }
  return entry.response.clone()
}

const deletePublicCacheKey = async (key: Request): Promise<void> => {
  memoryFallback.delete(key.url)
  cacheMissHistory.delete(key.url)
  try {
    await ((globalThis.caches as unknown as { default: Cache }).default).delete(key)
  } catch {
    // Cache invalidation is best-effort. An authoritative mutation must not be
    // reported as failed solely because edge-cache storage is unavailable.
  }
}

const rememberMemoryFallback = (keyString: string, response: Response, ttlSeconds: number): void => {
  if (memoryFallback.size >= MAX_MEMORY_ENTRIES && !memoryFallback.has(keyString)) {
    const oldestKey = memoryFallback.keys().next().value
    if (oldestKey) memoryFallback.delete(oldestKey)
  }
  memoryFallback.set(keyString, {
    response: response.clone(),
    expiresAt: Date.now() + Math.max(1, Math.floor(ttlSeconds)) * 1000,
  })
}

const withOriginSlot = async <T>(loader: () => Promise<T>): Promise<T> => {
  if (originInFlight >= MAX_ORIGIN_CONCURRENCY) {
    await new Promise<void>((resolve) => originWaiters.push(resolve))
  }
  originInFlight += 1
  try {
    return await loader()
  } finally {
    originInFlight -= 1
    originWaiters.shift()?.()
  }
}

const normalizeLanguage = (request: Request): string => {
  const value = request.headers.get('accept-language')?.split(',')[0]?.trim().toLowerCase()
  return value && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/.test(value) ? value : 'default'
}

const CACHE_QUERY_KEYS: Record<string, readonly string[]> = {
  'content-list': ['creatorId', 'cursor', 'limit', 'type'],
  'content-detail': [],
  'content-comments': ['cursor', 'limit'],
  followers: ['cursor', 'limit'],
  following: ['cursor', 'limit'],
  'share-detail': [],
  'user-profile': [],
  'user-profile-by-username': [],
  'media-detail': [],
}

const normalizedQuery = (url: URL, namespace: string): string => {
  const allowedKeys = CACHE_QUERY_KEYS[namespace]
  const keys = (allowedKeys ?? Array.from(url.searchParams.keys())).slice().sort()
  const params = new URLSearchParams()
  for (const key of keys) {
    for (const value of url.searchParams.getAll(key).sort()) params.append(key, value)
  }
  return params.toString()
}

const generateContentListGeneration = (): string => crypto.randomUUID().replaceAll('-', '')

const isValidContentListGeneration = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)

const generationResponse = (generation: string): Response =>
  new Response(JSON.stringify({ generation }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  })

const readContentListGeneration = async (cache: Cache): Promise<string | null> => {
  try {
    const marker = await cache.match(CONTENT_LIST_GENERATION_KEY)
    if (!marker) {
      const generation = generateContentListGeneration()
      await cache.put(CONTENT_LIST_GENERATION_KEY, generationResponse(generation))
      return generation
    }

    const value = await marker.json() as unknown
    const generation = value && typeof value === 'object' && 'generation' in value
      ? (value as { generation?: unknown }).generation
      : null
    return isValidContentListGeneration(generation) ? generation : null
  } catch {
    return null
  }
}

export const publicCacheKey = (
  request: Request,
  namespace: string,
  contentListGeneration = DEFAULT_CONTENT_LIST_GENERATION,
): Request => {
  const url = new URL(request.url)
  const query = normalizedQuery(url, namespace)
  const keyUrl = new URL('https://cache.luckread.internal/__edge-cache')
  keyUrl.searchParams.set('v', CACHE_VERSION)
  keyUrl.searchParams.set('n', namespace)
  keyUrl.searchParams.set('p', url.pathname)
  if (namespace === 'content-list') {
    keyUrl.searchParams.set('lang', normalizeLanguage(request))
    keyUrl.searchParams.set('g', contentListGeneration)
  }
  if (query) keyUrl.searchParams.set('q', query)
  return new Request(keyUrl.toString(), { method: 'GET' })
}

const cacheable = (response: Response): boolean => {
  if (response.status !== 200 && response.status !== 404) return false
  if (response.headers.has('set-cookie')) return false
  const contentType = response.headers.get('content-type') ?? ''
  return contentType.includes('application/json')
}

const missFuseResponse = (): Response =>
  new Response(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Public cache origin is temporarily protected' } }), {
    status: 503,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'retry-after': '1',
      'x-luckread-cache': 'OVERLOADED',
    },
  })

const enforceCacheMissOriginFuse = (keyString: string): boolean => {
  const now = Date.now()
  const existing = cacheMissHistory.get(keyString) ?? []
  const recent = existing.filter((timestamp) => timestamp > now - CACHE_MISS_WINDOW_MS)
  if (recent.length >= CACHE_MISS_LIMIT_PER_KEY) return false

  if (cacheMissHistory.size >= CACHE_MISS_MAX_KEYS && !cacheMissHistory.has(keyString)) {
    const oldestKey = cacheMissHistory.keys().next().value
    if (typeof oldestKey === 'string') cacheMissHistory.delete(oldestKey)
  }
  recent.push(now)
  cacheMissHistory.set(keyString, recent)
  return true
}


const withCacheHeader = (response: Response, value: 'HIT' | 'MISS'): Response => {
  const headers = new Headers(response.headers)
  headers.set('X-LuckRead-Cache', value)
  return new Response(response.body, { status: response.status, headers })
}

export const cachedPublicGet = async (
  request: Request,
  namespace: string,
  loader: () => Promise<Response>,
  ttlSeconds: number,
): Promise<Response> => {
  const cache = (globalThis.caches as unknown as { default: Cache }).default
  let contentListGeneration = DEFAULT_CONTENT_LIST_GENERATION
  if (namespace === 'content-list') {
    const resolvedGeneration = await readContentListGeneration(cache)
    if (!resolvedGeneration) return loader()
    contentListGeneration = resolvedGeneration
  }
  const key = publicCacheKey(request, namespace, contentListGeneration)
  const keyString = key.url

  try {
    const hit = await cache.match(key)
    if (hit) return withCacheHeader(hit, 'HIT')
  } catch {
    const memoryHit = readMemoryFallback(keyString)
    if (memoryHit) return withCacheHeader(memoryHit, 'HIT')
  }

  const memoryHit = readMemoryFallback(keyString)
  if (memoryHit) return withCacheHeader(memoryHit, 'HIT')
  let pending = inflight.get(keyString)
  if (!pending && inflight.size >= MAX_INFLIGHT) {
    return new Response(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Public cache origin is at capacity' } }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '1', 'x-luckread-cache': 'OVERLOADED' },
    })
  }

  if (!pending) {
    pending = (async () => {
      const fuseAllowed = enforceCacheMissOriginFuse(keyString)
      if (!fuseAllowed) return missFuseResponse()
      const response = await withOriginSlot(loader)
      if (cacheable(response)) {
        const effectiveTtl = response.status === 404
          ? Math.min(NEGATIVE_CACHE_TTL_SECONDS, Math.max(1, Math.floor(ttlSeconds)))
          : Math.max(1, Math.floor(ttlSeconds))
        const cacheResponse = new Response(response.body ? response.clone().body : null, {
          status: response.status,
          headers: new Headers(response.headers),
        })
        cacheResponse.headers.set('Cache-Control', `public, max-age=0, s-maxage=${effectiveTtl}`)
        try {
          await cache.put(key, cacheResponse)
          memoryFallback.delete(keyString)
        } catch {
          // Cache failure must not turn a successful authoritative read into a 503.
          // Keep a bounded, TTL-limited per-isolate response so repeated reads do not
          // immediately re-enter the authoritative path while edge storage recovers.
          rememberMemoryFallback(keyString, response, effectiveTtl)
        }
      }
      return response
    })()
    inflight.set(keyString, pending)
    void pending.then(() => inflight.delete(keyString), () => inflight.delete(keyString))
  }

  const response = await pending
  if (response.status === 503 && response.headers.get('x-luckread-cache') === 'OVERLOADED') {
    return response
  }
  return withCacheHeader(response.clone(), 'MISS')
}

export const invalidatePublicRoute = async (request: Request, namespace: string, pathname: string): Promise<void> => {
  const url = new URL(request.url)
  url.pathname = pathname
  url.search = ''
  await deletePublicCacheKey(publicCacheKey(new Request(url.toString()), namespace))
}

export const invalidatePublicContentDetail = async (request: Request, contentId: string): Promise<void> =>
  invalidatePublicRoute(request, 'content-detail', `/api/v1/contents/${encodeURIComponent(contentId)}`)

export const invalidatePublicContentList = async (request: Request): Promise<void> => {
  const url = new URL(request.url)
  url.pathname = '/api/v1/contents'
  url.search = ''

  const cache = (globalThis.caches as unknown as { default: Cache }).default
  const previousGeneration = await readContentListGeneration(cache)
  const nextGeneration = generateContentListGeneration()

  try {
    await cache.put(CONTENT_LIST_GENERATION_KEY, generationResponse(nextGeneration))
  } catch {
    // Best-effort invalidation. If the generation marker cannot be updated,
    // existing rate limits and bounded origin guards still protect the source
    // of truth; the old cache generation remains readable until it expires.
  }

  if (previousGeneration) {
    await deletePublicCacheKey(
      publicCacheKey(new Request(url.toString()), 'content-list', previousGeneration),
    )

    const requestLanguage = request.headers.get('accept-language')?.trim()
    if (requestLanguage) {
      const localized = new Request(url.toString(), {
        method: 'GET',
        headers: { 'accept-language': requestLanguage },
      })
      await deletePublicCacheKey(
        publicCacheKey(localized, 'content-list', previousGeneration),
      )
    }
  }
}

export const invalidatePublicUserProfile = async (request: Request, userId: string): Promise<void> =>
  invalidatePublicRoute(request, 'user-profile', `/api/v1/users/${encodeURIComponent(userId)}`)

export const invalidatePublicUserProfileByUsername = async (request: Request, username: string): Promise<void> =>
  invalidatePublicRoute(request, 'user-profile-by-username', `/api/v1/users/by-username/${encodeURIComponent(username)}`)
