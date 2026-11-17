import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  store: {
    activateEmailVerifiedAccount: vi.fn(),
    ensureVerifiedUserRole: vi.fn(),
    resolveGlobalLayer: vi.fn(),
  },
}))

vi.mock('./better-auth.js', () => ({
  createLuckReadAuth: () => ({
    api: { getSession: mocks.getSession },
  }),
}))

import { resolveBetterAuthPrincipal } from './principal.js'

const NOW = '2026-10-07T20:00:00.000Z'
const futureExpiry = new Date('2026-10-08T00:00:00.000Z')
const store = mocks.store

function resetStore() {
  store.activateEmailVerifiedAccount.mockReset()
  store.ensureVerifiedUserRole.mockReset()
  store.resolveGlobalLayer.mockReset()
  store.activateEmailVerifiedAccount.mockResolvedValue({
    accountState: 'ACTIVE',
    accountStateVersion: 2,
  })
  store.ensureVerifiedUserRole.mockResolvedValue(undefined)
  store.resolveGlobalLayer.mockResolvedValue({
    decision: 'ALLOW',
    layer: 'L2',
    roleAssignments: [{ id: 'verified-user-1', roleId: 'verified_user', scopeType: 'global', scopeId: null }],
  })
}

describe('W02 Better Auth principal authority', () => {
  it('propagates Better Auth session-service failures to the W02 boundary', async () => {
    resetStore()
    mocks.getSession.mockRejectedValueOnce(new Error('Better Auth unavailable'))

    await expect(resolveBetterAuthPrincipal(
      { W02_DATABASE_DRIVER: 'neon' },
      new Request('https://luckread.test'),
      NOW,
      { store, getSession: mocks.getSession },
    )).rejects.toThrow('Better Auth unavailable')
  })

  it('repairs an email-verified account before resolving its authorization layer', async () => {
    resetStore()
    mocks.getSession.mockResolvedValueOnce({
      user: {
        id: 'u-verified',
        email: 'verified@example.com',
        emailVerified: true,
        accountState: 'PENDING_VERIFICATION',
        accountStateVersion: 1,
      },
      session: { id: 's-verified', expiresAt: futureExpiry },
    })

    const result = await resolveBetterAuthPrincipal(
      { W02_DATABASE_DRIVER: 'neon' },
      new Request('https://luckread.test', {
        headers: { cookie: 'better-auth.session_token=test' },
      }),
      NOW,
      { store, getSession: mocks.getSession },
    )

    expect(store.activateEmailVerifiedAccount).toHaveBeenCalledWith('u-verified', NOW)
    expect(store.ensureVerifiedUserRole).toHaveBeenCalledWith('u-verified', NOW)
    expect(store.resolveGlobalLayer).toHaveBeenCalledWith('u-verified', 'ACTIVE', NOW, true)
    expect(result).toMatchObject({
      userId: 'u-verified',
      accountState: 'ACTIVE',
      accountStateVersion: 2,
      layer: 'L2',
    })
  })

  it('derives identity and session from Better Auth while resolving authority through Neon', async () => {
    resetStore()
    mocks.getSession.mockResolvedValueOnce({
      user: {
        id: 'u1',
        email: 'user@example.com',
        accountState: 'ACTIVE',
        accountStateVersion: 2,
      },
      session: { id: 's1', expiresAt: futureExpiry },
    })
    const result = await resolveBetterAuthPrincipal(
      { W02_DATABASE_DRIVER: 'neon' },
      new Request('https://luckread.test', {
        headers: { cookie: 'better-auth.session_token=test' },
      }),
      NOW,
      { store, getSession: mocks.getSession },
    )
    expect(result).toEqual({
      userId: 'u1',
      email: 'user@example.com',
      sessionId: 's1',
      accountState: 'ACTIVE',
      accountStateVersion: 2,
      layer: 'L2',
      roleAssignments: [{ id: 'verified-user-1', roleId: 'verified_user', scopeType: 'global', scopeId: null }],
    })
  })

  it('fails closed when role authority denies the persisted account', async () => {
    resetStore()
    store.resolveGlobalLayer.mockResolvedValueOnce({
      decision: 'DENY',
      layer: null,
      roleAssignments: [],
    })
    mocks.getSession.mockResolvedValueOnce({
      user: { id: 'u-disabled', email: 'disabled@example.com', accountState: 'SUSPENDED' },
      session: { id: 's-disabled', expiresAt: futureExpiry },
    })
    await expect(resolveBetterAuthPrincipal(
      { W02_DATABASE_DRIVER: 'neon' },
      new Request('https://luckread.test'),
      NOW,
      { store, getSession: mocks.getSession },
    )).resolves.toBeNull()
  })
})
