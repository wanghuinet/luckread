import { describe, expect, it } from 'vitest'

import { resolveAuthenticatedPrincipal } from './session-runtime.js'

const NOW = '2026-09-22T13:00:00.000Z'

function principalDb(overrides: {
  tokenVersion?: number
  accountState?: string
  expiresAt?: string
  roleId?: string
} = {}) {
  const sessionRow = {
    sessionId: 'sid-1',
    userId: '42',
    expiresAt: overrides.expiresAt ?? '2026-09-22T14:00:00.000Z',
    extensionUserId: '42',
    tokenVersion: overrides.tokenVersion ?? 3,
    revokedAt: null,
    accountState: overrides.accountState ?? 'ACTIVE',
  }

  const db = {
    prepare: (sql: string) => ({
      bind: (..._args: unknown[]) => ({
        first: async <T>() => sessionRow as T,
        all: async <T>() => ({
          results: [
            {
              id: 'role-1',
              subjectId: '42',
              roleId: overrides.roleId ?? 'user',
              scopeType: 'global',
              scopeId: null,
              status: 'ACTIVE',
              validFrom: '2026-09-22T12:00:00.000Z',
              validUntil: null,
              createdAt: '2026-09-22T12:00:00.000Z',
              updatedAt: '2026-09-22T12:00:00.000Z',
            },
          ] as T,
        }),
      }),
    }),
  }

  return db as unknown as D1Database
}

describe('authenticated principal resolution', () => {
  it('accepts an active native session with a matching authoritative role', async () => {
    await expect(resolveAuthenticatedPrincipal(principalDb(), {
      userId: '42',
      sessionId: 'sid-1',
      tokenVersion: 3,
      now: NOW,
    })).resolves.toEqual({ active: true, layer: 'L1' })
  })

  it('rejects a stale tokenVersion before authorizing a layer', async () => {
    await expect(resolveAuthenticatedPrincipal(principalDb(), {
      userId: '42',
      sessionId: 'sid-1',
      tokenVersion: 4,
      now: NOW,
    })).resolves.toEqual({ active: false })
  })

  it('rejects accounts outside the active authentication states', async () => {
    await expect(resolveAuthenticatedPrincipal(principalDb({ accountState: 'SUSPENDED' }), {
      userId: '42',
      sessionId: 'sid-1',
      tokenVersion: 3,
      now: NOW,
    })).resolves.toEqual({ active: false })
  })

  it('rejects an expired native session even when extension state remains present', async () => {
    await expect(resolveAuthenticatedPrincipal(principalDb({ expiresAt: '2026-09-22T12:59:59.000Z' }), {
      userId: '42',
      sessionId: 'sid-1',
      tokenVersion: 3,
      now: NOW,
    })).resolves.toEqual({ active: false })
  })
})
