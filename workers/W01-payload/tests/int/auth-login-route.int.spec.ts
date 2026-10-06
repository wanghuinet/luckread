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
    signInWithBetterAuth: vi.fn(),
    resolveBetterAuthPrincipal: vi.fn(),
    establishSession: vi.fn(),
    MockW02AuthClientError,
  }
})

vi.mock('../../src/auth/w02-session-client.js', () => ({
  signInWithBetterAuth: mocks.signInWithBetterAuth,
  resolveBetterAuthPrincipal: mocks.resolveBetterAuthPrincipal,
  establishSession: mocks.establishSession,
  W02AuthClientError: mocks.MockW02AuthClientError,
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

    mocks.signInWithBetterAuth.mockResolvedValue({
      token: 'better-auth-session-token-42',
      user: {
        id: 'user-42',
        email: 'user42@example.com',
      },
      setCookie: 'better-auth.session_token=better-auth-session-token-42; Path=/; HttpOnly',
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
      expiresIn: 604800,
    })
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
  })

  it('authenticates credentials in Better Auth and returns the native Better Auth session token', async () => {
    const response = await POST(
      jsonRequest({
        identity: 'USER42@EXAMPLE.COM',
        credential: 'Correct-password-123!',
        deviceId: 'android-42',
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      accessToken: 'better-auth-session-token-42',
      refreshToken: 'v1.refresh-42',
      expiresIn: 604800,
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

    expect(response.headers.get('set-cookie')).toContain(
      'better-auth.session_token=better-auth-session-token-42',
    )
    expect(response.headers.get('set-cookie')).not.toContain('payload-token=')
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
  })
})
