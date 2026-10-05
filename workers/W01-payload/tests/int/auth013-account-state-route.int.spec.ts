import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class MockW02PrincipalClientError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message)
    }
  }

  class MockW02AuthClientError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message)
    }
  }

  return {
    resolveCanonicalPrincipal: vi.fn(),
    transitionAccountState: vi.fn(),
    MockW02PrincipalClientError,
    MockW02AuthClientError,
  }
})

vi.mock('../../src/auth/w02-principal-client.js', () => ({
  resolveCanonicalPrincipal: mocks.resolveCanonicalPrincipal,
  W02PrincipalClientError: mocks.MockW02PrincipalClientError,
}))

vi.mock('../../src/auth/w02-session-client.js', () => ({
  transitionAccountState: mocks.transitionAccountState,
  W02AuthClientError: mocks.MockW02AuthClientError,
}))

import { POST } from '../../src/app/users/[userId]/account-state/route.js'

describe('AUTH-013 W01 public account-state route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.resolveCanonicalPrincipal.mockResolvedValue({
      userId: '7',
      email: 'admin@example.test',
      sessionId: 'sid-7',
      accountState: 'ACTIVE',
      accountStateVersion: 3,
      layer: 'L8',
    })
    mocks.transitionAccountState.mockResolvedValue({
      from: 'ACTIVE',
      to: 'RESTRICTED',
      auditEventId: 'evt-013',
    })
  })

  it('denies requests without a verified Better Auth principal', async () => {
    mocks.resolveCanonicalPrincipal.mockResolvedValueOnce(null)

    const response = await POST(
      new Request('https://luckread.test/v1/users/42/account-state', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer missing',
          'If-Match': '"7"',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ to: 'RESTRICTED', reason: 'moderation action' }),
      }),
      { params: Promise.resolve({ userId: '42' }) },
    )

    expect(response.status).toBe(401)
    expect(mocks.resolveCanonicalPrincipal).toHaveBeenCalledTimes(1)
    expect(mocks.transitionAccountState).not.toHaveBeenCalled()
  })

  it('returns service unavailable when W02 principal resolution fails', async () => {
    mocks.resolveCanonicalPrincipal.mockRejectedValueOnce(
      new mocks.MockW02PrincipalClientError(503, 'internal details'),
    )

    const response = await POST(
      new Request('https://luckread.test/v1/users/42/account-state', {
        method: 'POST',
        headers: {
          Cookie: 'better-auth.session_token=opaque-session',
          'If-Match': '"7"',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ to: 'RESTRICTED', reason: 'moderation action' }),
      }),
      { params: Promise.resolve({ userId: '42' }) },
    )

    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe('SERVICE_UNAVAILABLE')
    expect(mocks.transitionAccountState).not.toHaveBeenCalled()
  })

  it('passes only the verified principal and canonical public fields to W02', async () => {
    const response = await POST(
      new Request('https://luckread.test/v1/users/42/account-state', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer verified',
          'If-Match': '"7"',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          to: 'RESTRICTED',
          reason: 'moderation action',
          actor: { id: 'attacker', type: 'admin' },
          permission: 'user.ban',
          approvalLevel: 'L8',
        }),
      }),
      { params: Promise.resolve({ userId: '42' }) },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      from: 'ACTIVE',
      to: 'RESTRICTED',
      auditEventId: 'evt-013',
    })

    expect(mocks.transitionAccountState).toHaveBeenCalledWith({
      subjectId: '7',
      targetUserId: '42',
      to: 'RESTRICTED',
      reason: 'moderation action',
      expectedVersion: 7,
    })

    const transitionInput = mocks.transitionAccountState.mock.calls[0][0]
    expect(transitionInput).not.toHaveProperty('actor')
    expect(transitionInput).not.toHaveProperty('permission')
    expect(transitionInput).not.toHaveProperty('approvalLevel')
  })
})
