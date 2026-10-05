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
    resolveBetterAuthPrincipalThroughW02: vi.fn(),
    listSessions: vi.fn(),
    revokeOwnedSession: vi.fn(),
    MockW02AuthClientError,
  }
})

vi.mock('../../src/auth/w02-session-client.js', () => ({
  resolveBetterAuthPrincipalThroughW02: mocks.resolveBetterAuthPrincipalThroughW02,
  listSessions: mocks.listSessions,
  revokeOwnedSession: mocks.revokeOwnedSession,
  W02AuthClientError: mocks.MockW02AuthClientError,
}))

import {
  DELETE,
  GET,
} from '../../src/app/auth/sessions/[[...segments]]/route.js'

function request(url: string, init: RequestInit = {}): Request {
  return new Request(url, {
    ...init,
    headers: {
      cookie: 'better-auth.session_token=opaque-session',
      authorization: 'Bearer compatibility-token',
      ...(init.headers ?? {}),
    },
  })
}

const rootContext = { params: Promise.resolve({ segments: [] }) }

describe('STAGE_1 public session management route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.resolveBetterAuthPrincipalThroughW02.mockResolvedValue({
      active: true,
      userId: 'user-42',
      email: 'user-42@example.test',
      sessionId: 'session-current',
      accountState: 'ACTIVE',
      accountStateVersion: 1,
      layer: 'L2',
      tokenVersion: 3,
    })

    mocks.listSessions.mockResolvedValue({
      items: [
        {
          sessionId: 'session-current',
          deviceId: 'android-42',
          createdAt: '2026-10-02T00:00:00.000Z',
          expiresAt: '2026-10-03T00:00:00.000Z',
          lastSeenAt: '2026-10-02T01:00:00.000Z',
        },
      ],
      nextCursor: 'cursor-next',
    })

    mocks.revokeOwnedSession.mockResolvedValue({ revoked: true })
  })

  it('requires a native Better Auth principal with an active session extension', async () => {
    mocks.resolveBetterAuthPrincipalThroughW02.mockResolvedValueOnce({
      active: true,
      userId: 'user-42',
      email: 'user-42@example.test',
      sessionId: 'session-current',
      accountState: 'ACTIVE',
      accountStateVersion: 1,
      layer: 'L2',
    })

    const response = await GET(
      request('https://luckread.test/auth/sessions'),
      rootContext,
    )

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHENTICATED')
    expect(mocks.listSessions).not.toHaveBeenCalled()
  })

  it('passes only the W02-authenticated principal, cursor, and limit to W02', async () => {
    const response = await GET(
      request('https://luckread.test/auth/sessions?cursor=cursor-1&limit=20'),
      rootContext,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      currentSessionId: 'session-current',
      items: [
        {
          sessionId: 'session-current',
          deviceId: 'android-42',
          createdAt: '2026-10-02T00:00:00.000Z',
          expiresAt: '2026-10-03T00:00:00.000Z',
          lastSeenAt: '2026-10-02T01:00:00.000Z',
          },
      ],
      nextCursor: 'cursor-next',
    })

    expect(mocks.resolveBetterAuthPrincipalThroughW02).toHaveBeenCalledTimes(1)
    expect(mocks.resolveBetterAuthPrincipalThroughW02.mock.calls[0][0]).toBeInstanceOf(Request)
    expect(mocks.listSessions).toHaveBeenCalledWith({
      userId: 'user-42',
      currentSessionId: 'session-current',
      tokenVersion: 3,
      cursor: 'cursor-1',
      limit: 20,
    })
  })

  it('maps W02 permission failures without leaking implementation details', async () => {
    mocks.listSessions.mockRejectedValue(
      new mocks.MockW02AuthClientError(403, 'cross-account session access denied'),
    )

    const response = await GET(
      request('https://luckread.test/auth/sessions'),
      rootContext,
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'PERMISSION_DENIED',
        message: 'Permission denied',
      },
    })
  })

  it('rejects nested GET paths instead of treating them as the session collection', async () => {
    const response = await GET(
      request('https://luckread.test/auth/sessions/unexpected'),
      { params: Promise.resolve({ segments: ['unexpected'] }) },
    )

    expect(response.status).toBe(404)
    expect(mocks.resolveBetterAuthPrincipalThroughW02).not.toHaveBeenCalled()
  })

  it('requires Idempotency-Key before revoking an owned session', async () => {
    const response = await DELETE(
      request('https://luckread.test/auth/sessions/session-target', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ segments: ['session-target'] }) },
    )

    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
    expect(mocks.resolveBetterAuthPrincipalThroughW02).not.toHaveBeenCalled()
    expect(mocks.revokeOwnedSession).not.toHaveBeenCalled()
  })

  it('revokes only the requested owned session and returns no body', async () => {
    const response = await DELETE(
      request('https://luckread.test/auth/sessions/session-target', {
        method: 'DELETE',
        headers: { 'Idempotency-Key': 'session-revoke-1' },
      }),
      { params: Promise.resolve({ segments: ['session-target'] }) },
    )

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(response.headers.get('cache-control')).toBe('no-store')

    expect(mocks.revokeOwnedSession).toHaveBeenCalledWith({
      userId: 'user-42',
      currentSessionId: 'session-current',
      tokenVersion: 3,
      targetSessionId: 'session-target',
    })
  })
})
