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
import { GET as session } from '../../src/app/auth/session/route.js'
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

  it('normalizes successful login to the public session DTO and preserves cookie/Bearer carriers', async () => {
    const upstream = new Response(JSON.stringify({
      redirect: false,
      token: 'opaque-session-token',
      user: {
        id: 'u1',
        email: 'user@example.com',
        name: 'Example User',
        emailVerified: true,
        image: null,
      },
    }), {
      status: 200,
      headers: {
        'set-cookie': 'better-auth.session_token=opaque-session-token; Path=/; HttpOnly; Secure; SameSite=Lax',
        'set-auth-token': 'opaque-session-token',
        'cache-control': 'no-store',
      },
    })
    mocks.proxyBetterAuth.mockResolvedValue(upstream)

    const response = await login(request('https://luckread.test/api/v1/auth/login', 'POST', {
      identity: 'USER@EXAMPLE.COM',
      credential: 'correct-password',
    }))
    const data = await response.json() as {
      data: { user: Record<string, unknown> }
      requestId: string
    }

    expect(response.status).toBe(200)
    expect(data.data.user).toEqual({
      id: 'u1',
      email: 'user@example.com',
      name: 'Example User',
      emailVerified: true,
      image: null,
    })
    expect(data.requestId).toBeTruthy()
    expect(JSON.stringify(data)).not.toContain('opaque-session-token')
    expect(response.headers.get('x-luckread-session-token')).toBe('opaque-session-token')
    expect(response.headers.get('set-auth-token')).toBeNull()
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.proxyBetterAuth).toHaveBeenCalledWith(
      expect.any(Request),
      '/sign-in/email',
      expect.objectContaining({
        body: { email: 'user@example.com', password: 'correct-password', rememberMe: true },
      }),
    )
  })

  it('normalizes unverified-account login failure to the public error envelope', async () => {
    mocks.proxyBetterAuth.mockResolvedValue(new Response(JSON.stringify({
      code: 'EMAIL_NOT_VERIFIED',
      message: 'Email not verified',
    }), { status: 403 }))

    const response = await login(request('https://luckread.test/api/v1/auth/login', 'POST', {
      identity: 'user@example.com',
      credential: 'correct-password',
    }))
    const data = await response.json() as { error: { code: string }; requestId: string }

    expect(response.status).toBe(403)
    expect(data.error.code).toBe('EMAIL_NOT_VERIFIED')
    expect(data.requestId).toBeTruthy()
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-luckread-session-token')).toBeNull()
  })

  it('exposes current session through one stable public DTO and keeps refreshed credentials out of JSON', async () => {
    mocks.proxyBetterAuth.mockResolvedValue(new Response(JSON.stringify({
      session: { id: 's1', expiresAt: '2026-10-18T12:00:00.000Z', token: 'must-not-escape' },
      user: {
        id: 'u1',
        email: 'user@example.com',
        name: 'Example User',
        emailVerified: true,
        image: null,
      },
    }), {
      status: 200,
      headers: {
        'set-auth-token': 'opaque-session-token',
        'set-cookie': 'better-auth.session_token=opaque-session-token; Path=/; HttpOnly; Secure; SameSite=Lax',
      },
    }))

    const response = await session(request('https://luckread.test/api/v1/auth/session', 'GET'))
    const data = await response.json() as {
      data: { session: Record<string, unknown>; user: Record<string, unknown> }
      requestId: string
    }

    expect(response.status).toBe(200)
    expect(data.data.session).toEqual({
      id: 's1',
      expiresAt: '2026-10-18T12:00:00.000Z',
    })
    expect(data.data.user.id).toBe('u1')
    expect(JSON.stringify(data)).not.toContain('must-not-escape')
    expect(response.headers.get('x-luckread-session-token')).toBe('opaque-session-token')
    expect(response.headers.get('set-auth-token')).toBeNull()
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.proxyBetterAuth).toHaveBeenCalledWith(
      expect.any(Request),
      '/get-session',
      { method: 'GET' },
    )
  })

  it('returns 401 rather than a false successful session snapshot when Better Auth returns null', async () => {
    mocks.proxyBetterAuth.mockResolvedValue(new Response('null', {
      status: 200,
      headers: { 'cache-control': 'no-store' },
    }))

    const response = await session(request('https://luckread.test/api/v1/auth/session', 'GET'))
    const data = await response.json() as { error: { code: string }; requestId: string }

    expect(response.status).toBe(401)
    expect(data.error.code).toBe('UNAUTHENTICATED')
    expect(data.requestId).toBeTruthy()
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('keeps the legacy refresh path as a deprecated alias for the canonical session response', async () => {
    mocks.proxyBetterAuth.mockResolvedValue(new Response(JSON.stringify({
      user: { id: 'u1', email: 'user@example.com', name: null, emailVerified: true, image: null },
      session: { id: 's1', expiresAt: '2026-10-18T12:00:00.000Z' },
    }), { status: 200 }))
    const response = await refresh(request('https://luckread.test/api/v1/auth/refresh', 'POST', {}))
    const data = await response.json() as { data: { session: { id: string } } }
    expect(response.status).toBe(200)
    expect(data.data.session.id).toBe('s1')
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
