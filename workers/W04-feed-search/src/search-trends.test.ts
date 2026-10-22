import { describe, expect, it, vi } from 'vitest'
import {
  listTrendingSearches,
  normalizeSearchTrendTerm,
  recordSearchTrend,
} from './search-trends.js'

const fakeCache = () => {
  let value: unknown = null
  const match = vi.fn(async () => value === null ? undefined : Response.json(value))
  const put = vi.fn(async (_request: RequestInfo | URL, response: Response) => {
    value = await response.clone().json()
  })
  return {
    cache: { match, put } as unknown as Pick<Cache, 'match' | 'put'>,
    match,
    put,
    read: () => value,
  }
}

describe('W04 edge-cache search trend projection', () => {
  it('normalizes bounded public terms and excludes identifier-shaped queries', () => {
    expect(normalizeSearchTrendTerm('  ＬｕｃｋＲｅａｄ   News  ')).toBe('luckread news')
    expect(normalizeSearchTrendTerm('邮箱@example.com')).toBeNull()
    expect(normalizeSearchTrendTerm('https://luckread.com')).toBeNull()
    expect(normalizeSearchTrendTerm('1234567890')).toBeNull()
    expect(normalizeSearchTrendTerm('x')).toBeNull()
    expect(normalizeSearchTrendTerm('a'.repeat(65))).toBeNull()
  })

  it('ranks aggregate terms and limits the response without storing user identifiers', async () => {
    const fake = fakeCache()
    await recordSearchTrend('LuckRead', fake.cache)
    await recordSearchTrend('luckread', fake.cache)
    await recordSearchTrend('luckread', fake.cache)
    await recordSearchTrend('reading', fake.cache)
    await recordSearchTrend('reading', fake.cache)
    await recordSearchTrend('reading', fake.cache)
    await recordSearchTrend('oneoff', fake.cache)

    await expect(listTrendingSearches(2, fake.cache)).resolves.toMatchObject([
      { term: 'reading', count: 3 },
      { term: 'luckread', count: 3 },
    ])
    const stored = fake.read() as { items: Array<Record<string, unknown>> }
    expect(stored.items.every((item) => !('userId' in item) && !('actorUserId' in item))).toBe(true)
    expect(fake.put).toHaveBeenCalledTimes(7)
  })

  it('keeps only terms seen within the retention window', async () => {
    const fake = fakeCache()
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    const fresh = new Date().toISOString()
    fake.put.mockImplementationOnce(async () => undefined)
    await recordSearchTrend('new term', fake.cache)
    const seeded = {
      version: 1,
      items: [
        { term: 'old term', count: 99, lastSeenAt: old },
        { term: 'new term', count: 3, lastSeenAt: fresh },
      ],
    }
    const cacheWithSeed = {
      match: vi.fn(async () => Response.json(seeded)),
      put: vi.fn(async () => undefined),
    } as unknown as Pick<Cache, 'match' | 'put'>
    await expect(listTrendingSearches(10, cacheWithSeed)).resolves.toMatchObject([{ term: 'new term', count: 3 }])
  })

  it('treats cache failures as optional and never throws into the search path', async () => {
    const failedCache = {
      match: vi.fn(async () => { throw new Error('cache unavailable') }),
      put: vi.fn(async () => { throw new Error('cache unavailable') }),
    } as unknown as Pick<Cache, 'match' | 'put'>
    await expect(recordSearchTrend('hello world', failedCache)).resolves.toBeUndefined()
    await expect(listTrendingSearches(10, failedCache)).resolves.toEqual([])
  })
})
