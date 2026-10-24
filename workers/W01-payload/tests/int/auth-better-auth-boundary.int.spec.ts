import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  proxyBetterAuth: vi.fn(),
  enforceAuthRateLimit: vi.fn(),
  authServiceFetch: vi.fn(),
}))

vi.mock('../../src/auth/w02-session-client.js', () => ({
  proxyBetterAuth: mocks.proxyBetterAuth,
}))

vi.mock('../../src/auth/traffic-limit.js', () => ({
  enforceAuthRateLimit: mocks.enforceAuthRateLimit,
  TrafficLimitError: class extends Error {},
  rateLimitResponse: vi.fn(),
}))

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: async () => ({
    env: { W02_AUTH: { fetch: mocks.authServiceFetch } },
  }),
}))

import { POST as authApi } from '../../src/app/api/auth/[...segments]/route.js'
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
  it('binds the app-owned login/session DTO to the canonical OpenAPI contract', () => {
    const openapi = readFileSync(
      resolve(process.cwd(), '../../contracts/openapi/v1/openapi.yaml'),
      'utf8',
    )
    const loginRoute = readFileSync(
      resolve(process.cwd(), 'src/app/auth/login/route.ts'),
      'utf8',
    )
    const sessionRoute = readFileSync(
      resolve(process.cwd(), 'src/app/auth/session/route.ts'),
      'utf8',
    )
    const legacyRefreshRoute = readFileSync(
      resolve(process.cwd(), 'src/app/auth/refresh/route.ts'),
      'utf8',
    )

    const loginContractStart = openapi.indexOf('  /auth/login:')
    const sessionContractStart = openapi.indexOf('  /auth/session:', loginContractStart)
    const logoutContractStart = openapi.indexOf('  /auth/logout:', sessionContractStart)
    const loginAndSessionContract = openapi.slice(loginContractStart, logoutContractStart)

    expect(loginContractStart).toBeGreaterThanOrEqual(0)
    expect(sessionContractStart).toBeGreaterThan(loginContractStart)
    expect(loginAndSessionContract).toContain('required: [identity, credential]')
    expect(loginAndSessionContract).not.toContain('required: [identity, credential, deviceId]')
    expect(loginAndSessionContract).toContain('X-LuckRead-Session-Token')
    expect(loginAndSessionContract).toContain('/auth/session')
    expect(loginAndSessionContract).not.toContain('accessToken:')
    expect(loginAndSessionContract).not.toContain('refreshToken:')
    expect(loginRoute).toContain("'X-LuckRead-Session-Token'")
    expect(loginRoute).toContain("headers.delete('set-auth-token')")
    expect(loginRoute).toContain('data: { user }')
    expect(sessionRoute).toContain("'/get-session'")
    expect(sessionRoute).toContain("errorResponse(401, 'UNAUTHENTICATED'")
    expect(legacyRefreshRoute).toContain('GET as POST')
    expect(legacyRefreshRoute).toContain('does not rotate')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enforceAuthRateLimit.mockResolvedValue(undefined)
  })


  it('checks privileged eligibility before allowing MFA enrollment or management', async () => {
    const eligibilityRequest = new Request('https://luckread-w02.internal/internal/auth/mfa/enrollment-eligibility', { method: 'POST' })
    mocks.authServiceFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.pathname === '/internal/auth/mfa/enrollment-eligibility') {
        return new Response(JSON.stringify({ eligible: false }), { status: 403 })
      }
      return new Response(JSON.stringify({ method: 'totp', totpURI: 'otpauth://secret', backupCodes: ['one'] }), { status: 200 })
    })
    const response = await authApi(request('https://luckread.test/api/auth/two-factor/enable', 'POST', {
      password: 'password',
      method: 'totp',
    }), { params: Promise.resolve({ segments: ['two-factor', 'enable'] }) })

    expect(response.status).toBe(403)
    expect((await response.json() as { error: { code: string } }).error.code).toBe('MFA_PRIVILEGED_ROLE_REQUIRED')
    expect(mocks.authServiceFetch).toHaveBeenCalledTimes(1)
    expect(mocks.authServiceFetch).toHaveBeenCalledWith(expect.objectContaining({
      url: eligibilityRequest.url,
    }))
  })

  it('strips Better Auth raw session tokens from successful MFA verification responses', async () => {
    mocks.authServiceFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input)
      const url = new URL(request.url)
      if (url.pathname === '/internal/auth/mfa/enrollment-eligibility') {
        return new Response(JSON.stringify({ eligible: true }), { status: 200 })
      }
      if (url.pathname === '/api/auth/two-factor/verify-totp') {
        return new Response(JSON.stringify({
          token: 'raw-session-token-must-not-escape',
          user: { id: 'u-l8', email: 'l8@example.com' },
        }), {
          status: 200,
          headers: {
            'set-auth-token': 'signed-session-token',
            'set-cookie': 'better-auth.session_token=signed-session-token; Path=/; HttpOnly; Secure; SameSite=Lax',
          },
        })
      }
      return new Response(null, { status: 404 })
    })
    const response = await authApi(request('https://luckread.test/api/auth/two-factor/verify-totp', 'POST', {
      code: '123456',
    }), { params: Promise.resolve({ segments: ['two-factor', 'verify-totp'] }) })
    const data = await response.json() as { data: { verified: boolean }; requestId: string }

    expect(response.status).toBe(200)
    expect(data.data.verified).toBe(true)
    expect(data.requestId).toBeTruthy()
    expect(JSON.stringify(data)).not.toContain('raw-session-token-must-not-escape')
    expect(JSON.stringify(data)).not.toContain('signed-session-token')
    expect(response.headers.get('x-luckread-session-token')).toBe('signed-session-token')
    expect(response.headers.get('set-auth-token')).toBeNull()
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    expect(response.headers.get('cache-control')).toBe('no-store')
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
    expect(authConfig).toContain("activateEmailVerifiedAccount(db, userId, now)")
    expect(authConfig).toContain("await ensureVerifiedUserRole(db, userId, now)")
    const activation = readFileSync(
      resolve(process.cwd(), '../W02-identity/src/account/account-state-transition.ts'),
      'utf8',
    )
    expect(activation).toContain("to: 'ACTIVE'")
    expect(activation).toContain("reason: 'email_verified'")
    expect(activation).toContain('additionalStatements')
    expect(activation).toContain("INSERT INTO role_assignments")
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


  it('returns a bounded MFA challenge from login without inventing a session credential', async () => {
    mocks.proxyBetterAuth.mockResolvedValue(new Response(JSON.stringify({
      twoFactorRedirect: true,
      twoFactorMethods: ['totp', 'backup-code'],
    }), {
      status: 200,
      headers: {
        'set-cookie': 'better-auth.two_factor=challenge; Path=/; HttpOnly; Secure; SameSite=Lax',
        'cache-control': 'no-store',
      },
    }))

    const response = await login(request('https://luckread.test/api/v1/auth/login', 'POST', {
      identity: 'l8@example.com',
      credential: 'correct-password',
    }))
    const data = await response.json() as {
      data: { twoFactorRequired: boolean; twoFactorMethods: string[] }
      requestId: string
    }

    expect(response.status).toBe(200)
    expect(data.data).toEqual({ twoFactorRequired: true, twoFactorMethods: ['totp', 'backup-code'] })
    expect(data.requestId).toBeTruthy()
    expect(JSON.stringify(data)).not.toContain('challenge')
    expect(response.headers.get('x-luckread-session-token')).toBeNull()
    expect(response.headers.get('set-auth-token')).toBeNull()
    expect(response.headers.get('set-cookie')).toContain('two_factor=challenge')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('accepts the Bearer plugin header as the canonical credential when JSON has no token field', async () => {
    const upstream = new Response(JSON.stringify({
      redirect: false,
      user: {
        id: 'u-header-only',
        email: 'user@example.com',
        name: null,
        emailVerified: true,
        image: null,
      },
    }), {
      status: 200,
      headers: {
        'set-cookie': 'better-auth.session_token=header-only-session; Path=/; HttpOnly; Secure; SameSite=Lax',
        'set-auth-token': 'header-only-session',
      },
    })
    mocks.proxyBetterAuth.mockResolvedValue(upstream)

    const response = await login(request('https://luckread.test/api/v1/auth/login', 'POST', {
      identity: 'user@example.com',
      credential: 'correct-password',
    }))
    const data = await response.json() as { data: { user: Record<string, unknown> }; requestId: string }

    expect(response.status).toBe(200)
    expect(data.data.user.id).toBe('u-header-only')
    expect(response.headers.get('x-luckread-session-token')).toBe('header-only-session')
    expect(JSON.stringify(data)).not.toContain('header-only-session')
    expect(response.headers.get('set-auth-token')).toBeNull()
  })

  it('uses the signed Bearer header even when the JSON token has a different representation', async () => {
    const upstream = new Response(JSON.stringify({
      redirect: false,
      // Better Auth 1.7.7 returns the raw session.token in the JSON body.
      token: 'raw-session-token',
      user: {
        id: 'u-signed-token',
        email: 'user@example.com',
        name: null,
        emailVerified: true,
        image: null,
      },
    }), {
      status: 200,
      headers: {
        'set-cookie': 'better-auth.session_token=signed-cookie-credential; Path=/; HttpOnly; Secure; SameSite=Lax',
        'set-auth-token': 'signed-cookie-credential',
      },
    })
    mocks.proxyBetterAuth.mockResolvedValue(upstream)

    const response = await login(request('https://luckread.test/api/v1/auth/login', 'POST', {
      identity: 'user@example.com',
      credential: 'correct-password',
    }))
    const data = await response.json() as { data: { user: Record<string, unknown> }; requestId: string }

    expect(response.status).toBe(200)
    expect(data.data.user.id).toBe('u-signed-token')
    expect(response.headers.get('x-luckread-session-token')).toBe('signed-cookie-credential')
    expect(response.headers.get('set-cookie')).toContain('better-auth.session_token=signed-cookie-credential')
    expect(JSON.stringify(data)).not.toContain('raw-session-token')
    expect(JSON.stringify(data)).not.toContain('signed-cookie-credential')
  })

  it('rejects legacy or unknown login fields rather than silently ignoring them', async () => {
    const response = await login(request('https://luckread.test/api/v1/auth/login', 'POST', {
      identity: 'user@example.com',
      credential: 'correct-password',
      deviceId: 'legacy-device-field',
    }))
    const data = await response.json() as { error: { code: string }; requestId: string }

    expect(response.status).toBe(400)
    expect(data.error.code).toBe('VALIDATION_FAILED')
    expect(data.requestId).toBeTruthy()
    expect(mocks.proxyBetterAuth).not.toHaveBeenCalled()
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
