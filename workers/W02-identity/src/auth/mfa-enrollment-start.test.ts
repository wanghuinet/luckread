import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolvePrincipal: vi.fn(),
  handler: vi.fn(),
  limiter: { limit: vi.fn() },
}))
vi.mock('./principal.js', () => ({ resolveBetterAuthPrincipal: mocks.resolvePrincipal }))
vi.mock('./better-auth.js', () => ({
  createLuckReadAuth: vi.fn(() => ({ handler: mocks.handler })),
}))

import type { BetterAuthEnv } from './better-auth.js'
import type { MfaEnrollmentStartStore } from './mfa-enrollment-start-store.js'
import type { MfaEnrollmentStartHandlerDependencies } from './mfa-enrollment-start.js'
import { handleMfaEnrollmentStartRequest } from './mfa-enrollment-start.js'

const principal = {
  userId: 'user-12345678',
  email: 'user@example.com',
  sessionId: 'session-1',
  accountState: 'ACTIVE',
  accountStateVersion: 1,
  layer: 'L2',
  roleAssignments: [],
}

const makeRequest = (
  body: unknown = { currentPassword: 'correct horse battery staple' },
  key = 'mfa-enroll-key-0001',
  w01 = true,
) => new Request('https://luckread-w02.internal/internal/auth/mfa/enrollment/start', {
  method: 'POST',
  headers: {
    cookie: 'better-auth.session_token=opaque-session',
    'content-type': 'application/json',
    ...(key ? { 'Idempotency-Key': key } : {}),
    ...(w01 ? { 'X-LuckRead-Caller': 'W01', 'X-LuckRead-Transport-Version': '1.0' } : {}),
  },
  body: JSON.stringify(body),
})

function makeMemoryStore() {
  let reservation: string | null = null
  const store = {
    reserve: vi.fn(async ({ keyHash }: Parameters<MfaEnrollmentStartStore['reserve']>[0]) => {
      if (reservation !== null) return false
      reservation = keyHash
      return true
    }),
    recordFailure: vi.fn(async (_event: Parameters<MfaEnrollmentStartStore['recordFailure']>[0]) => undefined),
    releaseReservationIfNoFactor: vi.fn(async (_userId: string, keyHash: string) => {
      if (reservation === keyHash) reservation = null
    }),
    state: () => reservation,
  }
  return store
}

const makeAuth = (): NonNullable<MfaEnrollmentStartHandlerDependencies['auth']> =>
  ({ handler: mocks.handler }) as unknown as NonNullable<MfaEnrollmentStartHandlerDependencies['auth']>
const makeEnv = (): BetterAuthEnv => ({
  AUTH_SESSION_WRITE_LIMITER: mocks.limiter,
} as unknown as BetterAuthEnv)

const call = (
  store?: MfaEnrollmentStartStore,
  request = makeRequest(),
  env = makeEnv(),
) => handleMfaEnrollmentStartRequest(env, request, {
  ...(store ? { store } : {}),
  auth: makeAuth(),
})

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
  })

  it('fails closed when no persistence store is injected', async () => {
    const response = await handleMfaEnrollmentStartRequest(makeEnv(), makeRequest())
    expect(response.status).toBe(503)
    expect(mocks.handler).not.toHaveBeenCalled()
  })

  it('uses the injected persistence port and returns only the one-time enrollment DTO', async () => {
    const store = makeMemoryStore()
    const response = await call(store)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      data: {
        totpUri: 'otpauth://totp/LuckRead:user%40example.com?secret=ABCDEFGHIJKLMNOP&issuer=LuckRead',
        recoveryCodes: ['RECOVERY-ONE', 'RECOVERY-TWO'],
      },
    })
    expect(mocks.limiter.limit).toHaveBeenCalledWith({ key: 'auth-mfa-enrollment-start:user-12345678' })
    expect(store.reserve).toHaveBeenCalledTimes(1)
    const reservation = store.reserve.mock.calls[0]?.[0]
    expect(reservation?.userId).toBe(principal.userId)
    expect(reservation?.keyHash).toMatch(/^[a-f0-9]{64}$/)
    expect(reservation?.event).toMatchObject({
      eventType: 'auth.mfa.enrollment_started',
      resourceId: principal.userId,
      payload: {
        operationId: 'authMfaEnrollmentStart',
        result: 'started',
        factorState: 'PENDING_VERIFICATION',
      },
    })
    expect(JSON.stringify(reservation?.event)).not.toMatch(/correct horse|ABCDEFGHIJKLMNOP|RECOVERY-ONE/)
    expect(mocks.handler).toHaveBeenCalledTimes(1)
    const forwarded = mocks.handler.mock.calls[0]?.[0] as Request
    expect(new URL(forwarded.url).pathname).toBe('/api/auth/two-factor/enable')
    expect(forwarded.headers.get('cookie')).toBe('better-auth.session_token=opaque-session')
    await expect(forwarded.json()).resolves.toEqual({ password: 'correct horse battery staple', method: 'totp' })
    expect(store.recordFailure).not.toHaveBeenCalled()
    expect(store.releaseReservationIfNoFactor).not.toHaveBeenCalled()
  })

  it('rejects non-W01 callers and inactive identities before reserving a factor', async () => {
    const store = makeMemoryStore()
    const forbidden = await call(store, makeRequest(undefined, 'mfa-enroll-key-0001', false))
    expect(forbidden.status).toBe(403)
    expect(store.reserve).not.toHaveBeenCalled()

    mocks.resolvePrincipal.mockResolvedValueOnce({ ...principal, accountState: 'SUSPENDED' })
    const inactive = await handleMfaEnrollmentStartRequest(makeEnv(), makeRequest(), {
      store,
      auth: makeAuth(),
    })
    expect(inactive.status).toBe(403)
    expect(store.reserve).not.toHaveBeenCalled()
    expect(mocks.handler).not.toHaveBeenCalled()
  })

  it('rejects repeated or competing enrollment keys without a second Better Auth write', async () => {
    const store = makeMemoryStore()
    expect((await call(store)).status).toBe(200)
    expect((await call(store)).status).toBe(409)
    expect((await call(store, makeRequest(
      { currentPassword: 'correct horse battery staple' },
      'mfa-enroll-key-0002',
    ))).status).toBe(409)
    expect(mocks.handler).toHaveBeenCalledTimes(1)
  })

  it('requires a valid idempotency key and releases only the matching unmaterialized reservation on upstream failure', async () => {
    const store = makeMemoryStore()
    expect((await call(store, makeRequest(undefined, ''))).status).toBe(400)
    expect(store.reserve).not.toHaveBeenCalled()

    mocks.handler.mockRejectedValueOnce(new Error('internal adapter failed'))
    const failed = await call(store)
    expect(failed.status).toBe(503)
    expect(store.recordFailure).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'auth.mfa.enrollment_failed',
      resourceId: principal.userId,
    }))
    expect(store.releaseReservationIfNoFactor).toHaveBeenCalledWith(
      principal.userId,
      expect.stringMatching(/^[a-f0-9]{64}$/),
    )
    expect(store.state()).toBeNull()
  })

  it('fails closed on malformed enrollment output or an unavailable rate-limit binding', async () => {
    const store = makeMemoryStore()
    mocks.handler.mockResolvedValueOnce(Response.json({ method: 'totp', totpURI: 'bad', backupCodes: [] }))
    expect((await call(store)).status).toBe(503)

    mocks.handler.mockClear()
    expect((await call(makeMemoryStore(), makeRequest(), {} as BetterAuthEnv)).status).toBe(503)
    expect(mocks.handler).not.toHaveBeenCalled()
  })
})
