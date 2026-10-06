import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enforceAuthRateLimit: vi.fn(),
  TrafficLimitError: class extends Error {},
  rateLimitResponse: vi.fn(),
}))

vi.mock('../../src/auth/traffic-limit.js', () => ({
  enforceAuthRateLimit: mocks.enforceAuthRateLimit,
  TrafficLimitError: mocks.TrafficLimitError,
  rateLimitResponse: mocks.rateLimitResponse,
}))

import { POST } from '../../src/app/auth/refresh/route.js'

describe('Retired custom refresh endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enforceAuthRateLimit.mockResolvedValue(undefined)
  })

  it('does not issue or validate custom refresh credentials', async () => {
    const response = await POST(
      new Request('https://luckread.test/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: 'ignored', deviceId: 'ignored' }),
      }),
    )

    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'AUTH_REFRESH_RETIRED' },
    })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
