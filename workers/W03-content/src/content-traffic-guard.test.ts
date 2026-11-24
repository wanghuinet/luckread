import { describe, expect, it, vi } from 'vitest'
import worker from './index.js'

describe('W03 content rate-limit boundary', () => {
  it('rejects a public read before resolving content persistence when the limiter is exhausted', async () => {
    const limiter = { limit: vi.fn(async () => ({ success: false })) }
    const response = await worker.fetch(
      new Request('https://luckread-w03.internal/internal/content/contents'),
      { CONTENT_PUBLIC_READ_LIMITER: limiter } as never,
    )
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'RATE_LIMITED', details: { retryAfter: 60 } },
    })
    expect(limiter.limit).toHaveBeenCalledTimes(1)
  })

  it('rejects a mutation before resolving content persistence when the limiter is exhausted', async () => {
    const limiter = { limit: vi.fn(async () => ({ success: false })) }
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
        body: JSON.stringify({
          contentType: 'article',
          title: 'x',
          bodyRef: 'r',
          mediaRefs: [],
        }),
      }),
      { CONTENT_MUTATION_LIMITER: limiter } as never,
    )
    expect(response.status).toBe(429)
    expect(limiter.limit).toHaveBeenCalledTimes(1)
  })
})
