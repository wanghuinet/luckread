import { describe, expect, it } from 'vitest'
import {
  createSessionExtension,
  establishAuthenticatedSession,
  revokeSessionExtension,
  validateAuthoritativeSession,
  refreshSessionFromAuthoritativeD1,
  type NativeSessionAuthority,
  type SessionRecord,
} from './session-runtime.js'

const NOW = '2026-09-22T13:00:00.000Z'

function nativeSession(overrides: Partial<NativeSessionAuthority> = {}): NativeSessionAuthority {
  return {
    sessionId: 'sid-1',
    userId: '42',
    createdAt: '2026-09-22T12:00:00.000Z',
    expiresAt: '2026-09-22T14:00:00.000Z',
    ...overrides,
  }
}

function dbFake(initial: SessionRecord | null) {
  let row = initial
  let nativeSessionPresent = Boolean(initial)

  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({ sql, args }),
    }),
    batch: async (statements: Array<{ sql?: string; args?: unknown[] }>) =>
      statements.map((statement) => {
        const sql = statement.sql ?? ''
        const args = statement.args ?? []

        if (sql.includes('UPDATE auth_session_state')) {
          if (!row || row.revokedAt) return { meta: { changes: 0 } }
          const [revokedAt, lastSeenAt] = args as [string, string, string]
          row = { ...row, revokedAt, lastSeenAt, tokenVersion: row.tokenVersion + 1 }
          return { meta: { changes: 1 } }
        }

        if (sql.includes('DELETE FROM users_sessions')) {
          if (!nativeSessionPresent) return { meta: { changes: 0 } }
          nativeSessionPresent = false
          return { meta: { changes: 1 } }
        }

        return { meta: { changes: 0 } }
      }),
  }

  return {
    db: db as unknown as D1Database,
    getRow: () => row,
    getNativeSessionPresent: () => nativeSessionPresent,
  }
}

describe('session runtime foundation', () => {
  it('creates one extension record from the native session id and returns only a refresh credential', async () => {
    const calls: string[] = []
    const fake = dbFake(null)
    const result = await createSessionExtension(fake.db, nativeSession(), 'device-a', NOW, 4, {
      randomToken: () => 'refresh-1',
      execute: async () => {
        calls.push('insert')
        return { meta: { changes: 1 } }
      },
    })

    expect(result).toEqual({ sessionId: 'sid-1', refreshToken: 'v4.refresh-1' })
    expect(calls).toEqual(['insert'])
  })

  it('rejects empty device ids before persistence', async () => {
    const fake = dbFake(null)
    await expect(createSessionExtension(fake.db, nativeSession(), '', NOW, 4, {
      randomToken: () => 'refresh-1',
      execute: async () => ({ meta: { changes: 1 } }),
    })).rejects.toThrow('deviceId')
  })

  it('revokes extension state and the Payload-native session atomically', async () => {
    const fake = dbFake({
      sessionId: 'sid-1',
      userId: '42',
      deviceId: 'device-a',
      tokenVersion: 3,
      refreshCredentialHash: 'hash',
      revokedAt: null,
      lastSeenAt: NOW,
      nativeExpiresAt: nativeSession().expiresAt,
    })
    const result = await revokeSessionExtension(fake.db, 'sid-1', NOW)
    expect(result).toEqual({ revoked: true })
    expect(fake.getRow()?.revokedAt).toBe(NOW)
    expect(fake.getRow()?.tokenVersion).toBe(4)
    expect(fake.getNativeSessionPresent()).toBe(false)

    const second = await revokeSessionExtension(fake.db, 'sid-1', NOW)
    expect(second).toEqual({ revoked: false })
  })
})


describe('authoritative session validation', () => {
  it('validates native session plus authoritative extension state', async () => {
    let row: {
      sessionId: string
      userId: string
      expiresAt: string
      extensionUserId: string
      tokenVersion: number
      revokedAt: string | null
      accountState: string
    } | null = {
      sessionId: 'sid-1',
      userId: '42',
      expiresAt: '2026-09-22T14:00:00.000Z',
      extensionUserId: '42',
      tokenVersion: 3,
      revokedAt: null,
      accountState: 'ACTIVE',
    }

    const db = {
      prepare: () => ({
        bind: () => ({
          first: async <T>() => row as T | null,
        }),
      }),
    } as unknown as D1Database

    await expect(validateAuthoritativeSession(db, {
      sessionId: 'sid-1',
      userId: '42',
      tokenVersion: 3,
      now: NOW,
    })).resolves.toEqual({ active: true })

    await expect(validateAuthoritativeSession(db, {
      sessionId: 'sid-1',
      userId: '42',
      tokenVersion: 4,
      now: NOW,
    })).resolves.toEqual({ active: false })

    row = { ...row!, revokedAt: NOW }

    await expect(validateAuthoritativeSession(db, {
      sessionId: 'sid-1',
      userId: '42',
      tokenVersion: 3,
      now: NOW,
    })).resolves.toEqual({ active: false })
  })
})

describe('authenticated session orchestration', () => {
  it('requires an authoritative account state and binds an allowed layer before issuing refresh state', async () => {
    const fake = dbFake(null)
    const calls: string[] = []
    const result = await establishAuthenticatedSession(
      fake.db,
      nativeSession(),
      'device-a',
      'ACTIVE',
      NOW,
      4,
      {
        resolveLayer: async (_db, subjectId, accountState) => {
          calls.push(`${subjectId}:${accountState}`)
          return { decision: 'ALLOW', layer: 'L2' }
        },
        randomToken: () => 'refresh-1',
        execute: async () => ({ meta: { changes: 1 } }),
      },
    )

    expect(result).toEqual({ sessionId: 'sid-1', refreshToken: 'v4.refresh-1', layer: 'L2' })
    expect(calls).toEqual(['42:ACTIVE'])
  })

  it('does not create extension state when authoritative layer resolution denies', async () => {
    const fake = dbFake(null)
    await expect(establishAuthenticatedSession(
      fake.db,
      nativeSession(),
      'device-a',
      'SUSPENDED',
      NOW,
      4,
      {
        resolveLayer: async () => ({ decision: 'DENY' }),
        execute: async () => { throw new Error('extension must not be written') },
      },
    )).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

})

describe('AUTH-011 refresh runtime', () => {
  const refreshSession = {
    sessionId: 'sid-refresh',
    userId: '42',
    deviceId: 'device-a',
    tokenVersion: 3,
    refreshCredentialHash: 'hash:v3.old',
    revokedAt: null,
    lastSeenAt: NOW,
    nativeExpiresAt: '2026-09-22T14:00:00.000Z',
  }

  function refreshDb(state = { ...refreshSession }) {
    let current = state
    const db = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          first: async <T>() => {
            if (sql.includes('FROM auth_session_state AS a')) {
              return {
                ...current,
                accountState: 'ACTIVE',
                email: 'user@example.com',
              } as T
            }
            return null as T
          },
          run: async () => {
            if (sql.includes('UPDATE auth_session_state')) {
              const expectedHash = String(args[3] ?? '')
              if (current.refreshCredentialHash !== expectedHash || current.revokedAt !== null) {
                return { meta: { changes: 0 } }
              }
              current = {
                ...current,
                refreshCredentialHash: String(args[0]),
                lastSeenAt: String(args[1]),
              }
              return { meta: { changes: 1 } }
            }
            return { meta: { changes: 0 } }
          },
        }),
      }),
    }
    return db as unknown as D1Database
  }

  it('rotates the predecessor credential exactly once', async () => {
    const db = refreshDb()
    const result = await refreshSessionFromAuthoritativeD1(db, {
      refreshToken: 'v3.old',
      deviceId: 'device-a',
      now: NOW,
      randomToken: () => 'next',
      hashToken: async (value) => 'hash:' + value,
      resolveLayer: async () => ({ decision: 'ALLOW', layer: 'L2' }),
    })

    expect(result).toEqual({
      sessionId: 'sid-refresh',
      userId: '42',
      refreshToken: 'v3.next',
      tokenVersion: 3,
      layer: 'L2',
      nativeExpiresAt: '2026-09-22T14:00:00.000Z',
      email: 'user@example.com',
    })

    await expect(refreshSessionFromAuthoritativeD1(db, {
      refreshToken: 'v3.old',
      deviceId: 'device-a',
      now: NOW,
      randomToken: () => 'replay',
      hashToken: async (value) => 'hash:' + value,
      resolveLayer: async () => ({ decision: 'ALLOW', layer: 'L2' }),
    })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('fails closed on wrong device binding before rotation', async () => {
    const db = refreshDb()
    await expect(refreshSessionFromAuthoritativeD1(db, {
      refreshToken: 'v3.old',
      deviceId: 'device-wrong',
      now: NOW,
      randomToken: () => 'unused',
      hashToken: async (value) => 'hash:' + value,
      resolveLayer: async () => ({ decision: 'ALLOW', layer: 'L2' }),
    })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('denies when authoritative authorization rejects the account', async () => {
    const db = refreshDb()
    await expect(refreshSessionFromAuthoritativeD1(db, {
      refreshToken: 'v3.old',
      deviceId: 'device-a',
      now: NOW,
      randomToken: () => 'unused',
      hashToken: async (value) => 'hash:' + value,
      resolveLayer: async () => ({ decision: 'DENY' }),
    })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('allows at most one concurrent rotation for the same predecessor', async () => {
    const db = refreshDb()
    const results = await Promise.allSettled([
      refreshSessionFromAuthoritativeD1(db, {
        refreshToken: 'v3.old',
        deviceId: 'device-a',
        now: NOW,
        randomToken: () => 'next-a',
        hashToken: async (value) => 'hash:' + value,
        resolveLayer: async () => ({ decision: 'ALLOW', layer: 'L2' }),
      }),
      refreshSessionFromAuthoritativeD1(db, {
        refreshToken: 'v3.old',
        deviceId: 'device-a',
        now: NOW,
        randomToken: () => 'next-b',
        hashToken: async (value) => 'hash:' + value,
        resolveLayer: async () => ({ decision: 'ALLOW', layer: 'L2' }),
      }),
    ])

    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'UNAUTHENTICATED' })
  })
})


describe('AUTH-002 native session binding boundaries', () => {
  it('binds extension state to the native sid and preserves the native expiry', async () => {
    const db = {
      prepare: () => ({
        bind: (..._args: unknown[]) => ({
          first: async <T>() => ({
            sessionId: 'native-sid-7',
            userId: '42',
            createdAt: '2026-09-22T12:00:00.000Z',
            expiresAt: '2026-09-22T14:00:00.000Z',
            accountState: 'ACTIVE',
          } as T),
        }),
      }),
    } as unknown as D1Database

    const result = await establishSessionFromAuthoritativeD1(db, {
      sessionId: 'native-sid-7',
      userId: '42',
      deviceId: 'device-a',
      now: NOW,
      resolveLayer: async () => ({ decision: 'ALLOW', layer: 'L2' }),
      randomToken: () => 'refresh-7',
      execute: async (_db, sql, bindings) => {
        expect(sql).toContain('INSERT INTO auth_session_state')
        expect(bindings).toContain('native-sid-7')
        expect(bindings).toContain('42')
        expect(bindings).toContain('device-a')
        return { meta: { changes: 1 } }
      },
    })

    expect(result).toEqual({
      sessionId: 'native-sid-7',
      refreshToken: 'v1.refresh-7',
      tokenVersion: 1,
      layer: 'L2',
      nativeExpiresAt: '2026-09-22T14:00:00.000Z',
    })
  })

  it('fails closed on an expired native session before extension persistence', async () => {
    const db = {
      prepare: () => ({
        bind: (..._args: unknown[]) => ({
          first: async <T>() => ({
            sessionId: 'native-sid-expired',
            userId: '42',
            createdAt: '2026-09-22T10:00:00.000Z',
            expiresAt: '2026-09-22T12:59:59.000Z',
            accountState: 'ACTIVE',
          } as T),
        }),
      }),
    } as unknown as D1Database

    await expect(establishSessionFromAuthoritativeD1(db, {
      sessionId: 'native-sid-expired',
      userId: '42',
      deviceId: 'device-a',
      now: NOW,
      resolveLayer: async () => ({ decision: 'ALLOW', layer: 'L2' }),
      execute: async () => {
        throw new Error('extension persistence must not run for expired native session')
      },
    })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })
})
