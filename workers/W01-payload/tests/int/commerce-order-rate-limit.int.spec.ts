import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class MockTrafficLimitError extends Error {}
  class MockW07SubscriptionClientError extends Error {
    status = 503
    code = 'SERVICE_UNAVAILABLE'
  }
  class MockW08CreatorClientError extends Error {}
  class MockW06ModerationClientError extends Error {}

  return {
    MockTrafficLimitError,
    MockW07SubscriptionClientError,
    MockW08CreatorClientError,
    MockW06ModerationClientError,
    enforceWriteRateLimit: vi.fn(async (_request: Request) => undefined),
    enforceWriteAccountRateLimit: vi.fn(async (_accountId: string) => undefined),
    enforceWriteEndpointRateLimit: vi.fn(async (_endpoint: string) => undefined),
    rateLimitResponse: vi.fn((_request: Request) => Response.json(
      { error: { code: 'RATE_LIMITED', details: { retryAfter: 60 } } },
      { status: 429, headers: { 'retry-after': '60' } },
    )),
    resolvePrincipal: vi.fn(async (_request: Request) => ({ userId: 'user_order_test', layer: 'L2' })),
    callW07Subscription: vi.fn(async (_input: unknown) => Response.json(
      { error: { code: 'SERVICE_UNAVAILABLE' } },
      { status: 503 },
    )),
    callW08Creator: vi.fn(async (_request: Request) => Response.json({ data: { decision: 'ALLOW' } })),
    callW06CommerceOrderAudit: vi.fn(async (_input: unknown) => Response.json({ ok: true })),
  }
})

vi.mock('../../src/auth/traffic-limit.js', () => ({
  TrafficLimitError: mocks.MockTrafficLimitError,
  enforceW01WriteRateLimit: mocks.enforceWriteRateLimit,
  enforceW01WriteAccountRateLimit: mocks.enforceWriteAccountRateLimit,
  enforceW01WriteEndpointRateLimit: mocks.enforceWriteEndpointRateLimit,
  rateLimitResponse: mocks.rateLimitResponse,
}))

vi.mock('../../src/subscription/w07-subscription-client.js', () => ({
  resolveCookieSubscriptionPrincipal: mocks.resolvePrincipal,
  callW07Subscription: mocks.callW07Subscription,
  W07SubscriptionClientError: mocks.MockW07SubscriptionClientError,
}))

vi.mock('../../src/auth/w08-creator-client.js', () => ({
  callW08Creator: mocks.callW08Creator,
  W08CreatorClientError: mocks.MockW08CreatorClientError,
}))

vi.mock('../../src/moderation/w06-moderation-client.js', () => ({
  callW06CommerceOrderAudit: mocks.callW06CommerceOrderAudit,
  W06ModerationClientError: mocks.MockW06ModerationClientError,
}))

import { POST } from '../../src/app/api/v1/commerce/orders/route.js'

const requestFor = () => new Request('https://www.luckread.com/api/v1/commerce/orders', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'Idempotency-Key': 'order-rate-limit-test-0001',
    Cookie: 'better-auth.session_token=test-session-cookie',
  },
  body: JSON.stringify({ items: [{ itemRef: 'plan_' + 'a'.repeat(64), quantity: 1 }] }),
})

beforeEach(() => {
  mocks.enforceWriteRateLimit.mockReset()
  mocks.enforceWriteRateLimit.mockResolvedValue(undefined)
  mocks.enforceWriteAccountRateLimit.mockReset()
  mocks.enforceWriteAccountRateLimit.mockResolvedValue(undefined)
  mocks.enforceWriteEndpointRateLimit.mockReset()
  mocks.enforceWriteEndpointRateLimit.mockResolvedValue(undefined)
  mocks.rateLimitResponse.mockClear()
  mocks.resolvePrincipal.mockReset()
  mocks.resolvePrincipal.mockResolvedValue({ userId: 'user_order_test', layer: 'L2' })
  mocks.callW07Subscription.mockReset()
  mocks.callW07Subscription.mockResolvedValue(Response.json(
    { error: { code: 'SERVICE_UNAVAILABLE' } },
    { status: 503 },
  ))
  mocks.callW08Creator.mockReset()
  mocks.callW08Creator.mockResolvedValue(Response.json({ data: { decision: 'ALLOW' } }))
  mocks.callW06CommerceOrderAudit.mockClear()
})

describe('W01 commerce order anti-abuse admission', () => {
  it('applies edge, account and fixed-operation buckets before W08 authorization and W07 forwarding', async () => {
    const request = requestFor()
    const response = await POST(request)

    expect(response.status).toBe(503) // W07 stub; guards passed and forwarding was reached.
    expect(mocks.enforceWriteRateLimit).toHaveBeenCalledWith(request)
    expect(mocks.enforceWriteAccountRateLimit).toHaveBeenCalledWith('user_order_test')
    expect(mocks.enforceWriteEndpointRateLimit).toHaveBeenCalledWith('createCommerceOrder')
    expect(mocks.enforceWriteRateLimit.mock.invocationCallOrder[0]).toBeLessThan(mocks.resolvePrincipal.mock.invocationCallOrder[0])
    expect(mocks.resolvePrincipal.mock.invocationCallOrder[0]).toBeLessThan(mocks.enforceWriteAccountRateLimit.mock.invocationCallOrder[0])
    expect(mocks.enforceWriteAccountRateLimit.mock.invocationCallOrder[0]).toBeLessThan(mocks.enforceWriteEndpointRateLimit.mock.invocationCallOrder[0])
    expect(mocks.enforceWriteEndpointRateLimit.mock.invocationCallOrder[0]).toBeLessThan(mocks.callW08Creator.mock.invocationCallOrder[0])
    expect(mocks.callW08Creator.mock.invocationCallOrder[0]).toBeLessThan(mocks.callW07Subscription.mock.invocationCallOrder[0])
    expect(mocks.callW07Subscription).toHaveBeenCalledTimes(1)
    expect(mocks.callW06CommerceOrderAudit).not.toHaveBeenCalled()
  })

  it('short-circuits at the edge/origin bucket before resolving identity', async () => {
    const request = requestFor()
    mocks.enforceWriteRateLimit.mockRejectedValueOnce(new mocks.MockTrafficLimitError())
    const response = await POST(request)
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
    expect(mocks.rateLimitResponse).toHaveBeenCalledWith(request)
    expect(mocks.resolvePrincipal).not.toHaveBeenCalled()
    expect(mocks.enforceWriteAccountRateLimit).not.toHaveBeenCalled()
    expect(mocks.enforceWriteEndpointRateLimit).not.toHaveBeenCalled()
    expect(mocks.callW08Creator).not.toHaveBeenCalled()
    expect(mocks.callW07Subscription).not.toHaveBeenCalled()
  })

  it('short-circuits at the authenticated account bucket before W08/W07 calls', async () => {
    mocks.enforceWriteAccountRateLimit.mockRejectedValueOnce(new mocks.MockTrafficLimitError())
    const response = await POST(requestFor())
    expect(response.status).toBe(429)
    expect(mocks.enforceWriteEndpointRateLimit).not.toHaveBeenCalled()
    expect(mocks.callW08Creator).not.toHaveBeenCalled()
    expect(mocks.callW07Subscription).not.toHaveBeenCalled()
  })

  it('short-circuits at the fixed-operation bucket before W08/W07 calls', async () => {
    mocks.enforceWriteEndpointRateLimit.mockRejectedValueOnce(new mocks.MockTrafficLimitError())
    const response = await POST(requestFor())
    expect(response.status).toBe(429)
    expect(mocks.enforceWriteEndpointRateLimit).toHaveBeenCalledWith('createCommerceOrder')
    expect(mocks.callW08Creator).not.toHaveBeenCalled()
    expect(mocks.callW07Subscription).not.toHaveBeenCalled()
  })

  it('fails closed when a rate-limit binding is unavailable', async () => {
    mocks.enforceWriteRateLimit.mockRejectedValueOnce(new Error('RATE_LIMIT_BINDING_UNAVAILABLE'))
    const response = await POST(requestFor())
    expect(response.status).toBe(503)
    expect(mocks.resolvePrincipal).not.toHaveBeenCalled()
    expect(mocks.callW07Subscription).not.toHaveBeenCalled()
  })
})
