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

import { POST } from '../../src/app/auth/login/route.js'

function jsonRequest(body: unknown): Request {
  return new Request('https://luckread.test/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('Better Auth W01 login proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enforceAuthRateLimit.mockResolvedValue(undefined)
  })

  it('rejects malformed credentials locally', async () => {
    const response = await POST(jsonRequest({ identity: '', credential: '' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'VALIDATION_FAILED' },
    })
    expect(mocks.callW02BetterAuth).not.toHaveBeenCalled()
  })

  it('forwards normalized email and password to Better Auth', async () => {
    mocks.callW02BetterAuth.mockResolvedValue(
      new Response(JSON.stringify({ token: 'ignored' }), {
        status: 200,
        headers: { 'set-cookie': 'better-auth.session_token=session-1; Path=/; HttpOnly' },
      }),
    )

    const response = await POST(
      jsonRequest({ identity: ' USER42@EXAMPLE.COM ', credential: 'Correct-password-123!' }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('better-auth.session_token=session-1')
    expect(mocks.callW02BetterAuth).toHaveBeenCalledWith(
      expect.any(Request),
      '/api/auth/sign-in/email',
      {
        method: 'POST',
        body: {
          email: 'user42@example.com',
          password: 'Correct-password-123!',
        },
      },
    )
  })

  it('passes Better Auth authentication failures through without minting another token', async () => {
    mocks.callW02BetterAuth.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const response = await POST(
      jsonRequest({ identity: 'user42@example.com', credential: 'Wrong-password-123!' }),
    )

    expect(response.status).toBe(401)
    expect(mocks.callW02BetterAuth).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the W02 service binding is unavailable', async () => {
    mocks.callW02BetterAuth.mockRejectedValue(new Error('service unavailable'))

    const response = await POST(
      jsonRequest({ identity: 'user42@example.com', credential: 'Correct-password-123!' }),
    )

    expect(response.status).toBe(503)
  })
})
