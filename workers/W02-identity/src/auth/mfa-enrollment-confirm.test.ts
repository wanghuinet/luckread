import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handler: vi.fn(),
  createAuth: vi.fn(),
  resolvePrincipal: vi.fn(),
  readStatus: vi.fn(),
}))

vi.mock('./better-auth.js', () => ({ createLuckReadAuth: mocks.createAuth }))
vi.mock('./principal.js', () => ({ resolveBetterAuthPrincipal: mocks.resolvePrincipal }))
vi.mock('./mfa-status.js', () => ({ readAuthoritativeMfaStatus: mocks.readStatus }))

import type { BetterAuthEnv } from './better-auth.js'
import { handleMfaEnrollmentConfirmRequest } from './mfa-enrollment-confirm.js'

const makeDb = (row: unknown = { userEnabled: 0, factorVerified: 0 }) => {
  const statement = {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(row),
    run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
  }
  const db = { prepare: vi.fn(() => statement) }
  return { db: db as unknown as D1Database, prepare: db.prepare, statement }
}

const makeRequest = (
  body: unknown = { code: '123456' },
  w01 = true,
  key = 'mfa-confirm-key-0001',
) => new Request(
  'https://luckread-w02.internal/internal/auth/mfa/enrollment/confirm',
  {
    method: 'POST',
    headers: {
      cookie: 'better-auth.session_token=opaque-session',
      'content-type': 'application/json',
      ...(key ? { 'Idempotency-Key': key } : {}),
      ...(w01 ? {
        'X-LuckRead-Caller': 'W01',
        'X-LuckRead-Transport-Version': '1.0',
      } : {}),
    },
    body: JSON.stringify(body),
  },
)

const principal = {
  userId: 'user-12345678',
  email: 'user@example.com',
  sessionId: 'session-1',
  accountState: 'ACTIVE',
  accountStateVersion: 1,
  layer: 'L2',
  roleAssignments: [],
}

describe('W02 MFA enrollment confirmation authority', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePrincipal.mockResolvedValue(principal)
    mocks.handler.mockResolvedValue(Response.json(
      { token: 'must-not-leak', user: { id: principal.userId } },
      { headers: {
        'set-auth-token': 'must-not-leak-either',
        'set-cookie': 'luckread.session_token=rotated-session; Domain=.luckread.com; Path=/; HttpOnly; Secure; SameSite=Lax',
      } },
    ))
    mocks.createAuth.mockReturnValue({ handler: mocks.handler })
    mocks.readStatus.mockResolvedValue({
      enabled: true,
      verified: true,
      enrolledAt: '2026-10-24T12:00:00.000Z',
    })
  })

  it('verifies the pending factor through Better Auth then returns D1 read-back without session tokens', async () => {
    const { db, prepare, statement } = makeDb()
    const response = await handleMfaEnrollmentConfirmRequest({ D1_01: db } as BetterAuthEnv, makeRequest())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const payload = await response.json()
    expect(payload).toEqual({
      data: { enabled: true, verified: true, enrolledAt: '2026-10-24T12:00:00.000Z' },
    })
    expect(JSON.stringify(payload)).not.toContain('must-not-leak')
    const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
    const cookies = typeof getSetCookie === 'function'
      ? getSetCookie.call(response.headers)
      : [response.headers.get('set-cookie') ?? '']
    expect(cookies.some((cookie) => cookie.includes('rotated-session'))).toBe(true)
    expect(cookies.some((cookie) => cookie.includes('must-not-leak'))).toBe(false)
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('LEFT JOIN "twoFactor"'))
    expect(statement.bind).toHaveBeenCalledWith(principal.userId)
    expect(mocks.handler).toHaveBeenCalledTimes(1)
    const authRequest = mocks.handler.mock.calls[0]?.[0] as Request
    expect(new URL(authRequest.url).pathname).toBe('/api/auth/two-factor/verify-totp')
    expect(authRequest.headers.get('cookie')).toBe('better-auth.session_token=opaque-session')
    await expect(authRequest.json()).resolves.toEqual({ code: '123456', trustDevice: false })
    expect(mocks.readStatus).toHaveBeenCalledWith(db, principal.userId)
  })

  it('requires an idempotency key before resolving the principal or verifying TOTP', async () => {
    const { db } = makeDb()
    const response = await handleMfaEnrollmentConfirmRequest(
      { D1_01: db } as BetterAuthEnv,
      makeRequest({ code: '123456' }, true, ''),
    )
    expect(response.status).toBe(400)
    expect(mocks.resolvePrincipal).not.toHaveBeenCalled()
    expect(mocks.handler).not.toHaveBeenCalled()
  })

  it('replays only the same successful request and rejects key reuse with a different code', async () => {
    const hash = async (value: string) => {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
    }
    const key = 'mfa-confirm-key-0001'
    const row = {
      userEnabled: 1,
      factorVerified: 1,
      confirmationKeyHash: await hash(key),
      confirmationRequestHash: await hash(key + String.fromCharCode(0) + '123456'),
    }
    const { db } = makeDb(row)
    const replay = await handleMfaEnrollmentConfirmRequest(
      { D1_01: db } as BetterAuthEnv,
      makeRequest({ code: '123456' }, true, key),
    )
    expect(replay.status).toBe(200)
    expect(mocks.handler).not.toHaveBeenCalled()

    const differentPayload = await handleMfaEnrollmentConfirmRequest(
      { D1_01: db } as BetterAuthEnv,
      makeRequest({ code: '654321' }, true, key),
    )
    expect(differentPayload.status).toBe(409)
    expect(mocks.handler).not.toHaveBeenCalled()
  })

  it('rejects calls that did not arrive through the W01 service contract', async () => {
    const { db } = makeDb()
    const response = await handleMfaEnrollmentConfirmRequest({ D1_01: db } as BetterAuthEnv, makeRequest({ code: '123456' }, false))
    expect(response.status).toBe(403)
    expect(mocks.resolvePrincipal).not.toHaveBeenCalled()
    expect(mocks.handler).not.toHaveBeenCalled()
  })

  it('requires an authenticated ACTIVE identity and a six-digit TOTP code', async () => {
    const { db } = makeDb()
    mocks.resolvePrincipal.mockResolvedValueOnce(null)
    const unauthenticated = await handleMfaEnrollmentConfirmRequest({ D1_01: db } as BetterAuthEnv, makeRequest())
    expect(unauthenticated.status).toBe(401)
    expect(mocks.handler).not.toHaveBeenCalled()

    mocks.resolvePrincipal.mockResolvedValueOnce({ ...principal, accountState: 'SUSPENDED' })
    const inactive = await handleMfaEnrollmentConfirmRequest({ D1_01: db } as BetterAuthEnv, makeRequest())
    expect(inactive.status).toBe(401)
    expect(mocks.handler).not.toHaveBeenCalled()

    mocks.resolvePrincipal.mockResolvedValueOnce(principal)
    const invalid = await handleMfaEnrollmentConfirmRequest({ D1_01: db } as BetterAuthEnv, makeRequest({ code: '12345' }))
    expect(invalid.status).toBe(400)
    expect(mocks.handler).not.toHaveBeenCalled()
  })

  it('does not allow confirmation to replace a factor that is already enabled or verified', async () => {
    const { db } = makeDb({ userEnabled: 1, factorVerified: 1 })
    const response = await handleMfaEnrollmentConfirmRequest({ D1_01: db } as BetterAuthEnv, makeRequest())
    expect(response.status).toBe(409)
    expect(mocks.handler).not.toHaveBeenCalled()
  })

  it('returns only a generic failure for invalid TOTP and rejects a false-positive read-back', async () => {
    const { db } = makeDb()
    mocks.handler.mockResolvedValueOnce(Response.json({ message: 'private Better Auth internals' }, { status: 401 }))
    const invalidCode = await handleMfaEnrollmentConfirmRequest({ D1_01: db } as BetterAuthEnv, makeRequest())
    expect(invalidCode.status).toBe(401)
    expect(await invalidCode.text()).not.toContain('private Better Auth internals')

    mocks.handler.mockResolvedValueOnce(Response.json({ ok: true }))
    mocks.readStatus.mockResolvedValueOnce({ enabled: false, verified: false, enrolledAt: null })
    const failedReadback = await handleMfaEnrollmentConfirmRequest({ D1_01: db } as BetterAuthEnv, makeRequest())
    expect(failedReadback.status).toBe(503)
  })
})
