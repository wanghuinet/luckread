import { describe, expect, it } from 'vitest'
import {
  createSessionExtension,
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

    expect(result).toEqual({ sessionId: 'sid-1', refreshToken: 'refresh-1' })
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
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('refresh-1'))
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
      refreshToken: 'refresh-1',
      deviceId: 'device-a',
      now: NOW,
      issueAccessToken: () => 'access-1',
      randomToken: () => 'refresh-2',
    })

    expect(result).toEqual({
      sessionId: 'sid-1',
      accessToken: 'access-1',
      refreshToken: 'refresh-2',
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
      refreshToken: 'refresh-1',
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
      refreshToken: 'refresh-1',
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
      refreshToken: 'refresh-1',
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
  })
})
