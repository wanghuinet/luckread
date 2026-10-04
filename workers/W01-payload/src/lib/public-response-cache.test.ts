import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { cachedPublicGet, invalidatePublicContentList, invalidatePublicUserProfileByUsername, publicCacheKey } from './public-response-cache.js'

describe('public response cache', () => {
  const cache = {
    match: vi.fn(),
    put: vi.fn(async () => undefined),
    delete: vi.fn<(request: Request) => Promise<boolean>>(async (_request) => true),
  }

  const generationResponse = (generation = 'g0') => new Response(JSON.stringify({ generation }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

  beforeEach(() => {
    vi.resetAllMocks()
    cache.match.mockImplementation(async (request: Request) =>
      request.url.includes('__content-list-generation') ? generationResponse() : undefined,
    )
    cache.put.mockResolvedValue(undefined)
    cache.delete.mockResolvedValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete (globalThis as Record<string, unknown>).caches
  })

  it('serves a cache hit without executing the origin loader', async () => {
    const cached = new Response(JSON.stringify({ data: 'cached' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    cache.match.mockImplementation(async (request: Request) =>
      request.url.includes('__content-list-generation') ? generationResponse() : cached,
    )
    Object.defineProperty(globalThis, 'caches', { value: { default: cache }, configurable: true })

    const loader = vi.fn(async () => new Response(JSON.stringify({ data: 'origin' }), { status: 200 }))
    const response = await cachedPublicGet(
      new Request('https://luckread.com/api/v1/contents'),
      'content-list',
      loader,
      30,
    )

    expect(loader).not.toHaveBeenCalled()
    expect(response.headers.get('X-LuckRead-Cache')).toBe('HIT')
    await expect(response.json()).resolves.toEqual({ data: 'cached' })
  })

  it('coalesces concurrent misses into one origin request', async () => {
    cache.match.mockResolvedValue(undefined)
    cache.put.mockResolvedValue(undefined)
    Object.defineProperty(globalThis, 'caches', { value: { default: cache }, configurable: true })

    let releaseLoader: ((response: Response) => void) | null = null
    const loader = vi.fn(() => new Promise<Response>((resolve) => { releaseLoader = resolve }))

    const request = new Request('https://luckread.com/api/v1/users/u-coalesce')
    const a = cachedPublicGet(request, 'user-profile', loader, 30)
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1))
    const b = cachedPublicGet(request.clone(), 'user-profile', loader, 30)
    releaseLoader?.(new Response(JSON.stringify({ data: 'origin' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    const [first, second] = await Promise.all([a, b])
    expect(loader).toHaveBeenCalledTimes(1)
    expect(cache.put).toHaveBeenCalledTimes(1)
    expect(first.headers.get('X-LuckRead-Cache')).toBe('MISS')
    expect(second.headers.get('X-LuckRead-Cache')).toBe('MISS')
  })

  it('returns the successful origin response when cache storage rejects writes', async () => {
    cache.match.mockImplementation(async (request: Request) =>
      request.url.includes('__content-list-generation') ? generationResponse() : undefined,
    )
    cache.put.mockRejectedValueOnce(new Error('CACHE_WRITE_FAILED'))
    Object.defineProperty(globalThis, 'caches', { value: { default: cache }, configurable: true })

    const loader = vi.fn(async () => new Response(JSON.stringify({ data: 'origin' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    const response = await cachedPublicGet(
      new Request('https://luckread.com/api/v1/contents'),
      'content-list',
      loader,
      30,
    )

    expect(loader).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ data: 'origin' })
    expect(response.headers.get('X-LuckRead-Cache')).toBe('MISS')
  })

  it('reuses bounded memory fallback after an edge cache write failure', async () => {
    cache.match.mockImplementation(async (request: Request) =>
      request.url.includes('__content-list-generation') ? generationResponse() : undefined,
    )
    cache.put.mockRejectedValueOnce(new Error('CACHE_WRITE_FAILED'))
    Object.defineProperty(globalThis, 'caches', { value: { default: cache }, configurable: true })

    const loader = vi.fn(async () => new Response(JSON.stringify({ data: 'origin' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    const request = new Request('https://luckread.com/api/v1/contents?cursor=fallback')

    const first = await cachedPublicGet(request, 'content-list', loader, 30)
    expect(first.status).toBe(200)

    const second = await cachedPublicGet(request.clone(), 'content-list', loader, 30)
    expect(loader).toHaveBeenCalledTimes(1)
    expect(second.headers.get('X-LuckRead-Cache')).toBe('HIT')
    await expect(second.json()).resolves.toEqual({ data: 'origin' })
  })

  it('uses the memory fallback when Cache API reads fail', async () => {
    cache.match.mockResolvedValue(undefined)
    cache.put.mockRejectedValueOnce(new Error('CACHE_WRITE_FAILED'))
    Object.defineProperty(globalThis, 'caches', { value: { default: cache }, configurable: true })

    const loader = vi.fn(async () => new Response(JSON.stringify({ data: 'origin' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    const request = new Request('https://luckread.com/api/v1/users/u-read-fallback')

    await cachedPublicGet(request, 'user-profile', loader, 30)
    cache.match
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('CACHE_READ_FAILED'))
    const response = await cachedPublicGet(request.clone(), 'user-profile', loader, 30)

    expect(loader).toHaveBeenCalledTimes(1)
    expect(response.headers.get('X-LuckRead-Cache')).toBe('HIT')
    await expect(response.json()).resolves.toEqual({ data: 'origin' })
  })

  it('bounds concurrent cache-miss origin work', async () => {
    cache.match.mockImplementation(async (request: Request) =>
      request.url.includes('__content-list-generation') ? generationResponse() : undefined,
    )
    cache.put.mockResolvedValue(undefined)
    Object.defineProperty(globalThis, 'caches', { value: { default: cache }, configurable: true })

    let active = 0
    let peak = 0
    const loader = vi.fn(async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    await Promise.all(Array.from({ length: 24 }, (_, i) => cachedPublicGet(
      new Request('https://luckread.com/api/v1/contents?cursor=' + i),
      'content-list',
      loader,
      30,
    )))
    expect(peak).toBeLessThanOrEqual(16)
  })

  it('enforces a bounded origin budget when the cache repeatedly fails', async () => {
    cache.match.mockImplementation(async (request: Request) =>
      request.url.includes('__content-list-generation') ? generationResponse() : undefined,
    )
    cache.put.mockRejectedValue(new Error('CACHE_WRITE_FAILED'))
    Object.defineProperty(globalThis, 'caches', { value: { default: cache }, configurable: true })

    let now = 0
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const loader = vi.fn(async () => new Response(JSON.stringify({ data: 'origin' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    const results: Response[] = []
    for (let i = 0; i < 6; i += 1) {
      results.push(await cachedPublicGet(
        new Request('https://luckread.com/api/v1/contents?cursor=fuse'),
        'content-list',
        loader,
        1,
      ))
      now += 2000
    }

    expect(loader).toHaveBeenCalledTimes(5)
    expect(results.slice(0, 5).every((response) => response.status === 200)).toBe(true)
    expect(results[5]?.status).toBe(503)
    expect(results[5]?.headers.get('x-luckread-cache')).toBe('OVERLOADED')
  })

  it('normalizes username profile cache keys without attacker-controlled query dimensions', () => {
    const a = publicCacheKey(new Request('https://luckread.com/api/v1/users/by-username/alice?x=1'), 'user-profile-by-username')
    const b = publicCacheKey(new Request('https://luckread.com/api/v1/users/by-username/alice?x=2'), 'user-profile-by-username')
    expect(a.url).toBe(b.url)
  })

  it('supports the dedicated public media detail cache namespace', () => {
    const a = publicCacheKey(new Request('https://luckread.com/api/v1/media/m1?x=1'), 'media-detail')
    const b = publicCacheKey(new Request('https://luckread.com/api/v1/media/m1?x=2'), 'media-detail')
    expect(a.url).toBe(b.url)
  })

  it('keeps language out of non-localized cache keys', () => {
    const a = publicCacheKey(new Request('https://luckread.com/api/v1/users/u1', { headers: { 'accept-language': 'en-US' } }), 'user-profile')
    const b = publicCacheKey(new Request('https://luckread.com/api/v1/users/u1', { headers: { 'accept-language': 'zh-CN' } }), 'user-profile')
    expect(a.url).toBe(b.url)
  })

  it('ignores unknown query parameters for contracted public cache keys', () => {
    const a = publicCacheKey(new Request('https://luckread.com/api/v1/contents/1?foo=a'), 'content-detail')
    const b = publicCacheKey(new Request('https://luckread.com/api/v1/contents/1?foo=b'), 'content-detail')
    expect(a.url).toBe(b.url)

    const c = publicCacheKey(new Request('https://luckread.com/api/v1/contents?limit=20&foo=a'), 'content-list')
    const d = publicCacheKey(new Request('https://luckread.com/api/v1/contents?limit=20&foo=b'), 'content-list')
    expect(c.url).toBe(d.url)
  })

  it('separates content-list cache keys by generation', () => {
    const a = publicCacheKey(
      new Request('https://luckread.com/api/v1/contents?type=article'),
      'content-list',
      'generation-a',
    )
    const b = publicCacheKey(
      new Request('https://luckread.com/api/v1/contents?type=article'),
      'content-list',
      'generation-b',
    )
    expect(a.url).not.toBe(b.url)
  })

  it('normalizes cache keys deterministically', () => {
    const a = publicCacheKey(new Request('https://luckread.com/api/v1/contents?type=article&limit=20'), 'content-list')
    const b = publicCacheKey(new Request('https://luckread.com/api/v1/contents?limit=20&type=article'), 'content-list')
    expect(a.url).toBe(b.url)
  })

  it('can store a bounded negative cache response after origin lookup', async () => {
    cache.match.mockResolvedValue(undefined)
    cache.put.mockRejectedValueOnce(new Error('CACHE_WRITE_FAILED'))
    Object.defineProperty(globalThis, 'caches', { value: { default: cache }, configurable: true })

    const loader = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'RESOURCE_NOT_FOUND' } }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    }))

    const first = await cachedPublicGet(
      new Request('https://luckread.com/api/v1/media/missing'),
      'media-detail',
      loader,
      30,
    )
    const second = await cachedPublicGet(
      new Request('https://luckread.com/api/v1/media/missing'),
      'media-detail',
      loader,
      30,
    )

    expect(first.status).toBe(404)
    expect(second.status).toBe(404)
    expect(loader).toHaveBeenCalledTimes(1)
    expect(second.headers.get('x-luckread-cache')).toBe('HIT')
  })

  it('invalidates the explicit username profile cache key', async () => {
    cache.delete.mockResolvedValue(true)
    Object.defineProperty(globalThis, 'caches', { value: { default: cache }, configurable: true })

    await invalidatePublicUserProfileByUsername(
      new Request('https://luckread.com/api/v1/users/by-username/alice'),
      'alice',
    )

    expect(cache.delete).toHaveBeenCalledWith(
      publicCacheKey(
        new Request('https://luckread.com/api/v1/users/by-username/alice'),
        'user-profile-by-username',
      ),
    )
  })

  it('bumps the content-list generation and invalidates the previous canonical key', async () => {
    cache.delete.mockResolvedValue(true)
    Object.defineProperty(globalThis, 'caches', { value: { default: cache }, configurable: true })

    await invalidatePublicContentList(
      new Request('https://luckread.com/api/v1/contents?limit=20', {
        headers: { 'accept-language': 'en-US' },
      }),
    )

    const urls = cache.delete.mock.calls.map(([request]) => request.url)
    expect(urls).toContain(
      publicCacheKey(
        new Request('https://luckread.com/api/v1/contents'),
        'content-list',
        'g0',
      ).url,
    )

    const putCalls = cache.put.mock.calls as unknown as Array<[Request, Response]>
    const generationWrite = putCalls
      .map(([request, response]) => ({ request, response }))
      .find(({ request }) => request.url.includes('__content-list-generation'))
    expect(generationWrite).toBeDefined()
    const body = await generationWrite!.response.clone().json() as { generation?: unknown }
    expect(typeof body.generation).toBe('string')
    expect(body.generation).not.toBe('g0')
  })

  it('makes every filtered content-list variant unreachable after a generation bump', async () => {
    const before = publicCacheKey(
      new Request('https://luckread.com/api/v1/contents?creatorId=creator1&type=video&limit=50&cursor=c1'),
      'content-list',
      'g0',
    ).url

    cache.delete.mockResolvedValue(true)
    Object.defineProperty(globalThis, 'caches', { value: { default: cache }, configurable: true })

    await invalidatePublicContentList(new Request('https://luckread.com/api/v1/contents'))

    const putCalls = cache.put.mock.calls as unknown as Array<[Request, Response]>
    const generationWrite = putCalls
      .map(([request, response]) => ({ request, response }))
      .find(({ request }) => request.url.includes('__content-list-generation'))
    const body = await generationWrite!.response.clone().json() as { generation: string }

    const after = publicCacheKey(
      new Request('https://luckread.com/api/v1/contents?creatorId=creator1&type=video&limit=50&cursor=c1'),
      'content-list',
      body.generation,
    ).url

    expect(after).not.toBe(before)
  })

  it('bypasses shared content-list cache when generation state is unavailable', async () => {
    cache.match.mockRejectedValue(new Error('GENERATION_READ_FAILED'))
    Object.defineProperty(globalThis, 'caches', { value: { default: cache }, configurable: true })

    const loader = vi.fn(async () => new Response(JSON.stringify({ data: 'origin' }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    }))

    const response = await cachedPublicGet(
      new Request('https://luckread.com/api/v1/contents'),
      'content-list',
      loader,
      30,
    )

    expect(loader).toHaveBeenCalledTimes(1)
    expect(response.headers.get('X-LuckRead-Cache')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

})
