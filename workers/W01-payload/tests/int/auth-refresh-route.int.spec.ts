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
    refreshSession: vi.fn(),
    MockW02AuthClientError,
  }
})

vi.mock('../../src/auth/w02-session-client.js', () => ({
  refreshSession: mocks.refreshSession,
  W02AuthClientError: mocks.MockW02AuthClientError,
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

    mocks.refreshSession.mockResolvedValue({
      sessionId: 'session-refresh-42',
      userId: 'user-42',
      accessToken: 'better-auth-session-token-42',
      refreshToken: 'v3.refresh-next',
      tokenVersion: 3,
      layer: 'L2',
      nativeExpiresAt: '2026-10-03T02:00:00.000Z',
      expiresIn: 604800,
      email: 'user42@example.com',
    })
  })

  it('rejects malformed refresh credentials before invoking W02', async () => {
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
    expect(mocks.refreshSession).not.toHaveBeenCalled()
  })

  it('rotates the refresh credential through W02 and returns the native Better Auth session token', async () => {
    const response = await POST(
      jsonRequest({
        refreshToken: 'v3.refresh-current',
        deviceId: 'android-42',
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      accessToken: 'better-auth-session-token-42',
      refreshToken: 'v3.refresh-next',
      expiresIn: 604800,
      layer: 'L2',
    })

    expect(mocks.refreshSession).toHaveBeenCalledWith({
      refreshToken: 'v3.refresh-current',
      deviceId: 'android-42',
    })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('maps W02 authentication denial to stable 401', async () => {
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
    const responseBody = await response.json()
    expect(responseBody).toMatchObject({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Authentication service unavailable',
      },
    })
    expect(JSON.stringify(responseBody)).not.toContain('invalid device binding')
  })
})
