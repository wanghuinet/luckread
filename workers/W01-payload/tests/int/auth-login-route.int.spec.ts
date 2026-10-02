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
    establishSession: vi.fn(),
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
  establishSession: mocks.establishSession,
  W02AuthClientError: mocks.MockW02AuthClientError,
}))

vi.mock('../../src/auth/payload-access-token.js', () => ({
  issuePayloadAccessToken: mocks.issuePayloadAccessToken,
  buildPayloadAccessCookie: mocks.buildPayloadAccessCookie,
}))

import { POST } from '../../src/app/auth/login/route.js'

function jsonRequest(body: unknown): Request {
  return new Request('https://luckread.test/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('AUTH-002 W01 login route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.getPayload.mockResolvedValue({
      secret: 'payload-secret',
      login: vi.fn(),
      auth: vi.fn(),
    })

    mocks.issuePayloadAccessToken.mockResolvedValue({
      token: 'access-token',
      expiresIn: 900,
    })

    mocks.buildPayloadAccessCookie.mockReturnValue('luckread_access=access-token; Path=/; HttpOnly')
  })

  it('rejects malformed credentials and device ids before invoking Payload', async () => {
    const response = await POST(
      jsonRequest({
        identity: '',
        credential: '',
        deviceId: '',
      }),
    )

    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('VALIDATION_FAILED')
    expect(mocks.getPayload).not.toHaveBeenCalled()
  })

  it('binds the native Payload session to W02 before issuing the public access token', async () => {
    const payloadLogin = vi.fn().mockImplementation(async ({ context }) => {
      context.__luckreadNativeAuthToken = 'native-token-42'
      return {
        user: {
          id: 'user-42',
          email: 'USER42@EXAMPLE.COM',
        },
        exp: 1770000000,
      }
    })
    const payloadAuth = vi.fn().mockResolvedValue({
      user: {
        id: 'user-42',
        email: 'USER42@EXAMPLE.COM',
        _sid: 'native-sid-42',
      },
    })

    mocks.getPayload.mockResolvedValue({
      secret: 'payload-secret',
      login: payloadLogin,
      auth: payloadAuth,
    })

    mocks.establishSession.mockResolvedValue({
      sessionId: 'native-sid-42',
      refreshToken: 'v1.refresh-42',
      tokenVersion: 1,
      layer: 'L1',
      nativeExpiresAt: '2026-10-02T02:00:00.000Z',
    })

    const response = await POST(
      jsonRequest({
        identity: 'USER42@EXAMPLE.COM',
        credential: 'Correct-password-123!',
        deviceId: 'android-42',
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      accessToken: 'access-token',
      refreshToken: 'v1.refresh-42',
      expiresIn: 900,
      layer: 'L1',
    })

    expect(payloadLogin).toHaveBeenCalledWith({
      collection: 'users',
      context: expect.objectContaining({
        __luckreadNativeAuthToken: 'native-token-42',
      }),
      data: {
        email: 'USER42@EXAMPLE.COM',
        password: 'Correct-password-123!',
      },
    })

    expect(payloadAuth).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      canSetHeaders: false,
    })
    const authHeaders = payloadAuth.mock.calls[0][0].headers as Headers
    expect(authHeaders.get('authorization')).toBe('Bearer native-token-42')

    expect(mocks.establishSession).toHaveBeenCalledWith({
      sessionId: 'native-sid-42',
      userId: 'user-42',
      deviceId: 'android-42',
    })

    expect(mocks.issuePayloadAccessToken).toHaveBeenCalledWith({
      payloadSecret: 'payload-secret',
      userId: 'user-42',
      email: 'user42@example.com',
      sessionId: 'native-sid-42',
      expiresAt: '2026-10-02T02:00:00.000Z',
      tokenVersion: 1,
    })
    expect(mocks.buildPayloadAccessCookie).toHaveBeenCalledWith(
      'access-token',
      900,
      expect.any(Request),
    )
    expect(response.headers.get('set-cookie')).toBe(
      'luckread_access=access-token; Path=/; HttpOnly',
    )
  })

  it('maps authoritative W02 authentication denial to a stable 401 without minting access tokens', async () => {
    const payloadLogin = vi.fn().mockImplementation(async ({ context }) => {
      context.__luckreadNativeAuthToken = 'native-token-42'
      return {
        user: {
          id: 'user-42',
          email: 'user42@example.com',
        },
        exp: 1770000000,
      }
    })
    const payloadAuth = vi.fn().mockResolvedValue({
      user: {
        id: 'user-42',
        email: 'user42@example.com',
        _sid: 'native-sid-42',
      },
    })

    mocks.getPayload.mockResolvedValue({
      secret: 'payload-secret',
      login: payloadLogin,
      auth: payloadAuth,
    })

    mocks.establishSession.mockRejectedValue(
      new mocks.MockW02AuthClientError(401, 'authentication denied'),
    )

    const response = await POST(
      jsonRequest({
        identity: 'user42@example.com',
        credential: 'Wrong-or-rejected-password',
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

  it('normalizes Payload login failures without exposing authentication material', async () => {
    mocks.getPayload.mockResolvedValue({
      secret: 'payload-secret',
      login: vi.fn().mockRejectedValue(
        new Error(
          'invalid password for user42@example.com token=super-secret-token-01234567890123456789012345678901234567890123',
        ),
      ),
      auth: vi.fn(),
    })

    const response = await POST(
      jsonRequest({
        identity: 'user42@example.com',
        credential: 'Wrong-password-123!',
        deviceId: 'web-42',
      }),
    )

    expect(response.status).toBe(401)
    const body = await response.text()
    expect(body).toContain('UNAUTHENTICATED')
    expect(body).not.toContain('user42@example.com')
    expect(body).not.toContain('super-secret-token')
    expect(mocks.establishSession).not.toHaveBeenCalled()
  })
})
