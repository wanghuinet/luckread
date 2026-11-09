import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  activateEmailVerifiedAccount: vi.fn(),
  ensureVerifiedUserRole: vi.fn().mockResolvedValue(undefined),
  getSession: vi.fn().mockResolvedValue({
    user: { id: 'u1', email: 'user@example.com', accountState: 'ACTIVE', accountStateVersion: 2 },
    session: { id: 's1', expiresAt: new Date('2026-10-07T00:00:00.000Z') },
  }),
}))

vi.mock('../account/account-state-transition.js', () => ({
  activateEmailVerifiedAccount: mocks.activateEmailVerifiedAccount,
}))

vi.mock('./better-auth.js', () => ({
  createLuckReadAuth: () => ({
    api: { getSession: mocks.getSession },
  }),
}))

vi.mock('../authz/role-assignment.js', () => ({
  ensureVerifiedUserRole: mocks.ensureVerifiedUserRole,
  resolveGlobalLayer: vi.fn().mockResolvedValue({ decision: 'ALLOW', layer: 'L3', roleAssignments: [{ id: 'ra-1', roleId: 'creator', scopeType: 'global', scopeId: null }] }),
}))

import { resolveBetterAuthPrincipal } from './principal.js'

describe('W02 Better Auth principal authority', () => {
  it('propagates Better Auth service failures to the W02 boundary', async () => {
    mocks.getSession.mockRejectedValueOnce(new Error('D1 unavailable'))

    await expect(
      resolveBetterAuthPrincipal(
        { D1_01: {} as D1Database },
        new Request('https://luckread.test'),
        '2026-10-06T20:00:00.000Z',
      ),
    ).rejects.toThrow('D1 unavailable')
  })

  it('repairs an email-verified account before resolving its authorization layer', async () => {
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

    const env = { D1_01: {} as D1Database }
    const result = await resolveBetterAuthPrincipal(
      env,
      new Request('https://luckread.test', {
        headers: { cookie: 'better-auth.session_token=test' },
      }),
      '2026-10-07T20:00:00.000Z',
    )

    expect(mocks.activateEmailVerifiedAccount).toHaveBeenCalledWith(
      env.D1_01,
      'u-verified',
      '2026-10-07T20:00:00.000Z',
    )
    expect(mocks.ensureVerifiedUserRole).toHaveBeenCalledWith(
      env.D1_01,
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
    const env = { D1_01: {} as D1Database }
    const result = await resolveBetterAuthPrincipal(env, new Request('https://luckread.test', {
      headers: { cookie: 'better-auth.session_token=test' },
    }), '2026-10-06T20:00:00.000Z')
    expect(result).toEqual({
      userId: 'u1',
      email: 'user@example.com',
      sessionId: 's1',
      accountState: 'ACTIVE',
      accountStateVersion: 2,
      layer: 'L3',
      roleAssignments: [{ id: 'ra-1', roleId: 'creator', scopeType: 'global', scopeId: null }],
    })
  })

  it('resolves a Better Auth session through an injected PostgreSQL-compatible authority store', async () => {
    const now = '2026-10-07T20:00:00.000Z'
    const getSession = vi.fn().mockResolvedValueOnce({
      user: {
        id: 'pg-user-1',
        email: 'pg-user@example.com',
        emailVerified: true,
        accountState: 'PENDING_VERIFICATION',
        accountStateVersion: 1,
      },
      session: {
        id: 'pg-session-1',
        expiresAt: new Date('2026-10-08T00:00:00.000Z'),
      },
    })
    const store = {
      activateEmailVerifiedAccount: vi.fn().mockResolvedValue({
        accountState: 'ACTIVE',
        accountStateVersion: 2,
      }),
      ensureVerifiedUserRole: vi.fn().mockResolvedValue(undefined),
      resolveGlobalLayer: vi.fn().mockResolvedValue({
        decision: 'ALLOW',
        layer: 'L2',
        roleAssignments: [{
          id: 'verified-user-pg-user-1',
          roleId: 'verified_user',
          scopeType: 'global',
          scopeId: null,
        }],
      }),
    }
    const env = {} as Parameters<typeof resolveBetterAuthPrincipal>[0]
    const result = await resolveBetterAuthPrincipal(
      env,
      new Request('https://luckread.test', {
        headers: { cookie: 'better-auth.session_token=postgres-session' },
      }),
      now,
      { store, getSession },
    )

    expect(getSession).toHaveBeenCalledWith(expect.any(Headers))
    expect(store.activateEmailVerifiedAccount).toHaveBeenCalledWith('pg-user-1', now)
    expect(store.ensureVerifiedUserRole).toHaveBeenCalledWith('pg-user-1', now)
    expect(store.resolveGlobalLayer).toHaveBeenCalledWith('pg-user-1', 'ACTIVE', now, true)
    expect(result).toEqual({
      userId: 'pg-user-1',
      email: 'pg-user@example.com',
      sessionId: 'pg-session-1',
      accountState: 'ACTIVE',
      accountStateVersion: 2,
      layer: 'L2',
      roleAssignments: [{
        id: 'verified-user-pg-user-1',
        roleId: 'verified_user',
        scopeType: 'global',
        scopeId: null,
      }],
    })
  })
})
