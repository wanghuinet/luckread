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
    readVerifiedPayloadTokenVersion: vi.fn(),
    validateSession: vi.fn(),
    transitionAccountState: vi.fn(),
    MockW02AuthClientError,
  }
})

vi.mock('payload', () => ({
  getPayload: mocks.getPayload,
}))

vi.mock('@payload-config', () => ({
  default: {},
}))

vi.mock('../../src/auth/payload-access-token.js', () => ({
  readVerifiedPayloadTokenVersion: mocks.readVerifiedPayloadTokenVersion,
}))

vi.mock('../../src/auth/w02-session-client.js', () => ({
  validateSession: mocks.validateSession,
  transitionAccountState: mocks.transitionAccountState,
  W02AuthClientError: mocks.MockW02AuthClientError,
}))

import { POST } from '../../src/app/users/[userId]/account-state/route.js'

describe('AUTH-013 W01 public account-state route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.getPayload.mockResolvedValue({
      auth: vi.fn().mockResolvedValue({
        user: {
          id: '7',
          _sid: 'sid-7',
        },
      }),
    })

    mocks.readVerifiedPayloadTokenVersion.mockReturnValue(3)
    mocks.validateSession.mockResolvedValue(true)
    mocks.transitionAccountState.mockResolvedValue({
      from: 'ACTIVE',
      to: 'RESTRICTED',
      auditEventId: 'evt-013',
    })
  })

  it('denies requests without a verified Payload principal', async () => {
    mocks.getPayload.mockResolvedValue({
      auth: vi.fn().mockResolvedValue({ user: null }),
    })

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
    expect(mocks.validateSession).not.toHaveBeenCalled()
    expect(mocks.transitionAccountState).not.toHaveBeenCalled()
  })

  it('denies requests whose authoritative session is no longer active', async () => {
    mocks.validateSession.mockResolvedValue(false)

    const response = await POST(
      new Request('https://luckread.test/v1/users/42/account-state', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer stale',
          'If-Match': '"7"',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ to: 'RESTRICTED', reason: 'moderation action' }),
      }),
      { params: Promise.resolve({ userId: '42' }) },
    )

    expect(response.status).toBe(401)
    expect(mocks.transitionAccountState).not.toHaveBeenCalled()
    expect(mocks.validateSession).toHaveBeenCalledWith({
      sessionId: 'sid-7',
      userId: '7',
      tokenVersion: 3,
    })
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
