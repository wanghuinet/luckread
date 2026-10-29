import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: vi.fn(),
}))

import { getCloudflareContext } from '@opennextjs/cloudflare'
import {
  enforceAuthRateLimit,
  enforcePublicReadRateLimit,
  enforceW01WriteRateLimit,
  enforceW01WriteAccountRateLimit,
  enforceW01WriteEndpointRateLimit,
  enforceW01WriteResourceRateLimit,
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
        new Request('https://luckread.com/auth/login'),
        'AUTH_LOGIN_LIMITER',
        ['ip:127.0.0.1'],
      ),
    ).resolves.toBeUndefined()

    expect(calls).toEqual(['AUTH_LOGIN_LIMITER:origin', 'AUTH_LOGIN_LIMITER:ip:127.0.0.1'])
  })

  it('fails closed when the actor limiter binding is absent', async () => {
    contextMock.mockResolvedValue({ env: { AUTH_ORIGIN_GLOBAL_LIMITER: { limit: vi.fn(async () => ({ success: true })) } } } as never)
    await expect(
      enforceAuthRateLimit(new Request('https://luckread.com/auth/login'), 'AUTH_LOGIN_LIMITER', ['ip:127.0.0.1']),
    ).rejects.toThrow('RATE_LIMIT_BINDING_UNAVAILABLE:AUTH_LOGIN_LIMITER')
  })

  it('fails closed when the auth limiter Cloudflare context is unavailable', async () => {
    contextMock.mockRejectedValue(new Error('Cloudflare context unavailable'))

    await expect(
      enforceAuthRateLimit(
        new Request('https://luckread.com/auth/login'),
        'AUTH_LOGIN_LIMITER',
        ['ip:127.0.0.1'],
      ),
    ).rejects.toThrow('RATE_LIMIT_CONTEXT_UNAVAILABLE:AUTH_LOGIN_LIMITER')
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
      enforceAuthRateLimit(new Request('https://luckread.com/auth/login'), 'AUTH_LOGIN_LIMITER', ['ip:127.0.0.1']),
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
        new Request('https://luckread.com/api/v1/users/u1', { headers: { 'cf-connecting-ip': '203.0.113.10' } }),
      ),
    ).resolves.toBeUndefined()

    expect(calls).toEqual(['public-read:origin', 'public-read:ip:203.0.113.10'])
  })

  it('fails closed when the public-read limiter Cloudflare context is unavailable', async () => {
    contextMock.mockRejectedValue(new Error('Cloudflare context unavailable'))

    await expect(
      enforcePublicReadRateLimit(new Request('https://luckread.com/api/v1/users/u1')),
    ).rejects.toThrow('RATE_LIMIT_CONTEXT_UNAVAILABLE:PUBLIC_READ_LIMITER')
  })

  it('returns stable 429 semantics', async () => {
    const response = rateLimitResponse(new Request('https://luckread.com/auth/login'))
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'RATE_LIMITED', details: { retryAfter: 60 } },
    })
  })

  it('fails closed when W01 write limiter context cannot be resolved', async () => {
    contextMock.mockRejectedValue(new Error('Cloudflare context unavailable'))

    await expect(
      enforceW01WriteRateLimit(new Request('https://luckread.com/api/v1/media')),
    ).rejects.toThrow('RATE_LIMIT_CONTEXT_UNAVAILABLE:W01_WRITE_LIMITER')
  })

  it('checks W01 write origin and IP limits before Payload writes', async () => {
    const calls: string[] = []
    const globalLimiter = { limit: vi.fn(async ({ key }: { key: string }) => { calls.push(key); return { success: true } }) }
    const writeLimiter = { limit: vi.fn(async ({ key }: { key: string }) => { calls.push(key); return { success: true } }) }
    contextMock.mockResolvedValue({
      env: {
        W01_WRITE_ORIGIN_GLOBAL_LIMITER: globalLimiter,
        W01_WRITE_LIMITER: writeLimiter,
      },
    } as never)

    await expect(
      enforceW01WriteRateLimit(
        new Request('https://luckread.com/api/v1/media', { headers: { 'cf-connecting-ip': '203.0.113.11' } }),
      ),
    ).resolves.toBeUndefined()

    expect(calls).toEqual(['w01-write:origin', 'w01-write:ip:203.0.113.11'])
  })

  it('rejects W01 writes when the origin breaker is exhausted', async () => {
    const globalLimiter = { limit: vi.fn(async () => ({ success: false })) }
    const writeLimiter = { limit: vi.fn(async () => ({ success: true })) }
    contextMock.mockResolvedValue({
      env: {
        W01_WRITE_ORIGIN_GLOBAL_LIMITER: globalLimiter,
        W01_WRITE_LIMITER: writeLimiter,
      },
    } as never)

    await expect(
      enforceW01WriteRateLimit(new Request('https://luckread.com/api/v1/media')),
    ).rejects.toBeInstanceOf(TrafficLimitError)
    expect(writeLimiter.limit).not.toHaveBeenCalled()
  })


  it('fails closed when the W01 global write limiter binding is missing', async () => {
    const writeLimiter = { limit: vi.fn(async () => ({ success: true })) }
    contextMock.mockResolvedValue({ env: { W01_WRITE_LIMITER: writeLimiter } } as never)

    await expect(
      enforceW01WriteRateLimit(new Request('https://luckread.com/api/v1/media')),
    ).rejects.toThrow('RATE_LIMIT_BINDING_UNAVAILABLE:W01_WRITE_ORIGIN_GLOBAL_LIMITER')

    expect(writeLimiter.limit).not.toHaveBeenCalled()
  })

  it('fails closed when account-scope limiter context cannot be resolved', async () => {
    contextMock.mockRejectedValue(new Error('Cloudflare context unavailable'))

    await expect(enforceW01WriteAccountRateLimit('operator-42')).rejects.toThrow(
      'RATE_LIMIT_CONTEXT_UNAVAILABLE:W01_WRITE_LIMITER',
    )
  })

  it('checks the authenticated account bucket for W01 writes', async () => {
    const calls: string[] = []
    const writeLimiter = { limit: vi.fn(async ({ key }: { key: string }) => { calls.push(key); return { success: true } }) }
    contextMock.mockResolvedValue({ env: { W01_WRITE_LIMITER: writeLimiter } } as never)

    await expect(enforceW01WriteAccountRateLimit('operator-42')).resolves.toBeUndefined()

    expect(calls).toEqual(['w01-write:account:operator-42'])
  })

  it('rejects an exhausted W01 account bucket', async () => {
    const writeLimiter = { limit: vi.fn(async () => ({ success: false })) }
    contextMock.mockResolvedValue({ env: { W01_WRITE_LIMITER: writeLimiter } } as never)

    await expect(enforceW01WriteAccountRateLimit('operator-42')).rejects.toBeInstanceOf(TrafficLimitError)
    expect(writeLimiter.limit).toHaveBeenCalledWith({ key: 'w01-write:account:operator-42' })
  })

  it('fails closed when the W01 account limiter binding is missing', async () => {
    contextMock.mockResolvedValue({ env: {} } as never)

    await expect(enforceW01WriteAccountRateLimit('operator-42')).rejects.toThrow(
      'RATE_LIMIT_BINDING_UNAVAILABLE:W01_WRITE_LIMITER',
    )
  })


  it('fails closed when endpoint-scope limiter context cannot be resolved', async () => {
    contextMock.mockRejectedValue(new Error('Cloudflare context unavailable'))

    await expect(enforceW01WriteEndpointRateLimit('transitionAccountState')).rejects.toThrow(
      'RATE_LIMIT_CONTEXT_UNAVAILABLE:W01_WRITE_LIMITER',
    )
  })

  it('checks the fixed W01 endpoint bucket', async () => {
    const writeLimiter = { limit: vi.fn(async ({ key }: { key: string }) => ({ success: true })) }
    contextMock.mockResolvedValue({ env: { W01_WRITE_LIMITER: writeLimiter } } as never)

    await expect(enforceW01WriteEndpointRateLimit('transitionAccountState')).resolves.toBeUndefined()

    expect(writeLimiter.limit).toHaveBeenCalledWith({ key: 'w01-write:endpoint:transitionAccountState' })
  })

  it('rejects an exhausted W01 endpoint bucket', async () => {
    const writeLimiter = { limit: vi.fn(async () => ({ success: false })) }
    contextMock.mockResolvedValue({ env: { W01_WRITE_LIMITER: writeLimiter } } as never)

    await expect(enforceW01WriteEndpointRateLimit('transitionAccountState')).rejects.toBeInstanceOf(TrafficLimitError)
  })

  it('fails closed when the W01 endpoint limiter binding is missing', async () => {
    contextMock.mockResolvedValue({ env: {} } as never)

    await expect(enforceW01WriteEndpointRateLimit('transitionAccountState')).rejects.toThrow(
      'RATE_LIMIT_BINDING_UNAVAILABLE:W01_WRITE_LIMITER',
    )
  })

  it('rejects unbounded or user-controlled endpoint identifiers', async () => {
    await expect(enforceW01WriteEndpointRateLimit('/users/42/account-state')).rejects.toThrow('RATE_LIMIT_ENDPOINT_INVALID')
    expect(contextMock).not.toHaveBeenCalled()
  })
  it('fails closed when resource-scope limiter context cannot be resolved', async () => {
    contextMock.mockRejectedValue(new Error('Cloudflare context unavailable'))
    await expect(enforceW01WriteResourceRateLimit('content', 'content-42')).rejects.toThrow(
      'RATE_LIMIT_CONTEXT_UNAVAILABLE:W01_WRITE_LIMITER',
    )
  })

  it('checks the stable W01 resource bucket', async () => {
    const writeLimiter = { limit: vi.fn(async () => ({ success: true })) }
    contextMock.mockResolvedValue({ env: { W01_WRITE_LIMITER: writeLimiter } } as never)

    await expect(enforceW01WriteResourceRateLimit('content', 'content-42')).resolves.toBeUndefined()

    expect(writeLimiter.limit).toHaveBeenCalledWith({
      key: 'w01-write:resource:content:content-42',
    })
  })

  it('rejects an exhausted W01 resource bucket', async () => {
    const writeLimiter = { limit: vi.fn(async () => ({ success: false })) }
    contextMock.mockResolvedValue({ env: { W01_WRITE_LIMITER: writeLimiter } } as never)

    await expect(enforceW01WriteResourceRateLimit('content', 'content-42')).rejects.toBeInstanceOf(TrafficLimitError)
  })

  it('fails closed when the W01 resource limiter binding is missing', async () => {
    contextMock.mockResolvedValue({ env: {} } as never)

    await expect(enforceW01WriteResourceRateLimit('content', 'content-42')).rejects.toThrow(
      'RATE_LIMIT_BINDING_UNAVAILABLE:W01_WRITE_LIMITER',
    )
  })

  it('rejects unbounded or non-canonical resource identifiers before context lookup', async () => {
    await expect(enforceW01WriteResourceRateLimit('../content', 'content-42')).rejects.toThrow(
      'RATE_LIMIT_RESOURCE_SUBJECT_INVALID',
    )
    await expect(enforceW01WriteResourceRateLimit('content', '../content-42')).rejects.toThrow(
      'RATE_LIMIT_RESOURCE_SUBJECT_INVALID',
    )
    expect(contextMock).not.toHaveBeenCalled()
  })
})
