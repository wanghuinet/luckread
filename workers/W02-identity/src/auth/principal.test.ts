import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  activateEmailVerifiedAccount: vi.fn(),
  ensureVerifiedUserRole: vi.fn().mockResolvedValue(undefined),
  requireMfaForPrivilegedAction: vi.fn().mockResolvedValue(false),
  resolveGlobalLayer: vi.fn().mockResolvedValue({
    decision: 'ALLOW',
    layer: 'L3',
    roleAssignments: [{ id: 'ra-1', roleId: 'creator', scopeType: 'global', scopeId: null }],
  }),
  getSession: vi.fn().mockResolvedValue({
    user: { id: 'u1', email: 'user@example.com', accountState: 'ACTIVE', accountStateVersion: 2 },
    session: {
      id: 's1',
      createdAt: new Date('2026-10-06T00:00:00.000Z'),
      expiresAt: new Date('2026-10-07T00:00:00.000Z'),
    },
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
  resolveGlobalLayer: mocks.resolveGlobalLayer,
}))

vi.mock('./privileged-mfa-gate.js', () => ({
  requireMfaForPrivilegedAction: mocks.requireMfaForPrivilegedAction,
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
  it('downgrades an L8 principal and removes privileged assignments until its session proves MFA', async () => {
    mocks.resolveGlobalLayer.mockResolvedValueOnce({
      decision: 'ALLOW',
      layer: 'L8',
      roleAssignments: [
        { id: 'ra-user', roleId: 'user', scopeType: 'global', scopeId: null },
        { id: 'ra-verified', roleId: 'verified_user', scopeType: 'global', scopeId: null },
        { id: 'ra-super', roleId: 'super_admin', scopeType: 'global', scopeId: null },
      ],
    })
    mocks.requireMfaForPrivilegedAction.mockResolvedValueOnce(false)
    mocks.getSession.mockResolvedValueOnce({
      user: { id: 'u-l8', email: 'l8@example.com', accountState: 'ACTIVE', accountStateVersion: 2 },
      session: {
        id: 's-l8-pre-mfa',
        createdAt: new Date('2026-10-24T09:00:00.000Z'),
        expiresAt: new Date('2026-10-24T18:00:00.000Z'),
      },
    })

    const result = await resolveBetterAuthPrincipal(
      { D1_01: {} as D1Database },
      new Request('https://luckread.test', {
        headers: { cookie: 'better-auth.session_token=test' },
      }),
      '2026-10-24T10:00:00.000Z',
    )

    expect(mocks.requireMfaForPrivilegedAction).toHaveBeenCalledWith(
      expect.anything(),
      'u-l8',
      new Date('2026-10-24T09:00:00.000Z'),
    )
    expect(result).toMatchObject({
      userId: 'u-l8',
      layer: 'L2',
      roleAssignments: [
        { id: 'ra-user', roleId: 'user' },
        { id: 'ra-verified', roleId: 'verified_user' },
      ],
    })
    expect(result?.roleAssignments.some((assignment) => assignment.roleId === 'super_admin')).toBe(false)
  })

  it('preserves L8 only when the current session passes the MFA gate', async () => {
    mocks.resolveGlobalLayer.mockResolvedValueOnce({
      decision: 'ALLOW',
      layer: 'L8',
      roleAssignments: [
        { id: 'ra-user', roleId: 'user', scopeType: 'global', scopeId: null },
        { id: 'ra-verified', roleId: 'verified_user', scopeType: 'global', scopeId: null },
        { id: 'ra-super', roleId: 'super_admin', scopeType: 'global', scopeId: null },
      ],
    })
    mocks.requireMfaForPrivilegedAction.mockResolvedValueOnce(true)
    mocks.getSession.mockResolvedValueOnce({
      user: { id: 'u-l8', email: 'l8@example.com', accountState: 'ACTIVE', accountStateVersion: 2 },
      session: {
        id: 's-l8-mfa',
        createdAt: new Date('2026-10-24T10:01:00.000Z'),
        expiresAt: new Date('2026-10-24T18:00:00.000Z'),
      },
    })

    const result = await resolveBetterAuthPrincipal(
      { D1_01: {} as D1Database },
      new Request('https://luckread.test', {
        headers: { cookie: 'better-auth.session_token=test' },
      }),
      '2026-10-24T10:02:00.000Z',
    )

    expect(result?.layer).toBe('L8')
    expect(result?.roleAssignments.some((assignment) => assignment.roleId === 'super_admin')).toBe(true)
  })

})
