import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  proxyBetterAuth: vi.fn(),
  enforceAuthRateLimit: vi.fn(),
  TrafficLimitError: class extends Error {},
}))

vi.mock('../../src/auth/w02-session-client.js', () => ({
  proxyBetterAuth: mocks.proxyBetterAuth,
}))

vi.mock('../../src/auth/traffic-limit.js', () => ({
  enforceAuthRateLimit: mocks.enforceAuthRateLimit,
  TrafficLimitError: mocks.TrafficLimitError,
  rateLimitResponse: vi.fn(() => new Response(null, { status: 429 })),
}))

import { POST } from '../../src/app/api/v1/auth/verification/send/route.js'

const request = (body: unknown) => new Request('https://luckread.test/api/v1/auth/verification/send', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'cf-connecting-ip': '203.0.113.10',
  },
  body: JSON.stringify(body),
})

describe('public email verification resend API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enforceAuthRateLimit.mockResolvedValue(undefined)
    mocks.proxyBetterAuth.mockResolvedValue(new Response(null, { status: 200 }))
  })

  it('normalizes email and keeps identity behind the W02 service binding', async () => {
    const response = await POST(request({ identity: ' Reader@Example.com ' }))

    expect(response.status).toBe(202)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.enforceAuthRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      'AUTH_REGISTER_LIMITER',
      ['ip:203.0.113.10'],
    )
    expect(mocks.proxyBetterAuth).toHaveBeenCalledWith(
      expect.any(Request),
      '/send-verification-email',
      {
        body: {
          email: 'reader@example.com',
          callbackURL: 'https://luckread.com/login?verified=1',
        },
      },
    )
  })

  it('does not reveal account existence for Better Auth validation outcomes', async () => {
    mocks.proxyBetterAuth.mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'USER_NOT_FOUND' },
    }), { status: 400 }))

    const response = await POST(request({ identity: 'unknown@example.com' }))
    expect(response.status).toBe(202)
    expect(await response.text()).toBe('')
  })

  it('rejects malformed requests before invoking Better Auth', async () => {
    const response = await POST(request({ identity: 'not-an-email' }))
    expect(response.status).toBe(422)
    expect(mocks.proxyBetterAuth).not.toHaveBeenCalled()
  })

  it('fails closed when the identity service is unavailable', async () => {
    mocks.proxyBetterAuth.mockRejectedValue(new Error('W02 unavailable'))

    const response = await POST(request({ identity: 'reader@example.com' }))
    expect(response.status).toBe(503)
  })
})
