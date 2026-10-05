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
})
