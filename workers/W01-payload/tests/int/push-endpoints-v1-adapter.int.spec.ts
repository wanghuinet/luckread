import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    enforceWriteAccountRateLimit: vi.fn(async (_accountId: string) => undefined),
    enforceWriteEndpointRateLimit: vi.fn(async (_endpoint: string) => undefined),
    rateLimitResponse: vi.fn((_request: Request) => Response.json({ error: { code: 'RATE_LIMITED' } }, { status: 429 })),
    resolvePrincipal: vi.fn(async (_request: Request) => ({ userId: 'user_test_01', layer: 'L2', verified: true })),
    callW05Social: vi.fn(async (_input: unknown) => Response.json({ data: { endpointId: 'endpoint-1', status: 'ACTIVE' } })),
  }
})

vi.mock('../../src/auth/traffic-limit.js', () => ({
  TrafficLimitError: mocks.MockTrafficLimitError,
  enforceW01WriteRateLimit: mocks.enforceWriteRateLimit,
  enforceW01WriteAccountRateLimit: mocks.enforceWriteAccountRateLimit,
  enforceW01WriteEndpointRateLimit: mocks.enforceWriteEndpointRateLimit,
  rateLimitResponse: mocks.rateLimitResponse,
}))

vi.mock('../../src/social/w05-social-client.js', () => ({
  callW05Social: mocks.callW05Social,
  resolveSocialPrincipal: mocks.resolvePrincipal,
  W05SocialClientError: mocks.MockW05SocialClientError,
}))

import { DELETE, PUT } from '../../src/app/api/v1/push/endpoints/[installationId]/route.js'

const installationId = '6b6d9f5a-4e61-4c50-9d17-9e97f36e6e3c'
const token = 'ExponentPushToken[abcdefghijklmnop_1234567890]'
const context = { params: Promise.resolve({ installationId }) }

const requestFor = (method: 'PUT' | 'DELETE', body?: unknown) =>
  new Request('https://www.luckread.com/api/v1/push/endpoints/' + installationId, {
    method,
    headers: {
      Authorization: 'Bearer test-session-token',
      ...(method === 'PUT' ? { 'content-type': 'application/json' } : {}),
    },
    ...(method === 'PUT' ? { body: JSON.stringify(body) } : {}),
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
  mocks.resolvePrincipal.mockResolvedValue({ userId: 'user_test_01', layer: 'L2', verified: true })
  mocks.callW05Social.mockReset()
  mocks.callW05Social.mockResolvedValue(Response.json({ data: { endpointId: 'endpoint-1', status: 'ACTIVE' } }))
})

describe('v1 Expo push endpoint adapter', () => {
  it('registers and removes only through the authenticated W05 service boundary', async () => {
    const registrationBody = {
      platform: 'android',
      permissionStatus: 'granted',
      expoPushToken: token,
      appVersion: '1.0.0',
    }
    const putResponse = await PUT(requestFor('PUT', registrationBody), context)
    const deleteResponse = await DELETE(requestFor('DELETE'), context)

    expect(putResponse.status).toBe(200)
    expect(deleteResponse.status).toBe(200)
    expect(mocks.callW05Social).toHaveBeenNthCalledWith(1, expect.objectContaining({
      pathname: '/internal/social/push-endpoints/' + installationId,
      method: 'PUT',
      principal: { userId: 'user_test_01', layer: 'L2', verified: true },
      body: registrationBody,
    }))
    expect(mocks.callW05Social).toHaveBeenNthCalledWith(2, expect.objectContaining({
      pathname: '/internal/social/push-endpoints/' + installationId,
      method: 'DELETE',
      principal: { userId: 'user_test_01', layer: 'L2', verified: true },
    }))
    expect(JSON.stringify(await putResponse.clone().json())).not.toContain(token)
  })

  it('applies origin/IP, actor-account, and fixed endpoint rate limits in that order', async () => {
    await PUT(requestFor('PUT', {
      platform: 'ios',
      permissionStatus: 'granted',
      expoPushToken: token,
    }), context)

    expect(mocks.enforceWriteRateLimit).toHaveBeenCalledTimes(1)
    expect(mocks.enforceWriteAccountRateLimit).toHaveBeenCalledWith('user_test_01')
    expect(mocks.enforceWriteEndpointRateLimit).toHaveBeenCalledWith('upsertPushEndpoint')
    expect(mocks.enforceWriteRateLimit.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.resolvePrincipal.mock.invocationCallOrder[0])
    expect(mocks.resolvePrincipal.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.enforceWriteAccountRateLimit.mock.invocationCallOrder[0])
    expect(mocks.enforceWriteAccountRateLimit.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.enforceWriteEndpointRateLimit.mock.invocationCallOrder[0])
  })

  it('uses a separate fixed endpoint bucket for deletion', async () => {
    await DELETE(requestFor('DELETE'), context)
    expect(mocks.enforceWriteEndpointRateLimit).toHaveBeenCalledWith('deletePushEndpoint')
  })

  it('stops before W05 when an account or endpoint rate limit blocks the mutation', async () => {
    mocks.enforceWriteEndpointRateLimit.mockRejectedValueOnce(new mocks.MockTrafficLimitError())
    const response = await PUT(requestFor('PUT', {
      platform: 'ios',
      permissionStatus: 'granted',
      expoPushToken: token,
    }), context)

    expect(response.status).toBe(429)
    expect(mocks.rateLimitResponse).toHaveBeenCalledTimes(1)
    expect(mocks.callW05Social).not.toHaveBeenCalled()
  })

  it('does not forward a request when session resolution rejects it', async () => {
    mocks.resolvePrincipal.mockResolvedValueOnce(Response.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 }) as never)
    const response = await PUT(requestFor('PUT', {
      platform: 'ios',
      permissionStatus: 'granted',
      expoPushToken: token,
    }), context)

    expect(response.status).toBe(401)
    expect(mocks.enforceWriteAccountRateLimit).not.toHaveBeenCalled()
    expect(mocks.enforceWriteEndpointRateLimit).not.toHaveBeenCalled()
    expect(mocks.callW05Social).not.toHaveBeenCalled()
  })

  it('rejects malformed registration bodies without forwarding them', async () => {
    const request = new Request('https://www.luckread.com/api/v1/push/endpoints/' + installationId, {
      method: 'PUT',
      headers: { Authorization: 'Bearer test-session-token', 'content-type': 'application/json' },
      body: '{invalid json',
    })
    const response = await PUT(request, context)

    expect(response.status).toBe(422)
    expect(mocks.callW05Social).not.toHaveBeenCalled()
  })
})
