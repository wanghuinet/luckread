import { describe, expect, it, vi } from 'vitest'
import runtime from './index.js'

describe('W06 D1 traffic guard', () => {
  it('rejects exhausted origin traffic before transport or D1', async () => {
    const prepare = vi.fn()
    const env = {
      D1_03: { prepare } as unknown as D1Database,
      W03_CONTENT_MODERATION: { fetch: vi.fn() } as unknown as Fetcher,
      GOVERNANCE_ORIGIN_GLOBAL_LIMITER: { limit: vi.fn(async () => ({ success: false })) },
    }

    const response = await runtime.fetch(
      new Request('https://luckread-w06.internal/reports', { method: 'POST' }),
      env,
    )

    expect(response.status).toBe(429)
    expect(prepare).not.toHaveBeenCalled()
  })
})
