import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  proxyBetterAuth: vi.fn(),
  enforceAuthRateLimit: vi.fn(),
}))

vi.mock('../../src/auth/w02-session-client.js', () => ({
  proxyBetterAuth: mocks.proxyBetterAuth,
}))

vi.mock('../../src/auth/traffic-limit.js', () => ({
  enforceAuthRateLimit: mocks.enforceAuthRateLimit,
  TrafficLimitError: class extends Error {},
  rateLimitResponse: vi.fn(),
}))

import { POST as login } from '../../src/app/auth/login/route.js'
import { POST as refresh } from '../../src/app/auth/refresh/route.js'
import { POST as logout } from '../../src/app/auth/logout/route.js'

const request = (url: string, method = 'POST', body?: unknown) =>
  new Request(url, {
    method,
    headers: { 'content-type': 'application/json', cookie: 'better-auth.session_token=test' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

describe('W01 Better Auth boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enforceAuthRateLimit.mockResolvedValue(undefined)
  })

  it('does not expose direct Better Auth signup without the W01 registration seam', () => {
    const route = readFileSync(
      resolve(process.cwd(), 'src/app/api/auth/[...segments]/route.ts'),
      'utf8',
    )
    expect(route).toContain("endpoint === 'sign-up/email'")
    expect(route).toContain("Direct account registration is not available at this endpoint")
    expect(route).toContain("code: 'NOT_FOUND'")
    expect(route).toContain("'/auth/register'")
    expect(route).toContain('idempotency')
    expect(route).toContain('Payload projection')
  })

  it('proxies login credentials to W02 and does not require legacy device/session material', async () => {
    const upstream = new Response(JSON.stringify({ user: { id: 'u1' } }), {
      status: 200,
      headers: { 'set-cookie': 'better-auth.session_token=abc; Path=/; HttpOnly' },
    })
    mocks.proxyBetterAuth.mockResolvedValue(upstream)

    const response = await login(request('https://luckread.test/api/v1/auth/login', 'POST', {
      identity: 'USER@EXAMPLE.COM',
      credential: 'correct-password',
      deviceId: 'legacy-device-is-ignored',
    }))

    expect(response.status).toBe(200)
    expect(mocks.proxyBetterAuth).toHaveBeenCalledWith(
      expect.any(Request),
      '/sign-in/email',
      expect.objectContaining({
        body: { email: 'user@example.com', password: 'correct-password', rememberMe: true },
      }),
    )
  })

  it('uses Better Auth session retrieval instead of minting a legacy refresh token', async () => {
    mocks.proxyBetterAuth.mockResolvedValue(new Response(JSON.stringify({ user: { id: 'u1' }, session: { id: 's1' } }), { status: 200 }))
    const response = await refresh(request('https://luckread.test/api/v1/auth/refresh', 'POST', {}))
    expect(response.status).toBe(200)
    expect(mocks.proxyBetterAuth).toHaveBeenCalledWith(expect.any(Request), '/get-session', { method: 'GET' })
  })

  it('forwards logout to Better Auth and preserves no-store behavior', async () => {
    mocks.proxyBetterAuth.mockResolvedValue(new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } }))
    const response = await logout(request('https://luckread.test/api/v1/auth/logout'))
    expect(response.status).toBe(204)
    expect(mocks.proxyBetterAuth).toHaveBeenCalledWith(expect.any(Request), '/sign-out')
  })
})
