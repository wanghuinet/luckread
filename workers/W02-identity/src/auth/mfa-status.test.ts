import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolvePrincipal: vi.fn(),
}))

vi.mock('./principal.js', () => ({
  resolveBetterAuthPrincipal: mocks.resolvePrincipal,
}))

import type { BetterAuthEnv } from './better-auth.js'
import { handleMfaStatusRequest } from './mfa-status.js'
import type { MfaStatusStore } from './mfa-status.js'

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

const activePrincipal = { userId: 'postgres-user-1', accountState: 'ACTIVE' } as const
const publicStatus = { enabled: true, verified: true, enrolledAt: '2026-10-24T11:00:00.000Z' }

describe('W02 private MFA status service-binding boundary', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects requests without W01 service-boundary markers before authentication or storage access', async () => {
    const env = {} as BetterAuthEnv
    const store: MfaStatusStore = { read: vi.fn().mockResolvedValue(publicStatus) }
    const response = await handleMfaStatusRequest(env, internalRequest(false), { store })
    expect(response.status).toBe(403)
    expect(store.read).not.toHaveBeenCalled()
    expect(mocks.resolvePrincipal).not.toHaveBeenCalled()
  })

  it('requires an ACTIVE Better Auth principal and returns only the public PostgreSQL status projection', async () => {
    const env = {} as BetterAuthEnv
    const store: MfaStatusStore = { read: vi.fn().mockResolvedValue(publicStatus) }
    mocks.resolvePrincipal.mockResolvedValue(activePrincipal)
    const request = internalRequest()
    const response = await handleMfaStatusRequest(env, request, { store })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ data: publicStatus })
    expect(mocks.resolvePrincipal).toHaveBeenCalledWith(env, request)
    expect(store.read).toHaveBeenCalledWith(activePrincipal.userId, expect.any(Date))
  })

  it('uses an explicitly injected store and principal resolver', async () => {
    const env = {} as BetterAuthEnv
    const store: MfaStatusStore = {
      read: vi.fn().mockResolvedValue({ enabled: false, verified: false, enrolledAt: null }),
    }
    const resolvePrincipal = vi.fn().mockResolvedValue(activePrincipal)
    const request = internalRequest()
    const response = await handleMfaStatusRequest(env, request, { store, resolvePrincipal })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      data: { enabled: false, verified: false, enrolledAt: null },
    })
    expect(resolvePrincipal).toHaveBeenCalledWith(env, request)
    expect(store.read).toHaveBeenCalledWith(activePrincipal.userId, expect.any(Date))
  })

  it('does not return an invented disabled state when authentication is absent or account is not active', async () => {
    const env = {} as BetterAuthEnv
    const store: MfaStatusStore = { read: vi.fn().mockResolvedValue(publicStatus) }
    for (const principal of [null, { userId: 'user-1', accountState: 'SUSPENDED' }]) {
      mocks.resolvePrincipal.mockResolvedValueOnce(principal)
      const response = await handleMfaStatusRequest(env, internalRequest(), { store })
      expect(response.status).toBe(401)
      expect(store.read).not.toHaveBeenCalled()
      await response.body?.cancel()
    }
  })

  it('fails closed when the Neon store is missing or unavailable', async () => {
    const env = {} as BetterAuthEnv
    mocks.resolvePrincipal.mockResolvedValue(activePrincipal)
    const missing = await handleMfaStatusRequest(env, internalRequest())
    expect(missing.status).toBe(503)
    const store: MfaStatusStore = { read: vi.fn().mockRejectedValue(new Error('missing twoFactor table')) }
    const unavailable = await handleMfaStatusRequest(env, internalRequest(), { store })
    expect(unavailable.status).toBe(503)
    await expect(unavailable.json()).resolves.toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } })
  })
})
