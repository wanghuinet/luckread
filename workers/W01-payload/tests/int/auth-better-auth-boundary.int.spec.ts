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

  it('does not expose direct Better Auth signup without the W01 registration seam', () => {
    const route = readFileSync(
      resolve(process.cwd(), 'src/app/api/auth/[...segments]/route.ts'),
      'utf8',
    )
    expect(route).toContain("canonicalW01AuthEndpoints")
    expect(route).toContain("'sign-up/email'")
    expect(route).toContain("'send-verification-email'")
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

  it('connects email verification delivery and activation in canonical W02', () => {
    const authConfig = readFileSync(
      resolve(process.cwd(), '../W02-identity/src/auth/better-auth.ts'),
      'utf8',
    )
    expect(authConfig).toContain("baseURL: 'https://luckread.com'")
    expect(authConfig).toContain('requireEmailVerification: true')
    expect(authConfig).toContain('sendVerificationEmail: async ({ user, url })')
    expect(authConfig).toContain('afterEmailVerification: async (user)')
    expect(authConfig).toContain("applyAccountStateTransition(db, {")
    expect(authConfig).toContain("to: 'ACTIVE'")
    expect(authConfig).toContain("reason: 'email verification completed'")
  })

  it('hardens W02 schema validation, auth initialization and production trusted origins', () => {
    const authConfig = readFileSync(
      resolve(process.cwd(), '../W02-identity/src/auth/better-auth.ts'),
      'utf8',
    )
    const emailDelivery = readFileSync(
      resolve(process.cwd(), '../W02-identity/src/auth/resend-email.ts'),
      'utf8',
    )
    const principal = readFileSync(
      resolve(process.cwd(), '../W02-identity/src/auth/principal.ts'),
      'utf8',
    )
    const w02Index = readFileSync(
      resolve(process.cwd(), '../W02-identity/src/index.ts'),
      'utf8',
    )

    // Borrow the plugin's initialize-once model while retaining W02-native D1.
    expect(authConfig).toContain('const authInstances = new WeakMap')
    expect(authConfig).toContain('authInstances.get(env.D1_01)')
    expect(authConfig).toContain('authInstances.set(env.D1_01, auth)')
    expect(principal).toContain('createLuckReadAuth(env)')
    expect(w02Index).toContain('resolveBetterAuthPrincipal(env, request)')
    expect(w02Index).toContain('createLuckReadAuth(env)')

    // Schema drift must be detected by Better Auth rather than hidden.
    expect(authConfig).toContain('validateSchema: true')
    expect(authConfig).not.toContain('validateSchema: false')
    expect(emailDelivery).toContain('AbortSignal.timeout(10_000)')
    expect(emailDelivery).toContain("diagnosticPrefix + '_ACCEPTED'")
    expect(emailDelivery).toContain("diagnosticPrefix + '_REJECTED'")
    expect(emailDelivery).toContain('providerMessageId')

    // Browser localhost origins are trusted only in local development.
    expect(authConfig).toContain(
      `...(env.CLOUDFLARE_ENV?.trim().toLowerCase() === 'development'
      ? ['http://127.0.0.1:8787', 'http://localhost:8787']
      : []),`,
    )
  })

  it('keeps registration email verification on the post-commit W01 path', () => {
    const registerForm = readFileSync(
      resolve(process.cwd(), 'src/app/(frontend)/register/RegisterForm.tsx'),
      'utf8',
    )
    const verificationRoute = readFileSync(
      resolve(process.cwd(), 'src/app/api/v1/auth/verification/send/route.ts'),
      'utf8',
    )
    expect(registerForm).toContain("'/api/v1/auth/verification/send'")
    expect(registerForm).toContain('await sendVerificationEmail(normalizedEmail)')
    expect(registerForm).toContain('发送/重试验证邮件')
    expect(verificationRoute).toContain("'/send-verification-email'")
    expect(verificationRoute).toContain("callbackURL: 'https://luckread.com/login?verified=1'")
    expect(verificationRoute).toContain("!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(identity.trim())")
    expect(verificationRoute).toContain('UPSTREAM_PRIVACY_NOOP_CODES')
    expect(verificationRoute).toContain('AUTH_EMAIL_VERIFICATION_UPSTREAM_REJECTION')
    expect(verificationRoute).toContain('readUpstreamDiagnosticCode')
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
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.proxyBetterAuth).toHaveBeenCalledWith(expect.any(Request), '/sign-out')
  })

  it('normalizes Better Auth HTTP 200 logout to no-content while preserving cookie clearing', async () => {
    mocks.proxyBetterAuth.mockResolvedValue(new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-length': '16',
        'set-cookie': 'better-auth.session_token=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
      },
    }))
    const response = await logout(request('https://luckread.test/api/v1/auth/logout'))
    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
