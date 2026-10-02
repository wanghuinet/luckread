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

  return {
    getPayload: vi.fn(),
    refreshSession: vi.fn(),
    issuePayloadAccessToken: vi.fn(),
    buildPayloadAccessCookie: vi.fn(),
    MockW02AuthClientError,
  }
})

vi.mock('payload', () => ({
  getPayload: mocks.getPayload,
}))

vi.mock('@payload-config', () => ({
  default: { secret: 'payload-secret' },
}))

vi.mock('../../src/auth/w02-session-client.js', () => ({
  refreshSession: mocks.refreshSession,
  W02AuthClientError: mocks.MockW02AuthClientError,
}))

vi.mock('../../src/auth/payload-access-token.js', () => ({
  issuePayloadAccessToken: mocks.issuePayloadAccessToken,
  buildPayloadAccessCookie: mocks.buildPayloadAccessCookie,
}))

import { POST } from '../../src/app/auth/refresh/route.js'

function jsonRequest(body: unknown): Request {
  return new Request('https://luckread.test/auth/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('AUTH-011 W01 refresh route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.getPayload.mockResolvedValue({
      secret: 'payload-secret',
    })

    mocks.refreshSession.mockResolvedValue({
      sessionId: 'session-refresh-42',
      userId: 'user-42',
      refreshToken: 'v3.refresh-next',
      tokenVersion: 3,
      layer: 'L2',
      nativeExpiresAt: '2026-10-03T02:00:00.000Z',
      email: 'user42@example.com',
    })

    mocks.issuePayloadAccessToken.mockResolvedValue({
      token: 'access-token-next',
      expiresIn: 900,
    })

    mocks.buildPayloadAccessCookie.mockReturnValue(
      'luckread_access=access-token-next; Path=/; HttpOnly',
    )
  })

  it('rejects malformed refresh credentials before invoking Payload or W02', async () => {
    const response = await POST(
      jsonRequest({
        refreshToken: '',
        deviceId: '',
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'VALIDATION_FAILED' },
    })
    expect(mocks.getPayload).not.toHaveBeenCalled()
    expect(mocks.refreshSession).not.toHaveBeenCalled()
  })

  it('rotates the refresh credential through W02 before minting a new access token', async () => {
    const response = await POST(
      jsonRequest({
        refreshToken: 'v3.refresh-current',
        deviceId: 'android-42',
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      accessToken: 'access-token-next',
      refreshToken: 'v3.refresh-next',
      expiresIn: 900,
      layer: 'L2',
    })

    expect(mocks.getPayload).toHaveBeenCalledWith({
      config: expect.objectContaining({ secret: 'payload-secret' }),
    })

    expect(mocks.refreshSession).toHaveBeenCalledWith({
      refreshToken: 'v3.refresh-current',
      deviceId: 'android-42',
    })

    expect(mocks.issuePayloadAccessToken).toHaveBeenCalledWith({
      payloadSecret: 'payload-secret',
      userId: 'user-42',
      email: 'user42@example.com',
      sessionId: 'session-refresh-42',
      expiresAt: '2026-10-03T02:00:00.000Z',
      tokenVersion: 3,
    })

    expect(mocks.buildPayloadAccessCookie).toHaveBeenCalledWith(
      'access-token-next',
      900,
      expect.any(Request),
    )
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('set-cookie')).toBe(
      'luckread_access=access-token-next; Path=/; HttpOnly',
    )
  })

  it('maps W02 authentication denial to stable 401 without minting access tokens', async () => {
    mocks.refreshSession.mockRejectedValue(
      new mocks.MockW02AuthClientError(401, 'refresh credential rejected'),
    )

    const response = await POST(
      jsonRequest({
        refreshToken: 'v3.invalid',
        deviceId: 'web-42',
      }),
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication denied',
      },
    })
    expect(mocks.issuePayloadAccessToken).not.toHaveBeenCalled()
    expect(mocks.buildPayloadAccessCookie).not.toHaveBeenCalled()
  })

  it('maps W02 validation failures without exposing internal details', async () => {
    mocks.refreshSession.mockRejectedValue(
      new mocks.MockW02AuthClientError(400, 'invalid device binding'),
    )

    const response = await POST(
      jsonRequest({
        refreshToken: 'v3.refresh-current',
        deviceId: 'web-42',
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Authentication service unavailable',
      },
    })
    const body = await response.text()
    expect(body).not.toContain('invalid device binding')
    expect(mocks.issuePayloadAccessToken).not.toHaveBeenCalled()
  })

  it('fails closed when access-token issuance is unavailable', async () => {
    mocks.issuePayloadAccessToken.mockRejectedValue(new Error('signing backend unavailable'))

    const response = await POST(
      jsonRequest({
        refreshToken: 'v3.refresh-current',
        deviceId: 'android-42',
      }),
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Access-token issuance is unavailable',
      },
    })
    expect(mocks.buildPayloadAccessCookie).not.toHaveBeenCalled()
  })
})
