const CACHE_VERSION = 'lr-public-v1-20261003'
const inflight = new Map<string, Promise<Response>>()
const MAX_INFLIGHT = 128

const normalizeLanguage = (request: Request): string => {
  const value = request.headers.get('accept-language')?.split(',')[0]?.trim().toLowerCase()
  return value && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/.test(value) ? value : 'default'
}

const normalizedQuery = (url: URL): string => {
  const params = new URLSearchParams()
  const keys = Array.from(url.searchParams.keys()).sort()
  for (const key of keys) {
    for (const value of url.searchParams.getAll(key).sort()) params.append(key, value)
  }
  return params.toString()
}

export const publicCacheKey = (request: Request, namespace: string): Request => {
  const url = new URL(request.url)
  const query = normalizedQuery(url)
  const keyUrl = new URL('https://cache.luckread.internal/__edge-cache')
  keyUrl.searchParams.set('v', CACHE_VERSION)
  keyUrl.searchParams.set('n', namespace)
  keyUrl.searchParams.set('p', url.pathname)
  keyUrl.searchParams.set('lang', normalizeLanguage(request))
  if (query) keyUrl.searchParams.set('q', query)
  return new Request(keyUrl.toString(), { method: 'GET' })
}

const cacheable = (response: Response): boolean => {
  if (response.status !== 200) return false
  if (response.headers.has('set-cookie')) return false
  const contentType = response.headers.get('content-type') ?? ''
  return contentType.includes('application/json')
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
  const key = publicCacheKey(request, namespace)
  const cache = caches.default
  const hit = await cache.match(key)
  if (hit) return withCacheHeader(hit, 'HIT')

  const keyString = key.url
  let pending = inflight.get(keyString)
  if (!pending) {
    pending = (async () => {
      const response = await loader()
      if (cacheable(response)) {
        const cacheResponse = new Response(response.body ? response.clone().body : null, {
          status: response.status,
          headers: new Headers(response.headers),
        })
        cacheResponse.headers.set('Cache-Control', `public, max-age=0, s-maxage=${Math.max(1, Math.floor(ttlSeconds))}`)
        await cache.put(key, cacheResponse)
      }
      return response
    })()
    inflight.set(keyString, pending)
    if (inflight.size > MAX_INFLIGHT) inflight.delete(inflight.keys().next().value as string)
    void pending.finally(() => inflight.delete(keyString))
  }

  const response = await pending
  return withCacheHeader(response.clone(), 'MISS')
}

export const invalidatePublicContentDetail = async (request: Request, contentId: string): Promise<void> => {
  const url = new URL(request.url)
  url.pathname = `/api/v1/contents/${encodeURIComponent(contentId)}`
  url.search = ''
  await caches.default.delete(publicCacheKey(new Request(url.toString()), 'content-detail'))
}
