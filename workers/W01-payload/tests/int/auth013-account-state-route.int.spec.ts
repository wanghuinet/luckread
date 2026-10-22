import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class MockW02AuthClientError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message)
    }
  }

  class MockTrafficLimitError extends Error {
    constructor(readonly retryAfterSeconds = 60) {
      super('RATE_LIMITED')
    }
  }

  return {
    getBetterAuthPrincipal: vi.fn(),
    transitionAccountState: vi.fn(),
    enforceW01WriteRateLimit: vi.fn(),
    rateLimitResponse: vi.fn(),
    MockW02AuthClientError,
    MockTrafficLimitError,
  }
})

vi.mock('../../src/auth/w02-session-client.js', () => ({
  getBetterAuthPrincipal: mocks.getBetterAuthPrincipal,
  transitionAccountState: mocks.transitionAccountState,
  W02AuthClientError: mocks.MockW02AuthClientError,
}))

vi.mock('../../src/auth/traffic-limit.js', () => ({
  TrafficLimitError: mocks.MockTrafficLimitError,
  enforceW01WriteRateLimit: mocks.enforceW01WriteRateLimit,
  rateLimitResponse: mocks.rateLimitResponse,
}))

import { POST } from '../../src/app/users/[userId]/account-state/route.js'

describe('AUTH-013 W01 public account-state route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.enforceW01WriteRateLimit.mockResolvedValue(undefined)
    mocks.rateLimitResponse.mockImplementation(() => Response.json({
      error: { code: 'RATE_LIMITED', message: 'Too many requests', details: { retryAfter: 60 } },
      requestId: 'req_rate_limited',
    }, { status: 429, headers: { 'cache-control': 'no-store', 'retry-after': '60' } }))
    mocks.getBetterAuthPrincipal.mockResolvedValue({ active: true, userId: '7', email: 'user@example.com', layer: 'L7' })
    mocks.transitionAccountState.mockResolvedValue({
      from: 'ACTIVE',
      to: 'RESTRICTED',
      auditEventId: 'evt-013',
    })
  })

  it('rate limits account-state writes before authentication or state mutation', async () => {
    mocks.enforceW01WriteRateLimit.mockRejectedValueOnce(new mocks.MockTrafficLimitError())

    const response = await POST(
      new Request('https://luckread.test/v1/users/42/account-state', { method: 'POST' }),
      { params: Promise.resolve({ userId: '42' }) },
    )

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'RATE_LIMITED' },
    })
    expect(mocks.enforceW01WriteRateLimit).toHaveBeenCalledTimes(1)
    expect(mocks.rateLimitResponse).toHaveBeenCalledTimes(1)
    expect(mocks.getBetterAuthPrincipal).not.toHaveBeenCalled()
    expect(mocks.transitionAccountState).not.toHaveBeenCalled()
  })

  it('fails closed when the write rate-limit binding is unavailable', async () => {
    mocks.enforceW01WriteRateLimit.mockRejectedValueOnce(new Error('RATE_LIMIT_BINDING_UNAVAILABLE:W01_WRITE_LIMITER'))

    const response = await POST(
      new Request('https://luckread.test/v1/users/42/account-state', { method: 'POST' }),
      { params: Promise.resolve({ userId: '42' }) },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'SERVICE_UNAVAILABLE' },
    })
    expect(mocks.getBetterAuthPrincipal).not.toHaveBeenCalled()
    expect(mocks.transitionAccountState).not.toHaveBeenCalled()
  })

  it('denies requests without a Better Auth principal', async () => {
    mocks.getBetterAuthPrincipal.mockRejectedValue(new mocks.MockW02AuthClientError(401, 'unauthenticated'))

    const response = await POST(
      new Request('https://luckread.test/v1/users/42/account-state', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer missing',
          'If-Match': '"7"',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ to: 'RESTRICTED', reason: 'moderation action' }),
      }),
      { params: Promise.resolve({ userId: '42' }) },
    )

    expect(response.status).toBe(401)
    expect(mocks.transitionAccountState).not.toHaveBeenCalled()
  })

  it('preserves W02 authentication-service failure as 503', async () => {
    mocks.getBetterAuthPrincipal.mockRejectedValue(new mocks.MockW02AuthClientError(503, 'service unavailable'))

    const response = await POST(
      new Request('https://luckread.test/v1/users/42/account-state', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer verified',
          'If-Match': '"7"',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ to: 'RESTRICTED', reason: 'moderation action' }),
      }),
      { params: Promise.resolve({ userId: '42' }) },
    )

    expect(response.status).toBe(503)
    expect(mocks.transitionAccountState).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'SERVICE_UNAVAILABLE' },
    })
  })

  it('maps W02 transition service failure to service unavailable', async () => {
    mocks.transitionAccountState.mockRejectedValue(new mocks.MockW02AuthClientError(503, 'service unavailable'))

    const response = await POST(
      new Request('https://luckread.test/v1/users/42/account-state', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer verified',
          'If-Match': '"7"',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ to: 'RESTRICTED', reason: 'moderation action' }),
      }),
      { params: Promise.resolve({ userId: '42' }) },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Account-state service unavailable' },
    })
  })

  it('passes only the verified principal and canonical public fields to W02', async () => {
    const response = await POST(
      new Request('https://luckread.test/v1/users/42/account-state', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer verified',
          'If-Match': '"7"',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          to: 'RESTRICTED',
          reason: 'moderation action',
          actor: { id: 'attacker', type: 'admin' },
          permission: 'user.ban',
          approvalLevel: 'L8',
        }),
      }),
      { params: Promise.resolve({ userId: '42' }) },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      from: 'ACTIVE',
      to: 'RESTRICTED',
      auditEventId: 'evt-013',
    })

    expect(mocks.transitionAccountState).toHaveBeenCalledWith(expect.any(Request), {
      subjectId: '7',
      targetUserId: '42',
      to: 'RESTRICTED',
      reason: 'moderation action',
      expectedVersion: 7,
    })

    const transitionInput = mocks.transitionAccountState.mock.calls[0][1]
    expect(transitionInput).not.toHaveProperty('actor')
    expect(transitionInput).not.toHaveProperty('permission')
    expect(transitionInput).not.toHaveProperty('approvalLevel')
  })
})
