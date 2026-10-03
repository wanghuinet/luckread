import { describe, expect, it, vi, afterEach } from 'vitest'
import { cachedPublicGet, publicCacheKey } from '../src/lib/public-response-cache.js'

describe('public response cache', () => {
  const cache = {
    match: vi.fn(),
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => true),
  }

  afterEach(() => {
    vi.clearAllMocks()
    delete (globalThis as Record<string, unknown>).caches
  })

  it('serves a cache hit without executing the origin loader', async () => {
    const cached = new Response(JSON.stringify({ data: 'cached' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    cache.match.mockResolvedValueOnce(cached)
    Object.defineProperty(globalThis, 'caches', { value: { default: cache }, configurable: true })

    const loader = vi.fn(async () => new Response(JSON.stringify({ data: 'origin' }), { status: 200 }))
    const response = await cachedPublicGet(
      new Request('https://luckread.cn/api/v1/contents'),
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

    let resolveLoader: ((response: Response) => void) | null = null
    const loader = vi.fn(() => new Promise<Response>((resolve) => { resolveLoader = resolve }))

    const request = new Request('https://luckread.cn/api/v1/contents?cursor=c1')
    const a = cachedPublicGet(request, 'content-list', loader, 30)
    const b = cachedPublicGet(request.clone(), 'content-list', loader, 30)
    resolveLoader?.(new Response(JSON.stringify({ data: 'origin' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    const [first, second] = await Promise.all([a, b])
    expect(loader).toHaveBeenCalledTimes(1)
    expect(cache.put).toHaveBeenCalledTimes(1)
    expect(first.headers.get('X-LuckRead-Cache')).toBe('MISS')
    expect(second.headers.get('X-LuckRead-Cache')).toBe('MISS')
  })

  it('normalizes cache keys deterministically', () => {
    const a = publicCacheKey(new Request('https://luckread.cn/api/v1/contents?type=article&limit=20'), 'content-list')
    const b = publicCacheKey(new Request('https://luckread.cn/api/v1/contents?limit=20&type=article'), 'content-list')
    expect(a.url).toBe(b.url)
  })
})
