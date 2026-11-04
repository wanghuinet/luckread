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
    MockW08CreatorClientError: class MockW08CreatorClientError extends Error {},
    MockW06ModerationClientError: class MockW06ModerationClientError extends Error {},
    callW06PushEndpointMutationAudit: vi.fn(async (input: { body: {
      eventId: string; installationId: string; operation: 'REGISTER' | 'REMOVE'
    } }) => Response.json({
      eventId: input.body.eventId,
      action: 'notification.push_endpoint.mutation_requested',
      targetType: 'NotificationPushEndpoint',
      targetId: input.body.installationId,
      replayed: false,
    }, { status: 201 })),
    callW08Creator: vi.fn(async (_request: Request, _path: string, _method: 'GET' | 'POST') => Response.json({
      decision: 'ALLOW', action: 'notification.update.self', resourceType: 'Notification',
      policyVersion: 'casl-l0-l8-v1', layer: 'L2',
    })),
    enforceWriteRateLimit: vi.fn(async (_request: Request) => undefined),
    enforceWriteAccountRateLimit: vi.fn(async (_accountId: string) => undefined),
    enforceWriteEndpointRateLimit: vi.fn(async (_endpoint: string) => undefined),
    rateLimitResponse: vi.fn((_request: Request) => Response.json({ error: { code: 'RATE_LIMITED' } }, { status: 429 })),
    resolvePrincipal: vi.fn(async (_request: Request) => ({ userId: 'user_test_01', layer: 'L2', verified: true })),
    callW05Social: vi.fn(async (input: { method: string }) => input.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json({ data: { endpointId: 'endpoint-1', status: 'ACTIVE' } })),
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

vi.mock('../../src/auth/w08-creator-client.js', () => ({
  callW08Creator: mocks.callW08Creator,
  W08CreatorClientError: mocks.MockW08CreatorClientError,
}))
vi.mock('../../src/moderation/w06-moderation-client.js', () => ({
  callW06PushEndpointMutationAudit: mocks.callW06PushEndpointMutationAudit,
  W06ModerationClientError: mocks.MockW06ModerationClientError,
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
      'Idempotency-Key': method === 'PUT' ? 'idem_register_test_0001' : 'idem_remove_test_0001',
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
  mocks.callW05Social.mockImplementation(async (input: { method: string }) => input.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json({ data: { endpointId: 'endpoint-1', status: 'ACTIVE' } }))
  mocks.callW08Creator.mockReset()
  mocks.callW08Creator.mockResolvedValue(Response.json({
    decision: 'ALLOW', action: 'notification.update.self', resourceType: 'Notification',
    policyVersion: 'casl-l0-l8-v1', layer: 'L2',
  }))
  mocks.callW06PushEndpointMutationAudit.mockReset()
  mocks.callW06PushEndpointMutationAudit.mockImplementation(async (input: { body: {
    eventId: string; installationId: string; operation: 'REGISTER' | 'REMOVE'
  } }) => Response.json({
    eventId: input.body.eventId,
    action: 'notification.push_endpoint.mutation_requested',
    targetType: 'NotificationPushEndpoint',
    targetId: input.body.installationId,
    replayed: false,
  }, { status: 201 }))
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
    expect(deleteResponse.status).toBe(204)
    expect(mocks.callW05Social).toHaveBeenNthCalledWith(1, expect.objectContaining({
      pathname: '/internal/social/push-endpoints/' + installationId,
      method: 'PUT',
      principal: { userId: 'user_test_01', layer: 'L2', verified: true },
      body: registrationBody,
    }))
    expect(mocks.callW06PushEndpointMutationAudit).toHaveBeenNthCalledWith(1, expect.objectContaining({
      principal: { userId: 'user_test_01', layer: 'L2', verified: true },
      body: expect.objectContaining({
        installationId,
        operation: 'REGISTER',
        idempotencyKey: 'idem_register_test_0001',
        platform: 'android',
        permissionStatus: 'granted',
      }),
    }))
    const auditIntent = mocks.callW06PushEndpointMutationAudit.mock.calls[0]?.[0] as { body: Record<string, unknown> }
    expect(JSON.stringify(auditIntent.body)).not.toContain(token)
    expect(mocks.callW06PushEndpointMutationAudit.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.callW05Social.mock.invocationCallOrder[0])
    expect(mocks.callW08Creator).toHaveBeenNthCalledWith(
      1,
      expect.any(Request),
      '/internal/authz/check-permission',
      'POST',
    )
    const w08PermissionRequest = mocks.callW08Creator.mock.calls[0]?.[0] as Request
    await expect(w08PermissionRequest.clone().json()).resolves.toEqual({
      action: 'notification.update.self',
      resourceType: 'Notification',
      resourceAttributes: { ownerId: 'user_test_01' },
    })
    expect(mocks.callW05Social).toHaveBeenNthCalledWith(2, expect.objectContaining({
      pathname: '/internal/social/push-endpoints/' + installationId,
      method: 'DELETE',
      principal: { userId: 'user_test_01', layer: 'L2', verified: true },
    }))
    expect(mocks.callW08Creator).toHaveBeenCalledTimes(2)
    expect(mocks.callW06PushEndpointMutationAudit).toHaveBeenNthCalledWith(2, expect.objectContaining({
      body: expect.objectContaining({
        installationId,
        operation: 'REMOVE',
        idempotencyKey: 'idem_remove_test_0001',
        platform: null,
        permissionStatus: null,
      }),
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

  it('does not call W05 when W08 denies notification.update.self', async () => {
    mocks.callW08Creator.mockResolvedValueOnce(Response.json({
      decision: 'DENY',
      action: 'notification.update.self',
      resourceType: 'Notification',
      policyVersion: 'casl-l0-l8-v1',
      layer: 'L2',
      reasonCode: 'PERMISSION_DENIED',
    }))
    const response = await PUT(requestFor('PUT', {
      platform: 'ios',
      permissionStatus: 'granted',
      expoPushToken: token,
    }), context)

    expect(response.status).toBe(403)
    expect(mocks.callW08Creator).toHaveBeenCalledTimes(1)
    expect(mocks.callW05Social).not.toHaveBeenCalled()
  })

  it('fails closed when W08 returns an unverifiable authorization response', async () => {
    mocks.callW08Creator.mockResolvedValueOnce(Response.json({
      decision: 'ALLOW',
      action: 'user.update.self',
      resourceType: 'User',
      policyVersion: 'casl-l0-l8-v1',
      layer: 'L2',
    }))
    const response = await PUT(requestFor('PUT', {
      platform: 'ios',
      permissionStatus: 'granted',
      expoPushToken: token,
    }), context)

    expect(response.status).toBe(503)
    expect(mocks.callW05Social).not.toHaveBeenCalled()
  })


  it('fails closed before W05 when the durable W06 audit intent is unavailable', async () => {
    mocks.callW06PushEndpointMutationAudit.mockResolvedValueOnce(
      Response.json({ error: 'AUDIT_EVENT_PERSISTENCE_FAILED' }, { status: 503 }),
    )
    const response = await PUT(requestFor('PUT', {
      platform: 'ios',
      permissionStatus: 'granted',
      expoPushToken: token,
    }), context)

    expect(response.status).toBe(503)
    expect(mocks.callW06PushEndpointMutationAudit).toHaveBeenCalledTimes(1)
    expect(mocks.callW05Social).not.toHaveBeenCalled()
  })

  it('requires a stable idempotency key before asking W08 or W06', async () => {
    const request = new Request('https://www.luckread.com/api/v1/push/endpoints/' + installationId, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer test-session-token' },
    })
    const response = await DELETE(request, context)
    expect(response.status).toBe(428)
    expect(mocks.callW08Creator).not.toHaveBeenCalled()
    expect(mocks.callW06PushEndpointMutationAudit).not.toHaveBeenCalled()
    expect(mocks.callW05Social).not.toHaveBeenCalled()
  })


  it('does not call W05 when W06 cannot durably record the push endpoint intent', async () => {
    mocks.callW06PushEndpointMutationAudit.mockResolvedValueOnce(
      Response.json({ error: 'AUDIT_EVENT_PERSISTENCE_FAILED' }, { status: 503 }),
    )
    const response = await PUT(requestFor('PUT', {
      platform: 'ios',
      permissionStatus: 'granted',
      expoPushToken: token,
    }), context)

    expect(response.status).toBe(503)
    expect(mocks.callW06PushEndpointMutationAudit).toHaveBeenCalledTimes(1)
    expect(mocks.callW05Social).not.toHaveBeenCalled()
  })

  it('requires Idempotency-Key before W08 authorization, W06 audit, or W05 mutation', async () => {
    const request = new Request('https://www.luckread.com/api/v1/push/endpoints/' + installationId, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer test-session-token' },
    })
    const response = await DELETE(request, context)
    expect(response.status).toBe(428)
    expect(mocks.callW08Creator).not.toHaveBeenCalled()
    expect(mocks.callW06PushEndpointMutationAudit).not.toHaveBeenCalled()
    expect(mocks.callW05Social).not.toHaveBeenCalled()
  })

})
