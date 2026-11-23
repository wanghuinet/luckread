import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handler: vi.fn(),
  resolvePrincipal: vi.fn(),
}))

vi.mock('./better-auth.js', () => ({
  createLuckReadAuth: vi.fn(),
}))
vi.mock('./principal.js', () => ({
  resolveBetterAuthPrincipal: mocks.resolvePrincipal,
}))

import type { BetterAuthEnv } from './better-auth.js'
import type { MfaAuditOperationReceiptStore } from './mfa-audit-operation-receipt-store.js'
import type { MfaEnrollmentConfirmStore, MfaEnrollmentConfirmState } from './mfa-enrollment-confirm-store.js'
import type { MfaStatusStore } from './mfa-status.js'
import { handleMfaEnrollmentConfirmRequest } from './mfa-enrollment-confirm.js'

const principal = {
  userId: 'user-12345678',
  email: 'user@example.com',
  sessionId: 'session-1',
  accountState: 'ACTIVE',
  accountStateVersion: 1,
  layer: 'L2',
  roleAssignments: [],
}
const status = {
  enabled: true,
  verified: true,
  enrolledAt: '2026-10-24T12:00:00.000Z',
}
const receiptId = 'mfaop_0123456789abcdef0123456789abcdef'

const makeRequest = (
  body: unknown = { code: '123456' },
  w01 = true,
  key = 'mfa-confirm-key-0001',
) => new Request('https://luckread-w02.internal/internal/auth/mfa/enrollment/confirm', {
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
})

function makeHarness(initial: Partial<MfaEnrollmentConfirmState> = {}) {
  let state: MfaEnrollmentConfirmState = {
    userEnabled: false,
    confirmationKeyHash: null,
    confirmationRequestHash: null,
    factorVerified: false,
    ...initial,
  }
  const store: MfaEnrollmentConfirmStore = {
    read: vi.fn(async () => state ? { ...state } : null),
    persistConfirmation: vi.fn(async (input) => {
      state = {
        userEnabled: true,
        confirmationKeyHash: input.keyHash,
        confirmationRequestHash: input.requestHash,
        factorVerified: true,
      }
      return true
    }),
  }
  const statusStore: MfaStatusStore = {
    read: vi.fn(async () => status),
  }
  const receiptStore: MfaAuditOperationReceiptStore = {
    assertOwner: vi.fn(async () => undefined),
    create: vi.fn(async () => receiptId),
    append: vi.fn(async () => undefined),
    finalize: vi.fn(async () => true),
    reconcile: vi.fn(async () => ({ selected: 1, emitted: 1, failed: 0, unknown: 0 })),
  }
  const auth = { handler: mocks.handler }
  const dependencies = {
    store,
    statusStore,
    receiptStore,
    auth,
  }
  return { store, statusStore, receiptStore, dependencies, state: () => ({ ...state }) }
}

const hash = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
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
  })

  it('verifies the pending factor through Better Auth and returns only Neon-store read-back', async () => {
    const h = makeHarness()
    const response = await handleMfaEnrollmentConfirmRequest({} as BetterAuthEnv, makeRequest(), h.dependencies)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({ data: status })
    const cookies = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()
      ?? [response.headers.get('set-cookie') ?? '']
    expect(cookies.some((cookie) => cookie.includes('rotated-session'))).toBe(true)
    expect(cookies.some((cookie) => cookie.includes('must-not-leak'))).toBe(false)

    expect(mocks.handler).toHaveBeenCalledTimes(1)
    const authRequest = mocks.handler.mock.calls[0]?.[0] as Request
    expect(new URL(authRequest.url).pathname).toBe('/api/auth/two-factor/verify-totp')
    expect(authRequest.headers.get('cookie')).toBe('better-auth.session_token=opaque-session')
    expect(authRequest.headers.get('X-LuckRead-MFA-Operation')).toBe('enrollment-confirm')
    expect(authRequest.headers.get('X-LuckRead-MFA-Receipt-Id')).toBe(receiptId)
    expect(authRequest.headers.get('X-LuckRead-MFA-Receipt-Mode')).toBe('defer-finalization')
    await expect(authRequest.json()).resolves.toEqual({ code: '123456', trustDevice: false })
    expect(h.receiptStore.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: principal.userId,
      operationPath: '/two-factor/verify-totp',
      isChallenge: false,
    }))
    expect(h.receiptStore.finalize).toHaveBeenCalledWith(receiptId, [
      expect.objectContaining({
        eventType: 'auth.mfa.enrollment_verified',
        result: 'succeeded',
        reasonCode: 'TOTP_ENROLLMENT_VERIFIED',
        factorState: 'ENABLED',
      }),
    ])
    expect(h.receiptStore.reconcile).toHaveBeenCalledTimes(1)
    expect(h.statusStore.read).toHaveBeenCalledWith(principal.userId, expect.any(Date))
    expect(h.store.persistConfirmation).toHaveBeenCalledWith(expect.objectContaining({
      userId: principal.userId,
      keyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }))
  })

  it('recovers a confirmation marker whose database commit response was lost', async () => {
    const key = 'mfa-confirm-key-lost-commit-0001'
    const keyHash = await hash(key)
    const requestHash = await hash(key + String.fromCharCode(0) + '123456')
    const h = makeHarness()
    h.store.persistConfirmation = vi.fn(async () => {
      // The database committed, but the adapter did not receive its commit response.
      Object.assign(h.state(), {
        userEnabled: true,
        confirmationKeyHash: keyHash,
        confirmationRequestHash: requestHash,
        factorVerified: true,
      })
      throw new Error('commit response lost')
    })
    // Model the committed row through the Store read-back contract.
    let readCount = 0
    h.store.read = vi.fn(async () => {
      readCount += 1
      return readCount === 1
        ? { userEnabled: false, confirmationKeyHash: null, confirmationRequestHash: null, factorVerified: false }
        : { userEnabled: true, confirmationKeyHash: keyHash, confirmationRequestHash: requestHash, factorVerified: true }
    })
    const response = await handleMfaEnrollmentConfirmRequest(
      {} as BetterAuthEnv,
      makeRequest({ code: '123456' }, true, key),
      h.dependencies,
    )
    expect(response.status).toBe(200)
    expect(h.store.persistConfirmation).toHaveBeenCalledWith({ userId: principal.userId, keyHash, requestHash })
    expect(h.store.read).toHaveBeenCalledTimes(2)
    expect(response.headers.get('set-cookie')).toContain('rotated-session')
  })

  it('does not invent an audit outcome when an upstream error has indeterminate Neon read-back', async () => {
    const h = makeHarness()
    mocks.handler.mockRejectedValueOnce(new Error('ambiguous internal failure'))
    vi.mocked(h.statusStore.read).mockResolvedValueOnce(null)
    const response = await handleMfaEnrollmentConfirmRequest({} as BetterAuthEnv, makeRequest(), h.dependencies)
    expect(response.status).toBe(503)
    expect(h.receiptStore.finalize).not.toHaveBeenCalled()
    expect(h.receiptStore.reconcile).not.toHaveBeenCalled()
  })

  it('records a verified enrollment when the upstream response is lost but PostgreSQL proves success', async () => {
    const h = makeHarness()
    mocks.handler.mockRejectedValueOnce(new Error('response lost after mutation'))
    const response = await handleMfaEnrollmentConfirmRequest({} as BetterAuthEnv, makeRequest(), h.dependencies)
    expect(response.status).toBe(503)
    expect(h.receiptStore.finalize).toHaveBeenCalledWith(receiptId, [
      expect.objectContaining({
        eventType: 'auth.mfa.enrollment_verified',
        result: 'succeeded',
        reasonCode: 'TOTP_ENROLLMENT_VERIFIED',
      }),
    ])
  })

  it('requires an idempotency key before resolving the principal or verifying TOTP', async () => {
    const h = makeHarness()
    const response = await handleMfaEnrollmentConfirmRequest(
      {} as BetterAuthEnv,
      makeRequest({ code: '123456' }, true, ''),
      h.dependencies,
    )
    expect(response.status).toBe(400)
    expect(mocks.resolvePrincipal).not.toHaveBeenCalled()
    expect(mocks.handler).not.toHaveBeenCalled()
  })

  it('replays only the same successful request and rejects key reuse with a different code', async () => {
    const key = 'mfa-confirm-key-0001'
    const h = makeHarness({
      userEnabled: true,
      factorVerified: true,
      confirmationKeyHash: await hash(key),
      confirmationRequestHash: await hash(key + String.fromCharCode(0) + '123456'),
    })
    const replay = await handleMfaEnrollmentConfirmRequest(
      {} as BetterAuthEnv,
      makeRequest({ code: '123456' }, true, key),
      h.dependencies,
    )
    expect(replay.status).toBe(200)
    expect(mocks.handler).not.toHaveBeenCalled()

    const differentPayload = await handleMfaEnrollmentConfirmRequest(
      {} as BetterAuthEnv,
      makeRequest({ code: '654321' }, true, key),
      h.dependencies,
    )
    expect(differentPayload.status).toBe(409)
    expect(mocks.handler).not.toHaveBeenCalled()
  })

  it('rejects calls that did not arrive through the W01 service contract', async () => {
    const h = makeHarness()
    const response = await handleMfaEnrollmentConfirmRequest(
      {} as BetterAuthEnv, makeRequest({ code: '123456' }, false), h.dependencies,
    )
    expect(response.status).toBe(403)
    expect(mocks.resolvePrincipal).not.toHaveBeenCalled()
    expect(mocks.handler).not.toHaveBeenCalled()
  })

  it('requires an authenticated ACTIVE identity and a six-digit TOTP code', async () => {
    const h = makeHarness()
    mocks.resolvePrincipal.mockResolvedValueOnce(null)
    expect((await handleMfaEnrollmentConfirmRequest({} as BetterAuthEnv, makeRequest(), h.dependencies)).status).toBe(401)
    expect(mocks.handler).not.toHaveBeenCalled()

    mocks.resolvePrincipal.mockResolvedValueOnce({ ...principal, accountState: 'SUSPENDED' })
    expect((await handleMfaEnrollmentConfirmRequest({} as BetterAuthEnv, makeRequest(), h.dependencies)).status).toBe(401)
    expect(mocks.handler).not.toHaveBeenCalled()

    mocks.resolvePrincipal.mockResolvedValueOnce(principal)
    expect((await handleMfaEnrollmentConfirmRequest(
      {} as BetterAuthEnv, makeRequest({ code: '12345' }), h.dependencies,
    )).status).toBe(400)
    expect(mocks.handler).not.toHaveBeenCalled()
  })

  it('does not allow confirmation to replace a factor that is already enabled or verified', async () => {
    const h = makeHarness({ userEnabled: true, factorVerified: true })
    const response = await handleMfaEnrollmentConfirmRequest({} as BetterAuthEnv, makeRequest(), h.dependencies)
    expect(response.status).toBe(409)
    expect(mocks.handler).not.toHaveBeenCalled()
  })

  it('returns only a generic failure for an invalid TOTP and rejects a false-positive read-back', async () => {
    const h = makeHarness()
    mocks.handler.mockResolvedValueOnce(Response.json(
      { message: 'private Better Auth internals' },
      { status: 401 },
    ))
    const invalidCode = await handleMfaEnrollmentConfirmRequest({} as BetterAuthEnv, makeRequest(), h.dependencies)
    expect(invalidCode.status).toBe(401)
    expect(await invalidCode.text()).not.toContain('private Better Auth internals')
    expect(h.receiptStore.finalize).toHaveBeenCalledWith(receiptId, [
      expect.objectContaining({
        eventType: 'auth.mfa.enrollment_failed',
        result: 'failed',
        reasonCode: 'ENROLLMENT_CONFIRMATION_REJECTED',
      }),
    ])

    const falsePositive = makeHarness()
    mocks.handler.mockResolvedValueOnce(Response.json({ ok: true }))
    vi.mocked(falsePositive.statusStore.read).mockResolvedValueOnce({
      enabled: false,
      verified: false,
      enrolledAt: null,
    })
    const failedReadback = await handleMfaEnrollmentConfirmRequest(
      {} as BetterAuthEnv, makeRequest(), falsePositive.dependencies,
    )
    expect(failedReadback.status).toBe(503)
    expect(falsePositive.receiptStore.finalize).not.toHaveBeenCalled()
  })
})
