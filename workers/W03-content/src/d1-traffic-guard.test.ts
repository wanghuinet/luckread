import { describe, expect, it, vi } from 'vitest'
import worker from './index.js'

describe('W03 D1 traffic guard', () => {
  it('rejects a public read before touching D1 when the limiter is exhausted', async () => {
    const prepare = vi.fn()
    const limiter = {
      limit: vi.fn(async () => ({ success: false })),
    }

    const response = await worker.fetch(
      new Request('https://luckread-w03.internal/internal/content/contents'),
      {
        D1_02: { prepare } as unknown as D1Database,
        CONTENT_PUBLIC_READ_LIMITER: limiter,
      },
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'RATE_LIMITED', details: { retryAfter: 60 } },
    })
    expect(limiter.limit).toHaveBeenCalledTimes(1)
    expect(prepare).not.toHaveBeenCalled()
  })

  it('rejects a mutation before touching D1 when the limiter is exhausted', async () => {
    const prepare = vi.fn()
    const limiter = {
      limit: vi.fn(async () => ({ success: false })),
    }

    const response = await worker.fetch(
      new Request('https://luckread-w03.internal/internal/content/contents', {
        method: 'POST',
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'traffic-test',
          'X-LuckRead-Principal-User-Id': 'creator-1',
          'X-LuckRead-Principal-Layer': 'L3',
          'Idempotency-Key': 'content-1',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ title: 'x', bodyRef: 'r', contentType: 'article', mediaRefs: [] }),
      }),
      {
        D1_02: { prepare } as unknown as D1Database,
        CONTENT_MUTATION_LIMITER: limiter,
      },
    )

    expect(response.status).toBe(429)
    expect(prepare).not.toHaveBeenCalled()
  })
})
