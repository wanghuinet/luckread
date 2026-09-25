import { describe, expect, it } from 'vitest'
import {
  createSessionExtension,
  establishAuthenticatedSession,
  refreshAuthenticatedSession,
  rotateRefreshCredential,
  revokeSessionExtension,
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

function dbFake(initial: SessionRecord | null, forcedUpdateChanges?: number) {
  let row = initial
  let reads = 0
  let writes = 0

  const db = {
    prepare: () => ({
      bind: (...args: unknown[]) => ({
        first: async <T>() => {
          reads += 1
          return row as T | null
        },
        all: async <T>() => {
          reads += 1
          return { results: row ? [row as T] : [] }
        },
        run: async () => {
          writes += 1
          if (!row) return { meta: { changes: 0 } }

          if (args.length === 3) {
            const [revokedAt, lastSeenAt] = args as [string, string, string]
            if (row.revokedAt) return { meta: { changes: 0 } }
            row = { ...row, revokedAt, lastSeenAt }
            return { meta: { changes: 1 } }
          }

          const [nextHash, nextSeenAt, , expectedOldHash] = args as [string, string, string, string]
          if (row.refreshCredentialHash !== expectedOldHash) return { meta: { changes: 0 } }
          if (forcedUpdateChanges !== undefined) return { meta: { changes: forcedUpdateChanges } }
          row = { ...row, refreshCredentialHash: nextHash, lastSeenAt: nextSeenAt }
          return { meta: { changes: 1 } }
        },
      }),
    }),
    batch: async () => {
      writes += 1
      return []
    },
  }
  return { db: db as unknown as D1Database, getRow: () => row, getReads: () => reads, getWrites: () => writes }
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

  it('rotates a refresh credential with one authoritative read and one compare-and-update write', async () => {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('v3.refresh-1'))
    const digest = Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('')
    const record: SessionRecord = {
      sessionId: 'sid-1',
      userId: '42',
      deviceId: 'device-a',
      tokenVersion: 3,
      refreshCredentialHash: digest,
      revokedAt: null,
      lastSeenAt: null,
      nativeExpiresAt: nativeSession().expiresAt,
    }
    const fake = dbFake(record)
    const result = await rotateRefreshCredential(fake.db, {
      refreshToken: 'v3.refresh-1',
      deviceId: 'device-a',
      now: NOW,
      issueAccessToken: () => 'access-1',
      randomToken: () => 'refresh-2',
    })

    expect(result).toEqual({
      sessionId: 'sid-1',
      accessToken: 'access-1',
      refreshToken: 'v3.refresh-2',
    })
    expect(fake.getReads()).toBe(1)
    expect(fake.getWrites()).toBe(1)
    expect(fake.getRow()?.refreshCredentialHash).not.toBe(digest)
  })

  it('fails closed when device binding differs', async () => {
    const record: SessionRecord = {
      sessionId: 'sid-1',
      userId: '42',
      deviceId: 'device-a',
      tokenVersion: 3,
      refreshCredentialHash: 'hash',
      revokedAt: null,
      lastSeenAt: null,
      nativeExpiresAt: nativeSession().expiresAt,
    }
    const fake = dbFake(record)
    await expect(rotateRefreshCredential(fake.db, {
      refreshToken: 'v3.refresh-1',
      deviceId: 'device-b',
      now: NOW,
      issueAccessToken: () => 'access-1',
      hashToken: async () => 'hash',
      randomToken: () => 'refresh-2',
    })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    expect(fake.getReads()).toBe(1)
    expect(fake.getWrites()).toBe(0)
  })

  it('fails closed when the native session is expired', async () => {
    const fake = dbFake({
      sessionId: 'sid-1',
      userId: '42',
      deviceId: 'device-a',
      tokenVersion: 3,
      refreshCredentialHash: 'hash',
      revokedAt: null,
      lastSeenAt: null,
      nativeExpiresAt: nativeSession({ expiresAt: '2026-09-22T12:59:59.999Z' }).expiresAt,
    })
    await expect(rotateRefreshCredential(fake.db, {
      refreshToken: 'v3.refresh-1',
      deviceId: 'device-a',
      now: NOW,
      issueAccessToken: () => 'access-1',
      hashToken: async () => 'hash',
      randomToken: () => 'refresh-2',
    })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    expect(fake.getWrites()).toBe(0)
  })

  it('rejects a reused predecessor when compare-and-update changes zero rows', async () => {
    const fake = dbFake({
      sessionId: 'sid-1',
      userId: '42',
      deviceId: 'device-a',
      tokenVersion: 3,
      refreshCredentialHash: 'old-hash',
      revokedAt: null,
      lastSeenAt: NOW,
      nativeExpiresAt: nativeSession().expiresAt,
    }, 0)

    await expect(rotateRefreshCredential(fake.db, {
      refreshToken: 'v3.refresh-1',
      deviceId: 'device-a',
      now: NOW,
      issueAccessToken: () => 'access-1',
      hashToken: async () => 'old-hash',
      randomToken: () => 'refresh-2',
    })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('revokes an extension record idempotently', async () => {
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

    const second = await revokeSessionExtension(fake.db, 'sid-1', NOW)
    expect(second).toEqual({ revoked: false })
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

  it('returns the rotated credential and authoritative layer after refresh', async () => {
    const hash = 'old-hash'
    const record: SessionRecord = {
      sessionId: 'sid-1',
      userId: '42',
      deviceId: 'device-a',
      tokenVersion: 3,
      refreshCredentialHash: hash,
      revokedAt: null,
      lastSeenAt: NOW,
      nativeExpiresAt: nativeSession().expiresAt,
    }
    const fake = dbFake(record)
    const result = await refreshAuthenticatedSession(fake.db, {
      refreshToken: 'v3.refresh-1',
      deviceId: 'device-a',
      accountState: 'ACTIVE',
      now: NOW,
      hashToken: async () => hash,
      randomToken: () => 'refresh-2',
      issueAccessToken: () => 'access-2',
      resolveLayer: async (_db, subjectId, accountState) => {
        expect(subjectId).toBe('42')
        expect(accountState).toBe('ACTIVE')
        return { decision: 'ALLOW', layer: 'L3' }
      },
    })

    expect(result).toEqual({ sessionId: 'sid-1', accessToken: 'access-2', refreshToken: 'v3.refresh-2', layer: 'L3' })
  })
  it('does not mint or rotate when authoritative layer resolution denies', async () => {
    const hash = 'old-hash'
    const record: SessionRecord = {
      sessionId: 'sid-1',
      userId: '42',
      deviceId: 'device-a',
      tokenVersion: 3,
      refreshCredentialHash: hash,
      revokedAt: null,
      lastSeenAt: NOW,
      nativeExpiresAt: nativeSession().expiresAt,
    }
    const fake = dbFake(record)
    let issueCount = 0

    await expect(refreshAuthenticatedSession(fake.db, {
      refreshToken: 'v3.refresh-1',
      deviceId: 'device-a',
      accountState: 'ACTIVE',
      now: NOW,
      hashToken: async () => hash,
      randomToken: () => 'refresh-2',
      issueAccessToken: () => {
        issueCount += 1
        return 'access-2'
      },
      resolveLayer: async () => ({ decision: 'DENY' }),
    })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })

    expect(issueCount).toBe(0)
    expect(fake.getReads()).toBe(1)
    expect(fake.getWrites()).toBe(0)
    expect(fake.getRow()?.refreshCredentialHash).toBe(hash)
  })

})
