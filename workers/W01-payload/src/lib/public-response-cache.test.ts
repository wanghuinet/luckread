import { describe, expect, it, vi, afterEach } from 'vitest'
import { cachedPublicGet, publicCacheKey } from './public-response-cache.js'

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

    let releaseLoader: ((response: Response) => void) | null = null
    const loader = vi.fn(() => new Promise<Response>((resolve) => { releaseLoader = resolve }))

    const request = new Request('https://luckread.cn/api/v1/contents?cursor=c1')
    const a = cachedPublicGet(request, 'content-list', loader, 30)
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1))
    const b = cachedPublicGet(request.clone(), 'content-list', loader, 30)
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

  it('bounds concurrent cache-miss origin work', async () => {
    cache.match.mockResolvedValue(undefined)
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
      new Request('https://luckread.cn/api/v1/contents?cursor=' + i),
      'content-list',
      loader,
      30,
    )))
    expect(peak).toBeLessThanOrEqual(16)
  })

  it('keeps language out of non-localized cache keys', () => {
    const a = publicCacheKey(new Request('https://luckread.cn/api/v1/users/u1', { headers: { 'accept-language': 'en-US' } }), 'user-profile')
    const b = publicCacheKey(new Request('https://luckread.cn/api/v1/users/u1', { headers: { 'accept-language': 'zh-CN' } }), 'user-profile')
    expect(a.url).toBe(b.url)
  })

  it('normalizes cache keys deterministically', () => {
    const a = publicCacheKey(new Request('https://luckread.cn/api/v1/contents?type=article&limit=20'), 'content-list')
    const b = publicCacheKey(new Request('https://luckread.cn/api/v1/contents?limit=20&type=article'), 'content-list')
    expect(a.url).toBe(b.url)
  })
})
