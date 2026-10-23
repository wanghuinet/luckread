import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const mocks = vi.hoisted(() => {
  class MockTrafficLimitError extends Error {}
  class MockW05SocialClientError extends Error {
    status = 503
    code = 'SERVICE_UNAVAILABLE'
  }

  return {
    MockTrafficLimitError,
    MockW05SocialClientError,
    enforceWriteRateLimit: vi.fn(async (_request: Request) => undefined),
    rateLimitResponse: vi.fn((_request: Request) => new Response('rate limited', { status: 429 })),
    resolvePrincipal: vi.fn(async (_request: Request) => ({ userId: 'user_test_01', layer: 'L2' })),
    callW05Social: vi.fn(async (_input: unknown) => Response.json({ data: { ok: true } }, { status: 200 })),
  }
})

vi.mock('../../src/auth/traffic-limit.js', () => ({
  TrafficLimitError: mocks.MockTrafficLimitError,
  enforceW01WriteRateLimit: mocks.enforceWriteRateLimit,
  rateLimitResponse: mocks.rateLimitResponse,
}))

vi.mock('../../src/social/w05-social-client.js', () => ({
  callW05Social: mocks.callW05Social,
  resolveCookieSocialPrincipal: mocks.resolvePrincipal,
  W05SocialClientError: mocks.MockW05SocialClientError,
}))

import { DELETE, POST } from '../../src/app/api/v1/content/[contentId]/reposts/route.js'

const readRoute = () =>
  readFileSync(resolve(process.cwd(), 'src/app/api/v1/content/[contentId]/reposts/route.ts'), 'utf8')

const requestFor = (method: 'POST' | 'DELETE') =>
  new Request('https://www.luckread.com/api/v1/content/content-1/reposts', {
    method,
    headers: {
      'Idempotency-Key': 'repost-test-operation-0001',
      Cookie: 'better-auth.session_token=test-session-cookie',
    },
  })

const context = { params: Promise.resolve({ contentId: 'content-1' }) }

beforeEach(() => {
  mocks.enforceWriteRateLimit.mockReset()
  mocks.enforceWriteRateLimit.mockResolvedValue(undefined)
  mocks.rateLimitResponse.mockClear()
  mocks.resolvePrincipal.mockReset()
  mocks.resolvePrincipal.mockResolvedValue({ userId: 'user_test_01', layer: 'L2' })
  mocks.callW05Social.mockReset()
  mocks.callW05Social.mockResolvedValue(Response.json({ data: { ok: true } }, { status: 200 }))
})

describe('v1 repost adapter', () => {
  it('forwards authenticated repost and undo requests to W05 through the public W01 route', async () => {
    const route = readRoute()
    expect(route).toContain('resolveCookieSocialPrincipal')
    expect(route).toContain('callW05Social')
    expect(route).toContain('/internal/social/content/')
    expect(route).toContain('/reposts')
    expect(route).toContain('Idempotency-Key')
    expect(route).toContain('enforceW01WriteRateLimit(request)')
    expect(route).toContain('TrafficLimitError')
    expect(route).toContain('rateLimitResponse(request)')
    expect(route).not.toContain('getPayload(')
    expect(route).not.toContain('social_reposts')

    const rateLimitIndex = route.indexOf('await enforceW01WriteRateLimit(request)')
    const identityIndex = route.indexOf('await resolveCookieSocialPrincipal(request)')
    expect(rateLimitIndex).toBeGreaterThanOrEqual(0)
    expect(rateLimitIndex).toBeLessThan(identityIndex)

    const postResponse = await POST(requestFor('POST'), context)
    const deleteResponse = await DELETE(requestFor('DELETE'), context)
    expect(postResponse.status).toBe(200)
    expect(deleteResponse.status).toBe(200)
    expect(mocks.enforceWriteRateLimit).toHaveBeenCalledTimes(2)
    expect(mocks.callW05Social).toHaveBeenCalledTimes(2)
  })

  it('short-circuits POST and DELETE on W01 rate limit before resolving identity or calling W05', async () => {
    for (const [method, handler] of [
      ['POST', POST],
      ['DELETE', DELETE],
    ] as const) {
      mocks.enforceWriteRateLimit.mockRejectedValueOnce(new mocks.MockTrafficLimitError())
      const request = requestFor(method)
      const response = await handler(request, context)

      expect(response.status).toBe(429)
      expect(mocks.rateLimitResponse).toHaveBeenCalledWith(request)
      expect(mocks.resolvePrincipal).not.toHaveBeenCalled()
      expect(mocks.callW05Social).not.toHaveBeenCalled()
      mocks.enforceWriteRateLimit.mockResolvedValue(undefined)
      mocks.rateLimitResponse.mockClear()
    }
  })
})
