import { describe, expect, it, vi } from 'vitest'
import worker from './index.js'

const request = (pathname: string, method = 'GET') =>
  new Request('https://luckread-w05.internal' + pathname, {
    method,
    headers: {
      'X-LuckRead-Caller': 'W01',
      'X-LuckRead-Transport-Version': '1.0',
      'X-LuckRead-Correlation-Id': 'traffic-test',
    },
  })

describe('W05 D1 traffic guard', () => {
  it('rejects a public social read before touching D1 when the limiter is exhausted', async () => {
    const prepare = vi.fn()
    const limiter = { limit: vi.fn(async () => ({ success: false })) }

    const response = await worker.fetch(
      request('/internal/social/users/creator-1/followers?limit=20'),
      {
        DB: { prepare } as unknown as D1Database,
        SOCIAL_READ_LIMITER: limiter,
      },
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'RATE_LIMITED' },
    })
    expect(prepare).not.toHaveBeenCalled()
  })

  it('rejects an interaction write before touching D1 when the limiter is exhausted', async () => {
    const prepare = vi.fn()
    const limiter = { limit: vi.fn(async () => ({ success: false })) }

    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/likes', {
        method: 'POST',
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'traffic-test',
          'X-LuckRead-Principal-User-Id': 'user-1',
          'X-LuckRead-Principal-Layer': 'L2',
          'Idempotency-Key': 'like-1',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ targetType: 'content', targetId: 'content-1' }),
      }),
      {
        DB: { prepare } as unknown as D1Database,
        SOCIAL_WRITE_LIMITER: limiter,
      },
    )

    expect(response.status).toBe(429)
    expect(prepare).not.toHaveBeenCalled()
  })
})
