import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveGlobalLayer: vi.fn(),
  createLuckReadAuth: vi.fn(),
}))

vi.mock('./better-auth.js', () => ({
  createLuckReadAuth: mocks.createLuckReadAuth,
}))

vi.mock('../authz/role-assignment.js', () => ({
  resolveGlobalLayer: mocks.resolveGlobalLayer,
}))

import { resolveBetterAuthPrincipal } from './principal.js'

function dbWithExtension(tokenVersion: number | null) {
  const first = vi.fn().mockResolvedValue(
    tokenVersion === null ? null : { tokenVersion },
  )
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({ first })),
    })),
    first,
  }
}

describe('Better Auth principal resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.createLuckReadAuth.mockReturnValue({
      api: {
        getSession: mocks.getSession,
      },
    })

    mocks.getSession.mockResolvedValue({
      user: {
        id: 'user-42',
        email: 'user-42@example.test',
        accountState: 'ACTIVE',
        accountStateVersion: 4,
      },
      session: {
        id: 'session-42',
        expiresAt: new Date('2026-10-06T01:00:00.000Z'),
      },
    })

    mocks.resolveGlobalLayer.mockResolvedValue({
      decision: 'ALLOW',
      layer: 'L2',
    })
  })

  it('returns the active session extension token version when present', async () => {
    const db = dbWithExtension(7)

    await expect(
      resolveBetterAuthPrincipal(
        db as unknown as D1Database,
        new Request('https://luckread-w02.internal/internal/auth/principal', {
          headers: { cookie: 'better-auth.session_token=opaque' },
        }),
        'test-secret',
        '2026-10-06T00:00:00.000Z',
      ),
    ).resolves.toEqual({
      userId: 'user-42',
      email: 'user-42@example.test',
      sessionId: 'session-42',
      accountState: 'ACTIVE',
      accountStateVersion: 4,
      layer: 'L2',
      tokenVersion: 7,
    })

    expect(db.prepare).toHaveBeenCalledTimes(1)
    expect(mocks.resolveGlobalLayer).toHaveBeenCalledWith(
      db,
      'user-42',
      'ACTIVE',
      '2026-10-06T00:00:00.000Z',
    )
  })

  it('keeps principal resolution usable before session-extension materialization', async () => {
    const db = dbWithExtension(null)

    await expect(
      resolveBetterAuthPrincipal(
        db as unknown as D1Database,
        new Request('https://luckread-w02.internal/internal/auth/principal', {
          headers: { authorization: 'Bearer native-session-token' },
        }),
        'test-secret',
        '2026-10-06T00:00:00.000Z',
      ),
    ).resolves.toMatchObject({
      userId: 'user-42',
      sessionId: 'session-42',
      layer: 'L2',
    })

    const result = await resolveBetterAuthPrincipal(
      db as unknown as D1Database,
      new Request('https://luckread-w02.internal/internal/auth/principal'),
      'test-secret',
      '2026-10-06T00:00:00.000Z',
    )
    expect(result?.tokenVersion).toBeUndefined()
  })

  it('does not expose a stale extension version after it is revoked', async () => {
    const first = vi.fn().mockResolvedValue(null)
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({ first })),
      })),
    }

    mocks.getSession.mockResolvedValue({
      user: {
        id: 'user-42',
        email: 'user-42@example.test',
        accountState: 'ACTIVE',
      },
      session: {
        id: 'session-42',
        expiresAt: new Date('2026-10-06T01:00:00.000Z'),
      },
    })

    const result = await resolveBetterAuthPrincipal(
      db as unknown as D1Database,
      new Request('https://luckread-w02.internal/internal/auth/principal'),
      'test-secret',
      '2026-10-06T00:00:00.000Z',
    )

    expect(result?.tokenVersion).toBeUndefined()
  })
})
