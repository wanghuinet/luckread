import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  proxyBetterAuth: vi.fn(),
  enforceW01WriteRateLimit: vi.fn(),
  enforceW01WriteEndpointRateLimit: vi.fn(),
  TrafficLimitError: class extends Error {},
  rateLimitResponse: vi.fn(() => new Response(null, { status: 429 })),
}))

vi.mock('../../src/auth/w02-session-client.js', () => ({
  proxyBetterAuth: mocks.proxyBetterAuth,
}))

vi.mock('../../src/auth/traffic-limit.js', () => ({
  enforceW01WriteRateLimit: mocks.enforceW01WriteRateLimit,
  enforceW01WriteEndpointRateLimit: mocks.enforceW01WriteEndpointRateLimit,
  TrafficLimitError: mocks.TrafficLimitError,
  rateLimitResponse: mocks.rateLimitResponse,
}))

import { POST } from '../../src/app/api/v1/auth/password/reset/request/route.js'

const request = (body: unknown) => new Request('https://luckread.test/api/v1/auth/password/reset/request', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'cf-connecting-ip': '203.0.113.10',
  },
  body: JSON.stringify(body),
})

describe('password recovery request rate limits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enforceW01WriteRateLimit.mockResolvedValue(undefined)
    mocks.enforceW01WriteEndpointRateLimit.mockResolvedValue(undefined)
    mocks.proxyBetterAuth.mockResolvedValue(new Response(null, { status: 200 }))
  })

  it('checks W01 origin/IP and fixed operation buckets before forwarding the request', async () => {
    const response = await POST(request({ identifier: ' Reader@Example.com ' }))

    expect(response.status).toBe(202)
    expect(mocks.enforceW01WriteRateLimit).toHaveBeenCalledWith(expect.any(Request))
    expect(mocks.enforceW01WriteEndpointRateLimit).toHaveBeenCalledWith('authPasswordResetRequest')
    expect(mocks.proxyBetterAuth).toHaveBeenCalledWith(expect.any(Request), '/request-password-reset', {
      body: {
        email: 'reader@example.com',
        redirectTo: 'https://luckread.com/reset-password',
      },
    })
  })

  it('returns the canonical 429 response when either limiter is exhausted', async () => {
    mocks.enforceW01WriteEndpointRateLimit.mockRejectedValue(new mocks.TrafficLimitError())

    const response = await POST(request({ identifier: 'reader@example.com' }))

    expect(response.status).toBe(429)
    expect(mocks.rateLimitResponse).toHaveBeenCalledWith(expect.any(Request))
    expect(mocks.proxyBetterAuth).not.toHaveBeenCalled()
  })

  it('fails closed when rate-limit infrastructure is unavailable', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.enforceW01WriteRateLimit.mockRejectedValue(new Error('RATE_LIMIT_BINDING_UNAVAILABLE'))

    const response = await POST(request({ identifier: 'reader@example.com' }))

    expect(response.status).toBe(503)
    expect(mocks.proxyBetterAuth).not.toHaveBeenCalled()
    expect(error.mock.calls.flat().join(' ')).toContain('AUTH_PASSWORD_RESET_REQUEST_RATE_LIMIT_FAILURE')
    expect(error.mock.calls.flat().join(' ')).not.toContain('reader@example.com')
    error.mockRestore()
  })

  it('keeps account-enumeration-resistant success semantics after rate limiting', async () => {
    mocks.proxyBetterAuth.mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'USER_NOT_FOUND' },
    }), { status: 200 }))

    const response = await POST(request({ identifier: 'unknown@example.com' }))

    expect(response.status).toBe(202)
    expect(await response.text()).toBe('')
  })

  it('rejects malformed identifiers without calling Better Auth', async () => {
    const response = await POST(request({ identifier: 'not-an-email' }))

    expect(response.status).toBe(422)
    expect(mocks.proxyBetterAuth).not.toHaveBeenCalled()
    expect(mocks.enforceW01WriteRateLimit).toHaveBeenCalled()
  })
})
