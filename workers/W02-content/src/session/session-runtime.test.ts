import { describe, expect, it } from 'vitest'
import {
  createSessionExtension,
  establishAuthenticatedSession,
  revokeSessionExtension,
  validateAuthoritativeSession,
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
    batch: async (statements: Array<{ sql?: string; args?: unknown[] }>) =>
      statements.map((statement) => {
        const sql = statement.sql ?? ''
        const args = statement.args ?? []

        if (sql.includes('UPDATE auth_session_state')) {
          if (!row || row.revokedAt) return { meta: { changes: 0 } }
          const [revokedAt, lastSeenAt] = args as [string, string, string]
          row = { ...row, revokedAt, lastSeenAt }
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
    expect(fake.getWrites()).toBe(0)
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
      revokedAt: string | null
      accountState: string
    } | null = {
      sessionId: 'sid-1',
      userId: '42',
      expiresAt: '2026-09-22T14:00:00.000Z',
      extensionUserId: '42',
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
      now: NOW,
    })).resolves.toEqual({ active: true })

    row = { ...row!, revokedAt: NOW }

    await expect(validateAuthoritativeSession(db, {
      sessionId: 'sid-1',
      userId: '42',
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
