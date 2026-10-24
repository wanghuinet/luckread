import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  w02Fetch: vi.fn(),
  globalLimiter: { limit: vi.fn() },
  loginLimiter: { limit: vi.fn() },
}))
vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: mocks.getCloudflareContext }))

import { POST } from '../../src/app/auth/login/route.js'

const request = () => new Request('https://api.luckread.com/v1/auth/login', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'cf-connecting-ip': '203.0.113.10',
  },
  body: JSON.stringify({ identity: 'user@example.com', credential: 'correct horse battery staple' }),
})

describe('W01 login MFA challenge contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.globalLimiter.limit.mockResolvedValue({ success: true })
    mocks.loginLimiter.limit.mockResolvedValue({ success: true })
    mocks.getCloudflareContext.mockResolvedValue({
      env: {
        AUTH_ORIGIN_GLOBAL_LIMITER: mocks.globalLimiter,
        AUTH_LOGIN_LIMITER: mocks.loginLimiter,
        W02_AUTH: { fetch: mocks.w02Fetch },
      },
    })
    mocks.w02Fetch.mockResolvedValue(Response.json(
      { twoFactorRedirect: true, twoFactorMethods: ['totp'] },
      { headers: { 'set-cookie': 'better-auth.two_factor=signed-challenge; HttpOnly; Secure; SameSite=Lax' } },
    ))
  })

  it('returns HTTP 202 with a signed challenge cookie and no session token', async () => {
    const response = await POST(request())
    expect(response.status).toBe(202)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('set-cookie')).toContain('two_factor=signed-challenge')
    expect(response.headers.get('X-LuckRead-Session-Token')).toBeNull()
    await expect(response.json()).resolves.toMatchObject({
      data: { challengeRequired: true, methods: ['totp', 'recovery_code'] },
    })
  })

  it('fails closed if Better Auth says MFA challenge but does not issue its signed cookie', async () => {
    mocks.w02Fetch.mockResolvedValueOnce(Response.json(
      { twoFactorRedirect: true, twoFactorMethods: ['totp'] },
    ))
    const response = await POST(request())
    expect(response.status).toBe(502)
    expect(response.headers.get('X-LuckRead-Session-Token')).toBeNull()
  })
})
