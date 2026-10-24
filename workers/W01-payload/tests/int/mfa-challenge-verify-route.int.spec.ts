import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  w02Fetch: vi.fn(),
  globalLimiter: { limit: vi.fn() },
  writeLimiter: { limit: vi.fn() },
}))
vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: mocks.getCloudflareContext }))

import { POST } from '../../src/app/api/v1/auth/mfa/challenge/verify/route.js'

const makeRequest = (body: unknown = { code: '123456', method: 'totp' }) => new Request(
  'https://api.luckread.com/v1/auth/mfa/challenge/verify',
  {
    method: 'POST',
    headers: {
      cookie: 'two_factor=signed-challenge',
      'content-type': 'application/json',
      'cf-connecting-ip': '203.0.113.10',
    },
    body: JSON.stringify(body),
  },
)

describe('W01 public MFA challenge verification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.globalLimiter.limit.mockResolvedValue({ success: true })
    mocks.writeLimiter.limit.mockResolvedValue({ success: true })
    mocks.getCloudflareContext.mockResolvedValue({
      env: {
        W01_WRITE_ORIGIN_GLOBAL_LIMITER: mocks.globalLimiter,
        W01_WRITE_LIMITER: mocks.writeLimiter,
        W02_AUTH: { fetch: mocks.w02Fetch },
      },
    })
    mocks.w02Fetch.mockImplementation(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input)
      const path = new URL(request.url).pathname
      if (path === '/api/auth/two-factor/verify-totp' || path === '/api/auth/two-factor/verify-backup-code') {
        return Response.json(
          { token: 'never-in-json', user: { id: 'user-1', email: 'u@example.com', name: 'User', emailVerified: true, image: null } },
          { headers: { 'set-auth-token': 'opaque-session-token-value', 'set-cookie': 'better-auth.session_token=opaque; HttpOnly; Secure' } },
        )
      }
      return Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })
    })
  })

  it('verifies TOTP challenge via W02 and only returns the public user plus header token', async () => {
    const response = await POST(makeRequest())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('X-LuckRead-Session-Token')).toBe('opaque-session-token-value')
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    const payload = await response.json()
    expect(payload).toMatchObject({
      data: { authenticated: true, user: { id: 'user-1', email: 'u@example.com', emailVerified: true } },
    })
    expect(JSON.stringify(payload)).not.toContain('never-in-json')
    const request = mocks.w02Fetch.mock.calls.map((call) => call[0] as Request)
      .find((value) => new URL(value.url).pathname === '/api/auth/two-factor/verify-totp')
    expect(request).toBeDefined()
    await expect(request?.json()).resolves.toEqual({ code: '123456', trustDevice: false })
  })

  it('uses Better Auth single-use recovery codes without trusting a device', async () => {
    const response = await POST(makeRequest({ method: 'recovery_code', code: 'RECOVERY-ONE' }))
    expect(response.status).toBe(200)
    const request = mocks.w02Fetch.mock.calls.map((call) => call[0] as Request)
      .find((value) => new URL(value.url).pathname === '/api/auth/two-factor/verify-backup-code')
    expect(request).toBeDefined()
    await expect(request?.json()).resolves.toEqual({
      code: 'RECOVERY-ONE', disableSession: false, trustDevice: false,
    })
  })

  it('rejects caller-supplied assurance fields and malformed codes before W02', async () => {
    const response = await POST(makeRequest({ code: '123456', method: 'totp', authenticated: true }))
    expect(response.status).toBe(422)
    expect(mocks.w02Fetch).not.toHaveBeenCalled()
  })

  it('sanitizes failed verification and returns no token on failure', async () => {
    mocks.w02Fetch.mockResolvedValueOnce(Response.json(
      { message: 'private error details' }, { status: 401 },
    ))
    const response = await POST(makeRequest())
    expect(response.status).toBe(401)
    expect(await response.text()).not.toContain('private error details')
    expect(response.headers.get('X-LuckRead-Session-Token')).toBeNull()
  })
})
