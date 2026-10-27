import { describe, expect, it, vi } from 'vitest'
import runtime from './index.js'

describe('W07 D1 traffic guard', () => {
  it('rejects exhausted origin traffic before D1 or transport work', async () => {
    const prepare = vi.fn()
    const env = {
      D1_01: { prepare } as unknown as D1Database,
      SUBSCRIPTION_ORIGIN_GLOBAL_LIMITER: { limit: vi.fn(async () => ({ success: false })) },
    }

    const response = await runtime.fetch(
      new Request('https://luckread-w07.internal/memberships/subscriptions', { method: 'GET' }),
      env,
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
    expect(prepare).not.toHaveBeenCalled()
  })

  it('fails closed when the origin limiter is missing', async () => {
    const prepare = vi.fn()
    const response = await runtime.fetch(
      new Request('https://luckread-w07.internal/memberships/subscriptions', { method: 'GET' }),
      { D1_01: { prepare } as unknown as D1Database },
    )
    expect(response.status).toBe(503)
    expect(prepare).not.toHaveBeenCalled()
  })

  it('fails closed when the actor limiter is missing after origin allowance', async () => {
    const prepare = vi.fn()
    const response = await runtime.fetch(
      new Request('https://luckread-w07.internal/memberships/subscriptions', { method: 'GET' }),
      {
        D1_01: { prepare } as unknown as D1Database,
        SUBSCRIPTION_ORIGIN_GLOBAL_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
      },
    )
    expect(response.status).toBe(503)
    expect(prepare).not.toHaveBeenCalled()
  })

  it('fails closed with 503 when the configured origin limiter throws', async () => {
    const prepare = vi.fn()
    const response = await runtime.fetch(
      new Request('https://luckread-w07.internal/memberships/subscriptions', { method: 'GET' }),
      {
        D1_01: { prepare } as unknown as D1Database,
        SUBSCRIPTION_ORIGIN_GLOBAL_LIMITER: { limit: vi.fn(async () => { throw new Error('limiter unavailable') }) },
        SUBSCRIPTION_READ_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
      },
    )
    expect(response.status).toBe(503)
    const body = await response.json() as { error?: { code?: string; message?: string } }
    expect(body.error?.code).toBe('SERVICE_UNAVAILABLE')
    expect(body.error?.message).toBe('service unavailable')
    expect(prepare).not.toHaveBeenCalled()
  })

  it('fails closed with 503 when the actor limiter throws', async () => {
    const prepare = vi.fn()
    const response = await runtime.fetch(
      new Request('https://luckread-w07.internal/memberships/subscriptions', { method: 'GET' }),
      {
        D1_01: { prepare } as unknown as D1Database,
        SUBSCRIPTION_ORIGIN_GLOBAL_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
        SUBSCRIPTION_READ_LIMITER: { limit: vi.fn(async () => { throw new Error('actor limiter unavailable') }) },
      },
    )
    expect(response.status).toBe(503)
    expect(prepare).not.toHaveBeenCalled()
  })
})
