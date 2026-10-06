import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  callW02BetterAuth: vi.fn(),
  enforceAuthRateLimit: vi.fn(),
  TrafficLimitError: class extends Error {},
}))

vi.mock('../../src/auth/w02-auth-client.js', () => ({
  callW02BetterAuth: mocks.callW02BetterAuth,
}))

vi.mock('../../src/auth/traffic-limit.js', () => ({
  enforceAuthRateLimit: mocks.enforceAuthRateLimit,
  TrafficLimitError: mocks.TrafficLimitError,
  rateLimitResponse: vi.fn(),
}))

import { POST } from '../../src/app/auth/logout/route'

describe('Better Auth W01 logout proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enforceAuthRateLimit.mockResolvedValue(undefined)
  })

  it('forwards the incoming Better Auth session request', async () => {
    mocks.callW02BetterAuth.mockResolvedValue(new Response(null, { status: 204 }))

    const response = await POST(
      new Request('https://example.test/auth/logout', {
        method: 'POST',
        headers: { cookie: 'better-auth.session_token=session-1' },
      }),
    )

    expect(response.status).toBe(204)
    expect(mocks.callW02BetterAuth).toHaveBeenCalledWith(
      expect.any(Request),
      '/api/auth/sign-out',
      { method: 'POST' },
    )
  })

  it('passes through Better Auth failures', async () => {
    mocks.callW02BetterAuth.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), { status: 401 }),
    )

    const response = await POST(
      new Request('https://example.test/auth/logout', { method: 'POST' }),
    )

    expect(response.status).toBe(401)
  })
})
