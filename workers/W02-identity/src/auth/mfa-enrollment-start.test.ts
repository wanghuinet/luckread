import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolvePrincipal: vi.fn(),
  createAuth: vi.fn(),
  handler: vi.fn(),
  limiter: { limit: vi.fn() },
  reservedChanges: 1,
  userRow: { accountState: 'ACTIVE', twoFactorEnabled: 0, keyHash: null as string | null },
  factorExists: false,
}))
vi.mock('./principal.js', () => ({ resolveBetterAuthPrincipal: mocks.resolvePrincipal }))
vi.mock('./better-auth.js', () => ({ createLuckReadAuth: mocks.createAuth }))

import type { BetterAuthEnv } from './better-auth.js'
import { handleMfaEnrollmentStartRequest } from './mfa-enrollment-start.js'

const makeDb = () => {
  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: (...args: unknown[]) => ({
        run: async () => {
          if (sql.startsWith('UPDATE "user" SET mfa_enrollment_key_hash = ?')) {
            if (mocks.reservedChanges === 1) {
              mocks.userRow.keyHash = String(args[0])
              return { meta: { changes: 1 } }
            }
            return { meta: { changes: 0 } }
          }
          if (sql.startsWith('UPDATE "user" SET mfa_enrollment_key_hash = NULL')) {
            if (!mocks.factorExists && mocks.userRow.keyHash === args[1]) mocks.userRow.keyHash = null
            return { meta: { changes: 1 } }
          }
          return { meta: { changes: 0 } }
        },
        first: async () => {
          if (sql.includes('FROM "user"')) return mocks.userRow
          if (sql.includes('FROM "twoFactor"')) return mocks.factorExists ? { id: 'factor-1' } : null
          return null
        },
      }),
    })),
  }
  return db as unknown as D1Database
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
    mocks.reservedChanges = 1
    mocks.userRow = { accountState: 'ACTIVE', twoFactorEnabled: 0, keyHash: null }
    mocks.factorExists = false
    mocks.resolvePrincipal.mockResolvedValue(principal)
    mocks.limiter.limit.mockResolvedValue({ success: true })
    mocks.handler.mockResolvedValue(Response.json({
      method: 'totp',
      totpURI: 'otpauth://totp/LuckRead:user%40example.com?secret=ABCDEFGHIJKLMNOP&issuer=LuckRead',
      backupCodes: ['RECOVERY-ONE', 'RECOVERY-TWO'],
    }))
    mocks.createAuth.mockReturnValue({ handler: mocks.handler })
  })

  it('checks the W01 marker, active session, account throttle and atomically reserves a single enrollment', async () => {
    const db = makeDb()
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
  })

  it('rejects non-W01 callers, inactive identities and duplicate/reserved enrollments', async () => {
    const db = makeDb()
    const forbidden = await handleMfaEnrollmentStartRequest({
      D1_01: db, AUTH_SESSION_WRITE_LIMITER: mocks.limiter,
    } as BetterAuthEnv, makeRequest(undefined, 'mfa-enroll-key-0001', false))
    expect(forbidden.status).toBe(403)

    mocks.resolvePrincipal.mockResolvedValueOnce({ ...principal, accountState: 'SUSPENDED' })
    const inactive = await handleMfaEnrollmentStartRequest({
      D1_01: db, AUTH_SESSION_WRITE_LIMITER: mocks.limiter,
    } as BetterAuthEnv, makeRequest())
    expect(inactive.status).toBe(403)

    mocks.reservedChanges = 0
    const duplicate = await handleMfaEnrollmentStartRequest({
      D1_01: db, AUTH_SESSION_WRITE_LIMITER: mocks.limiter,
    } as BetterAuthEnv, makeRequest())
    expect(duplicate.status).toBe(409)
    expect(mocks.handler).not.toHaveBeenCalled()
  })

  it('requires a real idempotency key and clears only an unmaterialized reservation after adapter failure', async () => {
    const db = makeDb()
    const noKey = await handleMfaEnrollmentStartRequest({
      D1_01: db, AUTH_SESSION_WRITE_LIMITER: mocks.limiter,
    } as BetterAuthEnv, makeRequest({ currentPassword: 'correct horse battery staple' }, ''))
    expect(noKey.status).toBe(400)
    expect(mocks.handler).not.toHaveBeenCalled()

    mocks.handler.mockRejectedValueOnce(new Error('internal adapter failed'))
    const failed = await handleMfaEnrollmentStartRequest({
      D1_01: db, AUTH_SESSION_WRITE_LIMITER: mocks.limiter,
    } as BetterAuthEnv, makeRequest())
    expect(failed.status).toBe(503)
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('NOT EXISTS (SELECT 1 FROM "twoFactor"'))
  })

  it('rejects malformed enrollment output and refuses a failed schema reservation', async () => {
    const db = makeDb()
    mocks.handler.mockResolvedValueOnce(Response.json({ method: 'totp', totpURI: 'bad', backupCodes: [] }))
    const malformed = await handleMfaEnrollmentStartRequest({
      D1_01: db, AUTH_SESSION_WRITE_LIMITER: mocks.limiter,
    } as BetterAuthEnv, makeRequest())
    expect(malformed.status).toBe(503)

    const noLimiter = await handleMfaEnrollmentStartRequest({ D1_01: db } as BetterAuthEnv, makeRequest())
    expect(noLimiter.status).toBe(503)
  })
})
