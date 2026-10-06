import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveBetterAuthPrincipal: vi.fn(),
  transitionAccountState: vi.fn(),
  W02AuthClientError: class extends Error {
    constructor(readonly status: number, message: string) {
      super(message)
    }
  },
}))

vi.mock('../../src/auth/w02-auth-client.js', () => ({
  resolveBetterAuthPrincipal: mocks.resolveBetterAuthPrincipal,
  transitionAccountState: mocks.transitionAccountState,
  W02AuthClientError: mocks.W02AuthClientError,
}))

import { POST } from '../../src/app/users/[userId]/account-state/route.js'

describe('AUTH-013 W01 account-state route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveBetterAuthPrincipal.mockResolvedValue({
      userId: '7',
      email: 'user7@example.com',
      sessionId: 'session-7',
      accountState: 'ACTIVE',
      accountStateVersion: 7,
      layer: 'L8',
    })
    mocks.transitionAccountState.mockResolvedValue({
      from: 'ACTIVE',
      to: 'RESTRICTED',
      auditEventId: 'evt-013',
    })
  })

  it('rejects an unauthenticated Better Auth principal', async () => {
    mocks.resolveBetterAuthPrincipal.mockRejectedValue(new mocks.W02AuthClientError(401, 'authentication required'))

    const response = await POST(
      new Request('https://luckread.test/v1/users/42/account-state', {
        method: 'POST',
        headers: { 'If-Match': '"7"', 'content-type': 'application/json' },
        body: JSON.stringify({ to: 'RESTRICTED', reason: 'moderation action' }),
      }),
      { params: Promise.resolve({ userId: '42' }) },
    )

    expect(response.status).toBe(401)
    expect(mocks.transitionAccountState).not.toHaveBeenCalled()
  })

  it('uses the Better Auth principal as the transition subject and ignores client authorization fields', async () => {
    const request = new Request('https://luckread.test/v1/users/42/account-state', {
      method: 'POST',
      headers: { Authorization: 'Bearer better-auth-token', 'If-Match': '"7"', 'content-type': 'application/json' },
      body: JSON.stringify({
        to: 'RESTRICTED',
        reason: 'moderation action',
        actor: { id: 'attacker' },
        permission: 'user.ban',
        approvalLevel: 'L1',
      }),
    })

    const response = await POST(request, { params: Promise.resolve({ userId: '42' }) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      from: 'ACTIVE',
      to: 'RESTRICTED',
      auditEventId: 'evt-013',
    })
    expect(mocks.transitionAccountState).toHaveBeenCalledWith(
      request,
      {
        subjectId: '7',
        targetUserId: '42',
        to: 'RESTRICTED',
        reason: 'moderation action',
        expectedVersion: 7,
      },
    )
  })
})
