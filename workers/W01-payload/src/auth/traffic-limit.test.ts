import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: vi.fn(),
}))

import { getCloudflareContext } from '@opennextjs/cloudflare'
import {
  enforceAuthRateLimit,
  enforcePublicReadRateLimit,
  rateLimitResponse,
  TrafficLimitError,
} from './traffic-limit.js'

const contextMock = vi.mocked(getCloudflareContext)

afterEach(() => {
  vi.clearAllMocks()
})

describe('traffic limits', () => {
  it('checks the auth origin breaker before the actor limiter', async () => {
    const calls: string[] = []
    const globalLimiter = { limit: vi.fn(async ({ key }: { key: string }) => { calls.push(key); return { success: true } }) }
    const actorLimiter = { limit: vi.fn(async ({ key }: { key: string }) => { calls.push(key); return { success: true } }) }
    contextMock.mockResolvedValue({
      env: {
        AUTH_ORIGIN_GLOBAL_LIMITER: globalLimiter,
        AUTH_LOGIN_LIMITER: actorLimiter,
      },
    } as never)

    await expect(
      enforceAuthRateLimit(
        new Request('https://luckread.cn/auth/login'),
        'AUTH_LOGIN_LIMITER',
        ['ip:127.0.0.1'],
      ),
    ).resolves.toBeUndefined()

    expect(calls).toEqual(['AUTH_LOGIN_LIMITER:origin', 'AUTH_LOGIN_LIMITER:ip:127.0.0.1'])
  })

  it('fails closed when the actor limiter binding is absent', async () => {
    contextMock.mockResolvedValue({ env: { AUTH_ORIGIN_GLOBAL_LIMITER: { limit: vi.fn(async () => ({ success: true })) } } } as never)
    await expect(
      enforceAuthRateLimit(new Request('https://luckread.cn/auth/login'), 'AUTH_LOGIN_LIMITER', ['ip:127.0.0.1']),
    ).rejects.toThrow('RATE_LIMIT_BINDING_UNAVAILABLE:AUTH_LOGIN_LIMITER')
  })

  it('rejects auth traffic when the origin breaker is exhausted', async () => {
    const globalLimiter = { limit: vi.fn(async () => ({ success: false })) }
    const actorLimiter = { limit: vi.fn(async () => ({ success: true })) }
    contextMock.mockResolvedValue({
      env: {
        AUTH_ORIGIN_GLOBAL_LIMITER: globalLimiter,
        AUTH_LOGIN_LIMITER: actorLimiter,
      },
    } as never)

    await expect(
      enforceAuthRateLimit(new Request('https://luckread.cn/auth/login'), 'AUTH_LOGIN_LIMITER', ['ip:127.0.0.1']),
    ).rejects.toBeInstanceOf(TrafficLimitError)
    expect(actorLimiter.limit).not.toHaveBeenCalled()
  })

  it('checks public-read origin and IP limits', async () => {
    const calls: string[] = []
    const globalLimiter = { limit: vi.fn(async ({ key }: { key: string }) => { calls.push(key); return { success: true } }) }
    const ipLimiter = { limit: vi.fn(async ({ key }: { key: string }) => { calls.push(key); return { success: true } }) }
    contextMock.mockResolvedValue({
      env: {
        PUBLIC_ORIGIN_GLOBAL_LIMITER: globalLimiter,
        PUBLIC_READ_LIMITER: ipLimiter,
      },
    } as never)

    await expect(
      enforcePublicReadRateLimit(
        new Request('https://luckread.cn/api/v1/users/u1', { headers: { 'cf-connecting-ip': '203.0.113.10' } }),
      ),
    ).resolves.toBeUndefined()

    expect(calls).toEqual(['public-read:origin', 'public-read:ip:203.0.113.10'])
  })

  it('returns stable 429 semantics', async () => {
    const response = rateLimitResponse(new Request('https://luckread.cn/auth/login'))
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'RATE_LIMITED', details: { retryAfter: 60 } },
    })
  })
})
