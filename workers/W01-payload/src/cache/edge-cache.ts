/// <reference types="@cloudflare/workers-types" />

export type EdgeCacheOptions = {
  ttlSeconds?: number
  staleWhileRevalidateSeconds?: number
  scopeKey?: string
}

const DEFAULT_TTL = 30
const DEFAULT_SWR = 120

const isAnonymousPublicRequest = (request: Request): boolean =>
  request.method === 'GET' &&
  !request.headers.get('Authorization') &&
  !request.headers.get('Cookie')

const cacheKey = (request: Request, scopeKey?: string): Request => {
  if (!scopeKey) return new Request(request.url, { method: 'GET' })
  const url = new URL(request.url)
  url.protocol = 'https:'
  url.hostname = 'luckread-edge-cache.internal'
  url.pathname = '/v1/' + encodeURIComponent(scopeKey) + url.pathname
  url.search = request.url.includes('?') ? new URL(request.url).search : ''
  return new Request(url.toString(), { method: 'GET' })
}

const cacheHeaders = (
  response: Response,
  ttlSeconds: number,
  staleWhileRevalidateSeconds: number,
): Headers => {
  const headers = new Headers(response.headers)
  headers.set(
    'cache-control',
    `public, max-age=0, s-maxage=${ttlSeconds}, stale-while-revalidate=${staleWhileRevalidateSeconds}`,
  )
  headers.delete('set-cookie')
  return headers
}

export async function withPublicEdgeCache(
  request: Request,
  loader: () => Promise<Response>,
  options: EdgeCacheOptions = {},
): Promise<Response> {
  if (!isAnonymousPublicRequest(request)) return loader()

  const ttlSeconds = Math.max(1, options.ttlSeconds ?? DEFAULT_TTL)
  const staleWhileRevalidateSeconds = Math.max(
    0,
    options.staleWhileRevalidateSeconds ?? DEFAULT_SWR,
  )
  const key = cacheKey(request, options.scopeKey)
  const cache = caches.default

  const cached = await cache.match(key)
  if (cached) return cached

  const response = await loader()
  if (!response.ok || response.headers.has('set-cookie')) return response

  const headers = cacheHeaders(response, ttlSeconds, staleWhileRevalidateSeconds)
  const cacheable = new Response(response.clone().body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })

  await cache.put(
    key,
    cacheable.clone(),
  )

  return new Response(await cacheable.arrayBuffer(), {
    status: cacheable.status,
    statusText: cacheable.statusText,
    headers,
  })
}

export async function withScopedEdgeCache(
  scopeKey: string,
  loader: () => Promise<Response>,
  request: Request,
  options: Omit<EdgeCacheOptions, 'scopeKey'> = {},
): Promise<Response> {
  if (request.method !== 'GET') return loader()

  const ttlSeconds = Math.max(1, options.ttlSeconds ?? 5)
  const staleWhileRevalidateSeconds = Math.max(
    0,
    options.staleWhileRevalidateSeconds ?? 15,
  )
  const key = cacheKey(request, scopeKey)
  const cached = await caches.default.match(key)
  if (cached) return cached

  const response = await loader()
  if (!response.ok || response.headers.has('set-cookie')) return response

  const headers = cacheHeaders(response, ttlSeconds, staleWhileRevalidateSeconds)
  const cacheable = new Response(response.clone().body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
  await caches.default.put(key, cacheable.clone())
  return new Response(await cacheable.arrayBuffer(), {
    status: cacheable.status,
    statusText: cacheable.statusText,
    headers,
  })
}

export async function invalidateScopedEdgeCache(
  scopeKey: string,
  request: Request,
): Promise<void> {
  const key = cacheKey(request, scopeKey)
  await caches.default.delete(key)
}
