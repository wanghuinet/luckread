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
    signInWithBetterAuth: vi.fn(),
    resolveBetterAuthPrincipal: vi.fn(),
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
  signInWithBetterAuth: mocks.signInWithBetterAuth,
  resolveBetterAuthPrincipal: mocks.resolveBetterAuthPrincipal,
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
    })

    mocks.signInWithBetterAuth.mockResolvedValue({
      token: 'better-auth-session-token-42',
      user: {
        id: 'user-42',
        email: 'user42@example.com',
      },
      setCookie: 'luckread_session=better-auth-session-token-42; Path=/; HttpOnly',
    })

    mocks.resolveBetterAuthPrincipal.mockResolvedValue({
      active: true,
      userId: 'user-42',
      email: 'user42@example.com',
      sessionId: 'ba-session-42',
      accountState: 'PENDING_VERIFICATION',
      accountStateVersion: 1,
      layer: 'L1',
    })

    mocks.establishSession.mockResolvedValue({
      sessionId: 'ba-session-42',
      refreshToken: 'v1.refresh-42',
      tokenVersion: 1,
      layer: 'L1',
      nativeExpiresAt: '2026-10-12T02:00:00.000Z',
    })

    mocks.issuePayloadAccessToken.mockResolvedValue({
      token: 'access-token',
      expiresIn: 900,
    })

    mocks.buildPayloadAccessCookie.mockReturnValue('luckread_access=access-token; Path=/; HttpOnly')
  })

  it('rejects malformed credentials and device ids before invoking any authentication authority', async () => {
    const response = await POST(
      jsonRequest({
        identity: '',
        credential: '',
        deviceId: '',
      }),
    )

    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('VALIDATION_FAILED')
    expect(mocks.signInWithBetterAuth).not.toHaveBeenCalled()
    expect(mocks.getPayload).not.toHaveBeenCalled()
  })

  it('authenticates credentials in Better Auth, resolves the canonical principal in W02, and keeps the Payload token only as a compatibility projection', async () => {
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

    expect(mocks.signInWithBetterAuth).toHaveBeenCalledWith({
      email: 'user42@example.com',
      password: 'Correct-password-123!',
    })

    expect(mocks.resolveBetterAuthPrincipal).toHaveBeenCalledWith(
      'better-auth-session-token-42',
    )

    expect(mocks.establishSession).toHaveBeenCalledWith({
      sessionId: 'ba-session-42',
      userId: 'user-42',
      deviceId: 'android-42',
    })

    expect(mocks.issuePayloadAccessToken).toHaveBeenCalledWith({
      payloadSecret: 'payload-secret',
      userId: 'user-42',
      email: 'user42@example.com',
      sessionId: 'ba-session-42',
      expiresAt: '2026-10-12T02:00:00.000Z',
      tokenVersion: 1,
    })

    expect(mocks.getPayload).toHaveBeenCalledTimes(1)
    expect(response.headers.get('set-cookie')).toContain('luckread_session=better-auth-session-token-42')
    expect(response.headers.get('set-cookie')).toContain('luckread_access=access-token')
  })

  it('maps Better Auth credential rejection to a stable 401 without establishing a session', async () => {
    mocks.signInWithBetterAuth.mockRejectedValue(
      new mocks.MockW02AuthClientError(401, 'authentication denied'),
    )

    const response = await POST(
      jsonRequest({
        identity: 'user42@example.com',
        credential: 'Wrong-password-123!',
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
    expect(mocks.resolveBetterAuthPrincipal).not.toHaveBeenCalled()
    expect(mocks.establishSession).not.toHaveBeenCalled()
    expect(mocks.issuePayloadAccessToken).not.toHaveBeenCalled()
  })

  it('fails closed when W02 cannot resolve the Better Auth principal', async () => {
    mocks.resolveBetterAuthPrincipal.mockRejectedValue(
      new mocks.MockW02AuthClientError(503, 'authentication service unavailable'),
    )

    const response = await POST(
      jsonRequest({
        identity: 'user42@example.com',
        credential: 'Correct-password-123!',
        deviceId: 'web-42',
      }),
    )

    expect(response.status).toBe(503)
    expect(mocks.establishSession).not.toHaveBeenCalled()
    expect(mocks.issuePayloadAccessToken).not.toHaveBeenCalled()
  })
})
