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
    resolvePrincipal: vi.fn(async () => ({ userId: 'preferences-owner-001', layer: 'L2', verified: true })),
    callW05Social: vi.fn(async (input: { method: string; body?: unknown }) =>
      Response.json({ data: input.body ?? { follow: true, like: true, comment: true, mention: true } }),
    ),
    callW08Creator: vi.fn(async (request: Request) => {
      const body = await request.clone().json() as Record<string, unknown>
      return Response.json({ decision: 'ALLOW', action: body.action, resourceType: 'Notification', policyVersion: 'casl-l0-l8-v1', layer: 'L2' })
    }),
    callW06NotificationPreferencesMutationAudit: vi.fn(async (input: { body: { eventId: string }; principal: { userId: string } }) =>
      Response.json({ eventId: input.body.eventId, action: 'notification.preferences.update_requested', targetType: 'Notification', targetId: input.principal.userId, replayed: false }, { status: 201 }),
    ),
    enforcePublicReadRateLimit: vi.fn(async () => undefined),
    enforceWriteRateLimit: vi.fn(async () => undefined),
    enforceWriteAccountRateLimit: vi.fn(async () => undefined),
    enforceWriteEndpointRateLimit: vi.fn(async () => undefined),
    rateLimitResponse: vi.fn(() => Response.json({ error: { code: 'RATE_LIMITED' } }, { status: 429 })),
  }
})

vi.mock('../../src/auth/traffic-limit.js', () => ({
  TrafficLimitError: mocks.MockTrafficLimitError,
  enforcePublicReadRateLimit: mocks.enforcePublicReadRateLimit,
  enforceW01WriteRateLimit: mocks.enforceWriteRateLimit,
  enforceW01WriteAccountRateLimit: mocks.enforceWriteAccountRateLimit,
  enforceW01WriteEndpointRateLimit: mocks.enforceWriteEndpointRateLimit,
  rateLimitResponse: mocks.rateLimitResponse,
}))
vi.mock('../../src/social/w05-social-client.js', () => ({
  callW05Social: mocks.callW05Social,
  resolveCookieSocialPrincipal: mocks.resolvePrincipal,
  W05SocialClientError: mocks.MockW05SocialClientError,
}))
vi.mock('../../src/auth/w08-creator-client.js', () => ({ callW08Creator: mocks.callW08Creator }))
vi.mock('../../src/moderation/w06-moderation-client.js', () => ({
  callW06NotificationPreferencesMutationAudit: mocks.callW06NotificationPreferencesMutationAudit,
}))

import { GET, PATCH } from '../../src/app/api/v1/notification-preferences/route.js'

const accountPreferences = { follow: true, like: false, comment: true, mention: false }
const requestFor = (method: 'GET' | 'PATCH', body?: unknown) => new Request(
  'https://www.luckread.com/api/v1/notification-preferences',
  {
    method,
    headers: { Authorization: 'Bearer test-session-token', ...(method === 'PATCH' ? { 'content-type': 'application/json' } : {}) },
    ...(method === 'PATCH' ? { body: JSON.stringify(body) } : {}),
  },
)

beforeEach(() => {
  mocks.resolvePrincipal.mockReset()
  mocks.resolvePrincipal.mockResolvedValue({ userId: 'preferences-owner-001', layer: 'L2', verified: true })
  mocks.callW05Social.mockReset()
  mocks.callW05Social.mockImplementation(async (input: { method: string; body?: unknown }) =>
    Response.json({ data: input.body ?? accountPreferences }),
  )
  mocks.callW08Creator.mockReset()
  mocks.callW08Creator.mockImplementation(async (request: Request) => {
    const body = await request.clone().json() as Record<string, unknown>
    return Response.json({ decision: 'ALLOW', action: body.action, resourceType: 'Notification', policyVersion: 'casl-l0-l8-v1', layer: 'L2' })
  })
  mocks.callW06NotificationPreferencesMutationAudit.mockReset()
  mocks.callW06NotificationPreferencesMutationAudit.mockImplementation(async (input: { body: { eventId: string }; principal: { userId: string } }) =>
    Response.json({ eventId: input.body.eventId, action: 'notification.preferences.update_requested', targetType: 'Notification', targetId: input.principal.userId, replayed: false }, { status: 201 }),
  )
  mocks.enforcePublicReadRateLimit.mockReset()
  mocks.enforcePublicReadRateLimit.mockResolvedValue(undefined)
  mocks.enforceWriteRateLimit.mockReset()
  mocks.enforceWriteRateLimit.mockResolvedValue(undefined)
  mocks.enforceWriteAccountRateLimit.mockReset()
  mocks.enforceWriteAccountRateLimit.mockResolvedValue(undefined)
  mocks.enforceWriteEndpointRateLimit.mockReset()
  mocks.enforceWriteEndpointRateLimit.mockResolvedValue(undefined)
  mocks.rateLimitResponse.mockClear()
})

describe('W01 notification preferences adapter', () => {
  it('reads preferences only after W08 self-read authorization', async () => {
    const response = await GET(requestFor('GET'))
    expect(response.status).toBe(200)
    const authorizationRequest = mocks.callW08Creator.mock.calls[0]?.[0] as Request
    await expect(authorizationRequest.clone().json()).resolves.toEqual({
      action: 'notification.read.self',
      resourceType: 'Notification',
      resourceAttributes: { ownerId: 'preferences-owner-001' },
    })
    expect(mocks.callW05Social).toHaveBeenCalledWith(expect.objectContaining({
      pathname: '/internal/social/notification-preferences', method: 'GET',
    }))
  })

  it('records W06 update intent before forwarding the self update to W05', async () => {
    const response = await PATCH(requestFor('PATCH', accountPreferences))
    expect(response.status).toBe(200)
    expect(mocks.enforceWriteAccountRateLimit).toHaveBeenCalledWith('preferences-owner-001')
    expect(mocks.enforceWriteEndpointRateLimit).toHaveBeenCalledWith('patchNotificationPreferences')
    const authorizationRequest = mocks.callW08Creator.mock.calls[0]?.[0] as Request
    await expect(authorizationRequest.clone().json()).resolves.toEqual({
      action: 'notification.update.self',
      resourceType: 'Notification',
      resourceAttributes: { ownerId: 'preferences-owner-001' },
    })
    expect(mocks.callW06NotificationPreferencesMutationAudit).toHaveBeenCalledWith(expect.objectContaining({
      principal: { userId: 'preferences-owner-001', layer: 'L2', verified: true },
      body: { eventId: expect.stringMatching(/^evt_notification_preferences_/), preferences: accountPreferences },
    }))
    expect(mocks.callW06NotificationPreferencesMutationAudit.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.callW05Social.mock.invocationCallOrder[0])
  })

  it('fails closed on authorization denial or unconfirmed W06 audit', async () => {
    mocks.callW08Creator.mockResolvedValueOnce(Response.json({
      decision: 'DENY', action: 'notification.update.self', resourceType: 'Notification', policyVersion: 'casl-l0-l8-v1', layer: 'L2',
    }))
    expect((await PATCH(requestFor('PATCH', accountPreferences))).status).toBe(403)
    expect(mocks.callW05Social).not.toHaveBeenCalled()
    mocks.callW08Creator.mockImplementationOnce(async (request: Request) => {
      const body = await request.clone().json() as Record<string, unknown>
      return Response.json({ decision: 'ALLOW', action: body.action, resourceType: 'Notification', policyVersion: 'casl-l0-l8-v1', layer: 'L2' })
    })
    mocks.callW06NotificationPreferencesMutationAudit.mockResolvedValueOnce(Response.json({ error: 'AUDIT_FAILED' }, { status: 503 }))
    expect((await PATCH(requestFor('PATCH', accountPreferences))).status).toBe(503)
    expect(mocks.callW05Social).not.toHaveBeenCalled()
  })

  it('rejects empty and unknown fields before authorization', async () => {
    for (const body of [{}, { follow: true, ownerId: 'attacker' }]) {
      expect((await PATCH(requestFor('PATCH', body))).status).toBe(422)
    }
    expect(mocks.callW08Creator).not.toHaveBeenCalled()
    expect(mocks.callW06NotificationPreferencesMutationAudit).not.toHaveBeenCalled()
  })
})
