import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPrincipal: vi.fn(),
  getMfaStatus: vi.fn(),
  proxy: vi.fn(),
  edgeLimiter: vi.fn(),
  accountLimiter: vi.fn(),
  endpointLimiter: vi.fn(),
}))
vi.mock('../../src/auth/w02-session-client.js', () => ({
  getBetterAuthPrincipal: mocks.getPrincipal,
  getMfaStatus: mocks.getMfaStatus,
  proxyBetterAuth: mocks.proxy,
  W02AuthClientError: class W02AuthClientError extends Error {
    constructor(readonly status: number, message: string) { super(message) }
  },
}))
vi.mock('../../src/auth/traffic-limit.js', () => ({
  enforceW01WriteRateLimit: mocks.edgeLimiter,
  enforceW01WriteAccountRateLimit: mocks.accountLimiter,
  enforceW01WriteEndpointRateLimit: mocks.endpointLimiter,
  rateLimitResponse: () => Response.json({ error: { code: 'RATE_LIMITED' } }, { status: 429 }),
  TrafficLimitError: class TrafficLimitError extends Error {},
}))

import { POST as disableMfa } from '../../src/app/auth/mfa/disable/route.js'
import { POST as rotateRecoveryCodes } from '../../src/app/auth/mfa/recovery-codes/rotate/route.js'

const principal = {
  active: true,
  userId: 'user-12345678',
  email: 'user@example.com',
  accountState: 'ACTIVE',
}
const status = { enabled: true, verified: true, enrolledAt: '2026-10-24T12:00:00.000Z' }
const request = (path: string, body: unknown) => new Request('https://api.luckread.com' + path, {
  method: 'POST',
  headers: {
    cookie: 'better-auth.session_token=opaque-session',
    'content-type': 'application/json',
    'cf-connecting-ip': '203.0.113.10',
  },
  body: JSON.stringify(body),
})

describe('W01 MFA factor management routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.edgeLimiter.mockResolvedValue(undefined)
    mocks.accountLimiter.mockResolvedValue(undefined)
    mocks.endpointLimiter.mockResolvedValue(undefined)
    mocks.getPrincipal.mockResolvedValue(principal)
    mocks.getMfaStatus.mockResolvedValue(status)
    mocks.proxy.mockResolvedValue(Response.json({ ok: true }))
  })

  it('requires password plus a valid TOTP step-up before disabling and returns no-store 204', async () => {
    const response = await disableMfa(request('/v1/auth/mfa/disable', {
      currentPassword: 'correct horse battery staple',
      code: '123456',
    }))
    expect(response.status).toBe(204)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.proxy).toHaveBeenNthCalledWith(1, expect.any(Request), '/two-factor/verify-totp', {
      body: { code: '123456', trustDevice: false },
    })
    expect(mocks.proxy).toHaveBeenNthCalledWith(2, expect.any(Request), '/two-factor/disable', {
      body: { password: 'correct horse battery staple' },
    })
    expect(mocks.endpointLimiter).toHaveBeenCalledWith('authMfaDisable')
  })

  it('does not disable when TOTP step-up fails or MFA is not already verified', async () => {
    mocks.proxy.mockResolvedValueOnce(Response.json({ message: 'private' }, { status: 401 }))
    const invalidCode = await disableMfa(request('/v1/auth/mfa/disable', {
      currentPassword: 'correct horse battery staple', code: '123456',
    }))
    expect(invalidCode.status).toBe(401)
    expect(await invalidCode.text()).not.toContain('private')
    expect(mocks.proxy).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    mocks.edgeLimiter.mockResolvedValue(undefined)
    mocks.accountLimiter.mockResolvedValue(undefined)
    mocks.endpointLimiter.mockResolvedValue(undefined)
    mocks.getPrincipal.mockResolvedValue(principal)
    mocks.getMfaStatus.mockResolvedValue({ enabled: false, verified: false, enrolledAt: null })
    const notEnabled = await disableMfa(request('/v1/auth/mfa/disable', {
      currentPassword: 'correct horse battery staple', code: '123456',
    }))
    expect(notEnabled.status).toBe(409)
    expect(mocks.proxy).not.toHaveBeenCalled()
  })

  it('rotates recovery codes only after TOTP and password validation; returns codes once', async () => {
    mocks.proxy
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(Response.json({ backupCodes: ['RECOVERY-ONE', 'RECOVERY-TWO'] }))
    const response = await rotateRecoveryCodes(request('/v1/auth/mfa/recovery-codes/rotate', {
      currentPassword: 'correct horse battery staple',
      code: '123456',
    }))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toMatchObject({
      data: { recoveryCodes: ['RECOVERY-ONE', 'RECOVERY-TWO'] },
    })
    expect(mocks.proxy).toHaveBeenNthCalledWith(1, expect.any(Request), '/two-factor/verify-totp', {
      body: { code: '123456', trustDevice: false },
    })
    expect(mocks.proxy).toHaveBeenNthCalledWith(2, expect.any(Request), '/two-factor/generate-backup-codes', {
      body: { password: 'correct horse battery staple' },
    })
    expect(mocks.endpointLimiter).toHaveBeenCalledWith('authMfaRecoveryCodesRotate')
  })

  it('rejects unknown fields, malformed codes and inactive accounts', async () => {
    const malformed = await rotateRecoveryCodes(request('/v1/auth/mfa/recovery-codes/rotate', {
      currentPassword: 'correct horse battery staple', code: 'ABC123', userId: 'other-user',
    }))
    expect(malformed.status).toBe(422)
    expect(mocks.getPrincipal).not.toHaveBeenCalled()

    mocks.getPrincipal.mockResolvedValueOnce({ ...principal, accountState: 'SUSPENDED' })
    const inactive = await rotateRecoveryCodes(request('/v1/auth/mfa/recovery-codes/rotate', {
      currentPassword: 'correct horse battery staple', code: '123456',
    }))
    expect(inactive.status).toBe(403)
    expect(mocks.proxy).not.toHaveBeenCalled()
  })
})
