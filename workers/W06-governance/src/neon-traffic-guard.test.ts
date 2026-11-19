import { describe, expect, it, vi } from 'vitest'
import runtime from './index.js'

describe('W06 Neon traffic guard', () => {
  it('rejects exhausted origin traffic before Neon Store composition or W03 transport', async () => {
    const fetch = vi.fn()
    const env = {
      W03_CONTENT_MODERATION: { fetch },
      GOVERNANCE_ORIGIN_GLOBAL_LIMITER: { limit: vi.fn(async () => ({ success: false })) },
    }
    const response = await runtime.fetch(
      new Request('https://luckread-w06.internal/reports', { method: 'POST' }),
      env as never,
    )

    expect(response.status).toBe(429)
    expect(fetch).not.toHaveBeenCalled()
  })
})
