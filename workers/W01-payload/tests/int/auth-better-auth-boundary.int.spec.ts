import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

  it('does not forward browser-supplied internal LuckRead transport headers to W02', () => {
    const client = readFileSync(
      resolve(process.cwd(), 'src/auth/w02-session-client.ts'),
      'utf8',
    )
    expect(client).toContain("startsWith('x-luckread-')")
    expect(client).toContain('headers.delete(name)')
    expect(client).toContain("headers.delete('host')")
    expect(client).toContain("headers.delete('content-length')")
  })

  it('does not expose direct Better Auth signup without the W01 registration seam', () => {
    const route = readFileSync(
      resolve(process.cwd(), 'src/app/api/auth/[...segments]/route.ts'),
      'utf8',
    )
    expect(route).toContain("canonicalW01AuthEndpoints")
    expect(route).toContain("'sign-up/email'")
    expect(route).toContain("'change-password'")
    expect(route).toContain("'request-password-reset'")
    expect(route).toContain("'reset-password'")
    expect(route).toContain("This authentication operation is not available at this endpoint")
    expect(route).toContain("'NOT_FOUND'")
    expect(route).toContain('idempotency')
    expect(route).toContain('Payload projection')
    expect(route).not.toContain("AUTH_REGISTER_LIMITER")
    const denyIndex = route.indexOf('canonicalW01AuthEndpoints.has(endpoint)')
    const upstreamIndex = route.indexOf("service.fetch(")
    expect(denyIndex).toBeGreaterThanOrEqual(0)
    expect(upstreamIndex).toBeGreaterThanOrEqual(0)
    expect(denyIndex).toBeLessThan(upstreamIndex)
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
