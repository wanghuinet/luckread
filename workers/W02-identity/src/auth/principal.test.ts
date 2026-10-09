import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  activateEmailVerifiedAccount: vi.fn(),
  getSession: vi.fn().mockResolvedValue({
    user: { id: 'u1', email: 'user@example.com', accountState: 'ACTIVE', accountStateVersion: 2 },
    session: { id: 's1', expiresAt: new Date('2026-10-07T00:00:00.000Z') },
  }),
}))

vi.mock('./better-auth.js', () => ({
  createLuckReadAuth: () => ({
    api: { getSession: mocks.getSession },
  }),
}))

vi.mock('../authz/role-assignment.js', () => ({
  resolveGlobalLayer: vi.fn().mockResolvedValue({ decision: 'ALLOW', layer: 'L3' }),
}))

vi.mock('../account/account-state-transition.js', () => ({
  activateEmailVerifiedAccount: mocks.activateEmailVerifiedAccount,
}))

import { resolveBetterAuthPrincipal } from './principal.js'

describe('W02 Better Auth principal authority', () => {
  it('propagates Better Auth service failures to the W02 boundary', async () => {
    mocks.activateEmailVerifiedAccount.mockReset()
    mocks.getSession.mockRejectedValueOnce(new Error('D1 unavailable'))

    await expect(
      resolveBetterAuthPrincipal(
        {} as D1Database,
        new Request('https://luckread.test'),
        '2026-10-06T20:00:00.000Z',
      ),
    ).rejects.toThrow('D1 unavailable')
  })

  it('activates verified email before resolving the effective authorization layer', async () => {
    mocks.activateEmailVerifiedAccount.mockResolvedValueOnce({
      activated: true,
      accountState: 'ACTIVE',
      accountStateVersion: 2,
    })
    mocks.getSession.mockResolvedValueOnce({
      user: {
        id: 'u-verified',
        email: 'verified@example.com',
        emailVerified: true,
        accountState: 'PENDING_VERIFICATION',
        accountStateVersion: 1,
      },
      session: {
        id: 's-verified',
        expiresAt: new Date('2026-10-08T00:00:00.000Z'),
      },
    })

    const result = await resolveBetterAuthPrincipal(
      {} as D1Database,
      new Request('https://luckread.test', {
        headers: { cookie: 'better-auth.session_token=test' },
      }),
      '2026-10-07T20:00:00.000Z',
    )

    expect(mocks.activateEmailVerifiedAccount).toHaveBeenCalledWith(
      expect.anything(),
      'u-verified',
      '2026-10-07T20:00:00.000Z',
    )
    expect(result).toMatchObject({
      userId: 'u-verified',
      accountState: 'ACTIVE',
      accountStateVersion: 2,
    })
  })

  it('derives identity and session from Better Auth without a secondary session store', async () => {
    const db = {} as D1Database
    const result = await resolveBetterAuthPrincipal(db, new Request('https://luckread.test', {
      headers: { cookie: 'better-auth.session_token=test' },
    }), '2026-10-06T20:00:00.000Z')
    expect(result).toEqual({
      userId: 'u1',
      email: 'user@example.com',
      sessionId: 's1',
      accountState: 'ACTIVE',
      accountStateVersion: 2,
      layer: 'L3',
    })
  })
})
