import { describe, expect, it } from 'vitest'
import {
  createSessionExtension,
  establishAuthenticatedSession,
  establishSessionFromAuthoritativeD1,
  refreshSessionFromAuthoritativeD1,
  reconcileOrphanedSessionExtensions,
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

        if (sql.includes('DELETE FROM "session"')) {
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

})

describe('password-change session extension reconciliation', () => {
  it('revokes extensions whose native sessions were removed while preserving the current session', async () => {
    let statement = ''
    let bindings: unknown[] = []
    const db = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          run: async () => {
            statement = sql
            bindings = args
            return { meta: { changes: 2 } }
          },
        }),
      }),
    } as unknown as D1Database

    await expect(
      reconcileOrphanedSessionExtensions(
        db,
        'user-7',
        'session-current',
        NOW,
      ),
    ).resolves.toBe(2)

    expect(statement).toContain('UPDATE auth_session_state')
    expect(statement).toContain('NOT EXISTS')
    expect(statement).toContain('FROM "session"')
    expect(bindings).toEqual([
      NOW,
      NOW,
      'user-7',
      'session-current',
      'session-current',
    ])
  })

  it('fails closed on invalid reconciliation input', async () => {
    await expect(
      reconcileOrphanedSessionExtensions(
        {} as D1Database,
        '',
        'session-current',
        NOW,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
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
    accessToken: 'native-token-42',
    tokenVersion: 3,
    refreshCredentialHash: 'hash:v3.old',
    revokedAt: null,
    lastSeenAt: NOW,
    nativeExpiresAt: '2026-09-22T14:00:00.000Z',
  }

  function refreshDb(state = { ...refreshSession }) {
    let current = state
    const queries: string[] = []
    const db = {
      prepare: (sql: string) => {
        queries.push(sql)
        return {
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
        }
      },
    }
    return { db: db as unknown as D1Database, queries }
  }

  it('rotates the predecessor credential exactly once', async () => {
    const fake = refreshDb()
    const result = await refreshSessionFromAuthoritativeD1(fake.db, {
      refreshToken: 'v3.old',
      deviceId: 'device-a',
      now: NOW,
      randomToken: () => 'next',
      hashToken: async (value) => 'hash:' + value,
      resolveLayer: async () => ({ decision: 'ALLOW', layer: 'L2' }),
    })

    expect(fake.queries.some((sql) => sql.includes('INNER JOIN "session" AS s'))).toBe(true)
    expect(fake.queries.some((sql) => sql.includes('users_sessions'))).toBe(false)

    expect(result).toEqual({
      sessionId: 'sid-refresh',
      userId: '42',
      accessToken: 'native-token-42',
      refreshToken: 'v3.next',
      tokenVersion: 3,
      layer: 'L2',
      nativeExpiresAt: '2026-09-22T14:00:00.000Z',
      expiresIn: 3600,
      email: 'user@example.com',
    })

    await expect(refreshSessionFromAuthoritativeD1(fake.db, {
      refreshToken: 'v3.old',
      deviceId: 'device-a',
      now: NOW,
      randomToken: () => 'replay',
      hashToken: async (value) => 'hash:' + value,
      resolveLayer: async () => ({ decision: 'ALLOW', layer: 'L2' }),
    })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('fails closed on wrong device binding before rotation', async () => {
    const fake = refreshDb()
    await expect(refreshSessionFromAuthoritativeD1(fake.db, {
      refreshToken: 'v3.old',
      deviceId: 'device-wrong',
      now: NOW,
      randomToken: () => 'unused',
      hashToken: async (value) => 'hash:' + value,
      resolveLayer: async () => ({ decision: 'ALLOW', layer: 'L2' }),
    })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('denies when authoritative authorization rejects the account', async () => {
    const fake = refreshDb()
    await expect(refreshSessionFromAuthoritativeD1(fake.db, {
      refreshToken: 'v3.old',
      deviceId: 'device-a',
      now: NOW,
      randomToken: () => 'unused',
      hashToken: async (value) => 'hash:' + value,
      resolveLayer: async () => ({ decision: 'DENY' }),
    })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('allows at most one concurrent rotation for the same predecessor', async () => {
    const fake = refreshDb()
    const results = await Promise.allSettled([
      refreshSessionFromAuthoritativeD1(fake.db, {
        refreshToken: 'v3.old',
        deviceId: 'device-a',
        now: NOW,
        randomToken: () => 'next-a',
        hashToken: async (value) => 'hash:' + value,
        resolveLayer: async () => ({ decision: 'ALLOW', layer: 'L2' }),
      }),
      refreshSessionFromAuthoritativeD1(fake.db, {
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
      prepare: (sql: string) => ({
        bind: (..._args: unknown[]) => ({
          first: async <T>() => {
            if (sql.includes('FROM role_assignments')) return null as T
            return {
              sessionId: 'native-sid-7',
              userId: '42',
              createdAt: '2026-09-22T12:00:00.000Z',
              expiresAt: '2026-09-22T14:00:00.000Z',
              accessToken: 'native-token-42',
              accountState: 'ACTIVE',
            } as T
          },
          run: async () => ({ meta: { changes: 1 } }),
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
      expiresIn: 3600,
    })
  })


  it('materializes the canonical user role and allows an unverified account to establish an L1 session', async () => {
    const queries: string[] = []
    const db = {
      prepare: (sql: string) => ({
        bind: (..._args: unknown[]) => {
          queries.push(sql)
          return {
            first: async <T>() => {
              if (sql.includes('FROM role_assignments')) return null as T
              return {
                sessionId: 'native-sid-pending',
                userId: '42',
                createdAt: '2026-09-22T12:00:00.000Z',
                expiresAt: '2026-09-22T14:00:00.000Z',
                accountState: 'PENDING_VERIFICATION',
              } as T
            },
            run: async () => ({ meta: { changes: 1 } }),
          }
        },
      }),
    } as unknown as D1Database

    const result = await establishSessionFromAuthoritativeD1(db, {
      sessionId: 'native-sid-pending',
      userId: '42',
      deviceId: 'device-a',
      now: NOW,
      resolveLayer: async (_db, userId, accountState) => {
        expect(userId).toBe('42')
        expect(accountState).toBe('PENDING_VERIFICATION')
        return { decision: 'ALLOW', layer: 'L1' }
      },
      randomToken: () => 'refresh-pending',
      execute: async () => ({ meta: { changes: 1 } }),
    })

    expect(result.layer).toBe('L1')
    expect(queries.some((sql) => sql.includes('INSERT OR IGNORE INTO role_assignments'))).toBe(true)
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
            accessToken: 'expired-native-token',
            accountState: 'ACTIVE',
          } as T),
          run: async () => ({ meta: { changes: 0 } }),
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
