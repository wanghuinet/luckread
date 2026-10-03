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

const publicCacheKey = (request: Request): Request =>
  new Request(request.url, { method: 'GET' })

const scopedCacheKey = (scopeKey: string): Request =>
  new Request(
    'https://luckread-edge-cache.internal/v1/scoped/' + encodeURIComponent(scopeKey),
    { method: 'GET' },
  )

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

const materializeCacheableResponse = (
  response: Response,
  ttlSeconds: number,
  staleWhileRevalidateSeconds: number,
): Response => new Response(response.clone().body, {
  status: response.status,
  statusText: response.statusText,
  headers: cacheHeaders(response, ttlSeconds, staleWhileRevalidateSeconds),
})

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
  const key = publicCacheKey(request)
  const cache = caches.default
  const cached = await cache.match(key)
  if (cached) return cached

  const response = await loader()
  if (!response.ok || response.headers.has('set-cookie')) return response

  const cacheable = materializeCacheableResponse(
    response,
    ttlSeconds,
    staleWhileRevalidateSeconds,
  )
  await cache.put(key, cacheable.clone())

  return response
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
  const key = scopedCacheKey(scopeKey)
  const cached = await caches.default.match(key)
  if (cached) return cached

  const response = await loader()
  if (!response.ok || response.headers.has('set-cookie')) return response

  const cacheable = materializeCacheableResponse(
    response,
    ttlSeconds,
    staleWhileRevalidateSeconds,
  )
  await caches.default.put(key, cacheable.clone())
  return response
}

export async function invalidateScopedEdgeCache(
  scopeKey: string,
  _request: Request,
): Promise<void> {
  await caches.default.delete(scopedCacheKey(scopeKey))
}
