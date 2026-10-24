import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolvePrincipal: vi.fn(),
  createAuth: vi.fn(),
  handler: vi.fn(),
  limiter: { limit: vi.fn() },
}))
vi.mock('./principal.js', () => ({ resolveBetterAuthPrincipal: mocks.resolvePrincipal }))
vi.mock('./better-auth.js', () => ({ createLuckReadAuth: mocks.createAuth }))

import type { BetterAuthEnv } from './better-auth.js'
import { handleMfaEnrollmentStartRequest } from './mfa-enrollment-start.js'

const makeDb = () => {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(
    'CREATE TABLE "user" (' +
      'id TEXT PRIMARY KEY, ' +
      'two_factor_enabled INTEGER NOT NULL DEFAULT 0, ' +
      'mfa_enrollment_key_hash TEXT)',
  )
  sqlite.exec(
    'CREATE TABLE "twoFactor" (' +
      'id TEXT PRIMARY KEY, userId TEXT NOT NULL UNIQUE)',
  )
  sqlite.exec(
    'CREATE TABLE auth_007_mfa_publication_journal (' +
      'journal_id TEXT PRIMARY KEY NOT NULL, event_id TEXT NOT NULL UNIQUE, event_type TEXT NOT NULL, ' +
      'schema_version TEXT NOT NULL, resource_id TEXT NOT NULL, source_version INTEGER NOT NULL, ' +
      'idempotency_key TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, status TEXT NOT NULL, attempt INTEGER NOT NULL, ' +
      'next_attempt_at TEXT, created_at TEXT NOT NULL, published_at TEXT, last_error_code TEXT)',
  )
  sqlite.prepare(
    'INSERT INTO "user" (id, two_factor_enabled, mfa_enrollment_key_hash) VALUES (?, 0, NULL)',
  ).run('user-12345678')

  const db = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql)
      let values: (string | number | null)[] = []
      return {
        bind(...next: (string | number | null)[]) {
          values = next
          return this
        },
        async run() {
          const result = statement.run(...values)
          return { success: true, meta: { changes: Number(result.changes) } }
        },
        async first<T>() {
          return (statement.get(...values) as T | undefined) ?? null
        },
        async all<T>() {
          return { results: statement.all(...values) as T[] }
        },
      }
    },
    async batch(prepared: Array<{ run: () => Promise<{ success: boolean; meta: { changes: number } }> }>) {
      sqlite.exec('BEGIN')
      try {
        const results = []
        for (const statement of prepared) results.push(await statement.run())
        sqlite.exec('COMMIT')
        return results
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
  } as unknown as D1Database
  return { db, sqlite, close: () => sqlite.close() }
}

const makeRequest = (body: unknown = { currentPassword: 'correct horse battery staple' }, key = 'mfa-enroll-key-0001', w01 = true) =>
  new Request('https://luckread-w02.internal/internal/auth/mfa/enrollment/start', {
    method: 'POST',
    headers: {
      cookie: 'better-auth.session_token=opaque-session',
      'content-type': 'application/json',
      'Idempotency-Key': key,
      ...(w01 ? { 'X-LuckRead-Caller': 'W01', 'X-LuckRead-Transport-Version': '1.0' } : {}),
    },
    body: JSON.stringify(body),
  })

const principal = {
  userId: 'user-12345678',
  email: 'user@example.com',
  sessionId: 'session-1',
  accountState: 'ACTIVE',
  accountStateVersion: 1,
  layer: 'L2',
  roleAssignments: [],
}

describe('W02 MFA enrollment-start authority', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePrincipal.mockResolvedValue(principal)
    mocks.limiter.limit.mockResolvedValue({ success: true })
    mocks.handler.mockResolvedValue(Response.json({
      method: 'totp',
      totpURI: 'otpauth://totp/LuckRead:user%40example.com?secret=ABCDEFGHIJKLMNOP&issuer=LuckRead',
      backupCodes: ['RECOVERY-ONE', 'RECOVERY-TWO'],
    }))
    mocks.createAuth.mockReturnValue({ handler: mocks.handler })
  })

  it('uses real SQLite conditional SQL to reserve a single enrollment and returns a one-time DTO', async () => {
    const { db, sqlite, close } = makeDb()
    try {
      const response = await handleMfaEnrollmentStartRequest({
        D1_01: db,
        AUTH_SESSION_WRITE_LIMITER: mocks.limiter,
      } as BetterAuthEnv, makeRequest())
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({
        data: {
          totpUri: 'otpauth://totp/LuckRead:user%40example.com?secret=ABCDEFGHIJKLMNOP&issuer=LuckRead',
          recoveryCodes: ['RECOVERY-ONE', 'RECOVERY-TWO'],
        },
      })
      expect(mocks.limiter.limit).toHaveBeenCalledWith({ key: 'auth-mfa-enrollment-start:user-12345678' })
      expect(mocks.handler).toHaveBeenCalledTimes(1)
      const forwarded = mocks.handler.mock.calls[0]?.[0] as Request
      expect(new URL(forwarded.url).pathname).toBe('/api/auth/two-factor/enable')
      expect(forwarded.headers.get('cookie')).toBe('better-auth.session_token=opaque-session')
      await expect(forwarded.json()).resolves.toEqual({ password: 'correct horse battery staple', method: 'totp' })
      const account = sqlite.prepare('SELECT mfa_enrollment_key_hash FROM "user" WHERE id = ?')
        .get('user-12345678') as { mfa_enrollment_key_hash: string | null }
      expect(account.mfa_enrollment_key_hash).toMatch(/^[a-f0-9]{64}$/)
      const audit = sqlite.prepare('SELECT event_type, resource_id, status, payload FROM auth_007_mfa_publication_journal')
        .get() as { event_type: string; resource_id: string; status: string; payload: string }
      expect(audit.event_type).toBe('auth.mfa.enrollment_started')
      expect(audit.resource_id).toBe('user-12345678')
      expect(audit.status).toBe('PENDING')
      expect(audit.payload).not.toContain('correct horse battery staple')
      expect(audit.payload).not.toContain('ABCDEFGHIJKLMNOP')
      expect(audit.payload).not.toContain('RECOVERY-ONE')
    } finally {
      close()
    }
  })

  it('rejects non-W01 callers and inactive identities before a factor write', async () => {
    const { db, close } = makeDb()
    try {
      const forbidden = await handleMfaEnrollmentStartRequest({
        D1_01: db, AUTH_SESSION_WRITE_LIMITER: mocks.limiter,
      } as BetterAuthEnv, makeRequest(undefined, 'mfa-enroll-key-0001', false))
      expect(forbidden.status).toBe(403)

      mocks.resolvePrincipal.mockResolvedValueOnce({ ...principal, accountState: 'SUSPENDED' })
      const inactive = await handleMfaEnrollmentStartRequest({
        D1_01: db, AUTH_SESSION_WRITE_LIMITER: mocks.limiter,
      } as BetterAuthEnv, makeRequest())
      expect(inactive.status).toBe(403)
      expect(mocks.handler).not.toHaveBeenCalled()
    } finally {
      close()
    }
  })

  it('rejects repeated or competing keys without calling Better Auth a second time', async () => {
    const { db, close } = makeDb()
    try {
      const env = { D1_01: db, AUTH_SESSION_WRITE_LIMITER: mocks.limiter } as BetterAuthEnv
      const first = await handleMfaEnrollmentStartRequest(env, makeRequest())
      expect(first.status).toBe(200)
      const sameKeyReplay = await handleMfaEnrollmentStartRequest(env, makeRequest())
      expect(sameKeyReplay.status).toBe(409)
      const differentKey = await handleMfaEnrollmentStartRequest(env, makeRequest(
        { currentPassword: 'correct horse battery staple' },
        'mfa-enroll-key-0002',
      ))
      expect(differentKey.status).toBe(409)
      expect(mocks.handler).toHaveBeenCalledTimes(1)
    } finally {
      close()
    }
  })

  it('requires a real idempotency key and clears only an unmaterialized reservation after adapter failure', async () => {
    const { db, sqlite, close } = makeDb()
    try {
      const env = { D1_01: db, AUTH_SESSION_WRITE_LIMITER: mocks.limiter } as BetterAuthEnv
      const noKey = await handleMfaEnrollmentStartRequest(env, makeRequest(
        { currentPassword: 'correct horse battery staple' }, '',
      ))
      expect(noKey.status).toBe(400)
      expect(mocks.handler).not.toHaveBeenCalled()

      mocks.handler.mockRejectedValueOnce(new Error('internal adapter failed'))
      const failed = await handleMfaEnrollmentStartRequest(env, makeRequest())
      expect(failed.status).toBe(503)
      const account = sqlite.prepare('SELECT mfa_enrollment_key_hash FROM "user" WHERE id = ?')
        .get('user-12345678') as { mfa_enrollment_key_hash: string | null }
      expect(account.mfa_enrollment_key_hash).toBeNull()
    } finally {
      close()
    }
  })

  it('fails closed on malformed enrollment output or unavailable rate-limit binding', async () => {
    const { db, close } = makeDb()
    try {
      const env = { D1_01: db, AUTH_SESSION_WRITE_LIMITER: mocks.limiter } as BetterAuthEnv
      mocks.handler.mockResolvedValueOnce(Response.json({ method: 'totp', totpURI: 'bad', backupCodes: [] }))
      const malformed = await handleMfaEnrollmentStartRequest(env, makeRequest())
      expect(malformed.status).toBe(503)

      const noLimiter = await handleMfaEnrollmentStartRequest({ D1_01: db } as BetterAuthEnv, makeRequest())
      expect(noLimiter.status).toBe(503)
    } finally {
      close()
    }
  })
})
