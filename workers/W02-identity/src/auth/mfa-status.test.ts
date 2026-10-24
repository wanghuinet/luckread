import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolvePrincipal: vi.fn(),
}))

vi.mock('./principal.js', () => ({
  resolveBetterAuthPrincipal: mocks.resolvePrincipal,
}))

import type { BetterAuthEnv } from './better-auth.js'
import { handleMfaStatusRequest, readAuthoritativeMfaStatus } from './mfa-status.js'

const makeDb = (row: unknown) => {
  const statement = {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(row),
  }
  const db = { prepare: vi.fn(() => statement) }
  return { db: db as unknown as D1Database, prepare: db.prepare, statement }
}

const NOW = new Date('2026-10-24T12:00:00.000Z')

const internalRequest = (includeW01Marker = true) => new Request(
  'https://luckread-w02.internal/internal/auth/mfa/status',
  {
    method: 'POST',
    headers: {
      cookie: 'better-auth.session_token=opaque-session',
      ...(includeW01Marker ? {
        'X-LuckRead-Caller': 'W01',
        'X-LuckRead-Transport-Version': '1.0',
      } : {}),
    },
  },
)


describe('W02 authoritative MFA status projection', () => {
  beforeEach(() => vi.clearAllMocks())
  it('returns only the minimal public status for a verified active factor', async () => {
    const db = makeDb({
      userEnabled: 1,
      enrolledAt: '2026-10-24T11:00:00.000Z',
      factorVerified: 1,
      secret: 'must-not-be-exposed',
      backupCodes: 'must-not-be-exposed',
      failedVerificationCount: 9,
      lockedUntil: '2026-10-24T12:30:00.000Z',
      lastAcceptedTotpTimeStep: 123,
    })
    const result = await readAuthoritativeMfaStatus(db.db, 'user-1', NOW)

    expect(result).toEqual({
      enabled: true,
      verified: true,
      enrolledAt: '2026-10-24T11:00:00.000Z',
    })
    expect(Object.keys(result ?? {}).sort()).toEqual(['enabled', 'enrolledAt', 'verified'])
    expect(db.prepare).toHaveBeenCalledTimes(1)
    expect(db.statement.bind).toHaveBeenCalledWith('user-1')
    expect(db.prepare.mock.calls[0]?.[0]).toContain('LEFT JOIN "twoFactor"')
    expect(JSON.stringify(result)).not.toContain('must-not-be-exposed')
  })

  it('does not report an abandoned enrollment as enabled or verified', async () => {
    const db = makeDb({
      userEnabled: 0,
      enrolledAt: null,
      factorVerified: 0,
    })
    await expect(readAuthoritativeMfaStatus(db.db, 'user-1', NOW)).resolves.toEqual({
      enabled: false,
      verified: false,
      enrolledAt: null,
    })
  })

  it('fails closed when account enablement lacks a verified factor and valid enrollment timestamp', async () => {
    const rows = [
      { userEnabled: 1, enrolledAt: null, factorVerified: 1 },
      { userEnabled: 1, enrolledAt: 'not-a-date', factorVerified: 1 },
      { userEnabled: 1, enrolledAt: '2026-10-24T13:00:00.000Z', factorVerified: 1 },
      { userEnabled: 1, enrolledAt: '2026-10-24T11:00:00.000Z', factorVerified: 0 },
    ]
    for (const row of rows) {
      const db = makeDb(row)
      await expect(readAuthoritativeMfaStatus(db.db, 'user-1', NOW)).resolves.toMatchObject({
        enabled: false,
        enrolledAt: null,
      })
    }
  })

  it('returns null when the authenticated subject no longer exists', async () => {
    const db = makeDb(null)
    await expect(readAuthoritativeMfaStatus(db.db, 'user-1', NOW)).resolves.toBeNull()
  })

  it('rejects invalid subjects before querying D1', async () => {
    const db = makeDb(null)
    await expect(readAuthoritativeMfaStatus(db.db, '', NOW)).rejects.toThrow('invalid MFA status subject')
    expect(db.prepare).not.toHaveBeenCalled()
  })

  it('fails closed on database errors', async () => {
    const statement = { bind: vi.fn().mockReturnThis(), first: vi.fn().mockRejectedValue(new Error('D1 unavailable')) }
    const db = { prepare: vi.fn(() => statement) } as unknown as D1Database
    await expect(readAuthoritativeMfaStatus(db, 'user-1', NOW)).rejects.toThrow('D1 unavailable')
  })
})

describe('W02 private MFA status service-binding boundary', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects requests without W01 service-boundary markers before authentication or D1 access', async () => {
    const db = makeDb({ userEnabled: 1, enrolledAt: '2026-10-24T11:00:00.000Z', factorVerified: 1 })
    const env = { D1_01: db.db } as BetterAuthEnv
    const response = await handleMfaStatusRequest(env, internalRequest(false))
    expect(response.status).toBe(403)
    expect(db.prepare).not.toHaveBeenCalled()
    expect(mocks.resolvePrincipal).not.toHaveBeenCalled()
  })

  it('requires a real ACTIVE Better Auth principal and returns only the public status projection', async () => {
    const db = makeDb({ userEnabled: 1, enrolledAt: '2026-10-24T11:00:00.000Z', factorVerified: 1 })
    const env = { D1_01: db.db } as BetterAuthEnv
    mocks.resolvePrincipal.mockResolvedValue({
      userId: 'user-1',
      accountState: 'ACTIVE',
    })
    const request = internalRequest()
    const response = await handleMfaStatusRequest(env, request)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      data: { enabled: true, verified: true, enrolledAt: '2026-10-24T11:00:00.000Z' },
    })
    expect(mocks.resolvePrincipal).toHaveBeenCalledWith(env, request)
  })

  it('does not return an invented disabled state when authentication is absent or account is not active', async () => {
    for (const principal of [null, { userId: 'user-1', accountState: 'SUSPENDED' }]) {
      const db = makeDb({ userEnabled: 1, enrolledAt: '2026-10-24T11:00:00.000Z', factorVerified: 1 })
      const env = { D1_01: db.db } as BetterAuthEnv
      mocks.resolvePrincipal.mockResolvedValueOnce(principal)
      const response = await handleMfaStatusRequest(env, internalRequest())
      expect(response.status).toBe(401)
      expect(db.prepare).not.toHaveBeenCalled()
      await response.body?.cancel()
    }
  })

  it('fails closed when the MFA table or D1 is unavailable', async () => {
    const statement = { bind: vi.fn().mockReturnThis(), first: vi.fn().mockRejectedValue(new Error('missing twoFactor table')) }
    const db = { prepare: vi.fn(() => statement) } as unknown as D1Database
    const env = { D1_01: db } as BetterAuthEnv
    mocks.resolvePrincipal.mockResolvedValue({ userId: 'user-1', accountState: 'ACTIVE' })
    const response = await handleMfaStatusRequest(env, internalRequest())
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } })
  })
})
