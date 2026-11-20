import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  handler: vi.fn(),
}))

vi.mock('./better-auth.js', () => ({
  createLuckReadAuth: () => ({
    api: { getSession: mocks.getSession },
    handler: mocks.handler,
    $context: Promise.resolve({
      authCookies: { sessionToken: { name: 'better-auth.session_token' } },
      options: { advanced: {} },
      isTrustedOrigin: (origin: string) => origin === 'https://luckread.com' || origin === 'https://luckread-w02.internal',
    }),
  }),
}))

import { createLuckReadAuth, type BetterAuthEnv } from './better-auth.js'
import type {
  SessionLogoutStore,
  SessionLogoutStoreInput,
  SessionLogoutStoreResult,
} from './session-logout-store.js'
import { handleCurrentUserSessionLogout } from './session-logout.js'

const makeRequest = () => new Request(
  'https://luckread-w02.internal/internal/auth/session/logout',
  {
    method: 'POST',
    headers: {
      cookie: 'better-auth.session_token=browser-credential; better-auth.session_data.0=session-cache-chunk',
      authorization: 'Bearer native-credential',
      origin: 'https://luckread.com',
      'X-LuckRead-Request-Id': 'req_session_logout_test',
      'X-LuckRead-Correlation-Id': 'trace-session-logout-test',
    },
  },
)

const makeEnv = () => {
  const keys: string[] = []
  const limiter = {
    limit: vi.fn(async ({ key }: { key: string }) => {
      keys.push(key)
      return { success: true }
    }),
  }
  const env = {
    AUTH_SESSION_WRITE_LIMITER: limiter,
  } as unknown as BetterAuthEnv
  return { env, limiter, keys }
}

const makeStore = (
  result: SessionLogoutStoreResult = { status: 'REVOKED' },
): SessionLogoutStore => ({
  logout: vi.fn(async (_input: SessionLogoutStoreInput) => result),
})

describe('W02 authenticated current-session logout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'current-session' },
    })
    mocks.handler.mockResolvedValue(new Response(null, {
      status: 200,
      headers: {
        'set-cookie': 'better-auth.session_token=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
        'cache-control': 'no-store',
      },
    }))
  })

  it('derives the cookie-or-bearer session, commits the Store before clearing cookies', async () => {
    const { env, keys } = makeEnv()
    const store = makeStore()
    const response = await handleCurrentUserSessionLogout(env, makeRequest(), { store })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(mocks.getSession).toHaveBeenCalledWith(expect.objectContaining({
      query: { disableCookieCache: true, disableRefresh: true },
    }))
    const authInput = mocks.getSession.mock.calls[0]?.[0]
    expect((authInput?.headers as Headers).get('authorization')).toBe('Bearer native-credential')
    expect((authInput?.headers as Headers).get('cookie')).toContain('browser-credential')

    expect(keys).toEqual([
      'auth010:session-logout:account:user-1',
      'auth010:session-logout:session:current-session',
      'auth010:session-logout:endpoint',
    ])
    expect(store.logout).toHaveBeenCalledTimes(1)
    const input = vi.mocked(store.logout).mock.calls[0]?.[0]
    expect(input).toMatchObject({
      userId: 'user-1',
      sessionId: 'current-session',
      correlationId: 'req_session_logout_test',
      causationId: 'trace-session-logout-test',
    })
    expect(typeof input?.now).toBe('string')
    expect(Number.isFinite(Date.parse(input?.now ?? ''))).toBe(true)
    expect(vi.mocked(store.logout).mock.invocationCallOrder[0])
      .toBeLessThan(mocks.handler.mock.invocationCallOrder[0]!)

    const cleanupRequest = mocks.handler.mock.calls[0]?.[0] as Request
    expect(new URL(cleanupRequest.url).pathname).toBe('/api/auth/sign-out')
    const cleanupCookies = cleanupRequest.headers.get('cookie') ?? ''
    expect(cleanupCookies).not.toContain('better-auth.session_token=')
    expect(cleanupCookies).toContain('better-auth.session_data.0=session-cache-chunk')
    expect(cleanupRequest.headers.has('authorization')).toBe(false)
    expect(cleanupRequest.headers.has('x-luckread-session-token')).toBe(false)
  })

  it('uses the explicitly injected Neon-compatible Store and session lookup', async () => {
    const { env } = makeEnv()
    const store = makeStore()
    const getSession = vi.fn().mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'current-session' },
    })
    const auth = createLuckReadAuth(env)

    const response = await handleCurrentUserSessionLogout(env, makeRequest(), {
      auth,
      getSession,
      store,
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(getSession).toHaveBeenCalledTimes(1)
    expect(store.logout).toHaveBeenCalledTimes(1)
    expect(mocks.handler).toHaveBeenCalledTimes(1)
  })

  it('clears stale cookies without writing an audit event when no session remains', async () => {
    mocks.getSession.mockResolvedValueOnce(null)
    const { env, limiter } = makeEnv()
    const store = makeStore()
    const response = await handleCurrentUserSessionLogout(env, makeRequest(), { store })

    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(limiter.limit).not.toHaveBeenCalled()
    expect(store.logout).not.toHaveBeenCalled()
    expect(mocks.handler).toHaveBeenCalledTimes(1)
  })

  it('fails closed when any logout rate-limit scope is exhausted', async () => {
    const { env, limiter } = makeEnv()
    limiter.limit
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false })
    const store = makeStore()
    const response = await handleCurrentUserSessionLogout(env, makeRequest(), { store })
    const payload = await response.json() as { error?: { code?: string } }

    expect(response.status).toBe(429)
    expect(payload.error?.code).toBe('RATE_LIMITED')
    expect(store.logout).not.toHaveBeenCalled()
    expect(mocks.handler).not.toHaveBeenCalled()
  })

  it('returns 503 and does not clear credentials when the PostgreSQL Store fails', async () => {
    const { env } = makeEnv()
    const store = makeStore()
    vi.mocked(store.logout).mockRejectedValueOnce(new Error('PostgreSQL unavailable'))
    const response = await handleCurrentUserSessionLogout(env, makeRequest(), { store })
    const payload = await response.json() as { error?: { code?: string } }

    expect(response.status).toBe(503)
    expect(payload.error?.code).toBe('SERVICE_UNAVAILABLE')
    expect(store.logout).toHaveBeenCalledTimes(1)
    expect(mocks.handler).not.toHaveBeenCalled()
  })

  it('treats a concurrently revoked session as an idempotent no-op', async () => {
    const { env } = makeEnv()
    const store = makeStore({ status: 'NOT_FOUND_OR_NOT_OWNED' })
    const response = await handleCurrentUserSessionLogout(env, makeRequest(), { store })

    expect(response.status).toBe(200)
    expect(store.logout).toHaveBeenCalledTimes(1)
    expect(mocks.handler).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the authenticated session identity is incomplete', async () => {
    mocks.getSession.mockResolvedValueOnce({ user: { id: 'user-1' }, session: {} })
    const { env } = makeEnv()
    const store = makeStore()
    const response = await handleCurrentUserSessionLogout(env, makeRequest(), { store })

    expect(response.status).toBe(503)
    expect(store.logout).not.toHaveBeenCalled()
    expect(mocks.handler).not.toHaveBeenCalled()
  })

  it('rejects missing and untrusted cookie origins before rate limiting or Store writes', async () => {
    const { env, limiter } = makeEnv()
    const store = makeStore()
    const original = makeRequest()
    const untrusted = new Request(original, {
      headers: {
        cookie: 'better-auth.session_token=browser-credential',
        origin: 'https://attacker.example',
      },
    })
    const missing = new Request(original, {
      headers: { cookie: 'better-auth.session_token=browser-credential' },
    })

    for (const request of [untrusted, missing]) {
      const response = await handleCurrentUserSessionLogout(env, request, { store })
      const payload = await response.json() as { error?: { code?: string } }
      expect(response.status).toBe(403)
      expect(payload.error?.code).toBe('FORBIDDEN')
    }

    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(limiter.limit).not.toHaveBeenCalled()
    expect(store.logout).not.toHaveBeenCalled()
    expect(mocks.handler).not.toHaveBeenCalled()
  })

  it('allows a valid Bearer-only native logout without a browser Origin', async () => {
    const original = makeRequest()
    const headers = new Headers(original.headers)
    headers.delete('cookie')
    headers.delete('origin')
    const request = new Request(original.url, { method: 'POST', headers })
    const { env } = makeEnv()
    const store = makeStore()

    const response = await handleCurrentUserSessionLogout(env, request, { store })

    expect(response.status).toBe(200)
    expect(store.logout).toHaveBeenCalledTimes(1)
    expect(mocks.handler).toHaveBeenCalledTimes(1)
  })

  it('preserves trusted same-origin null-Origin inference but rejects cross-site metadata', async () => {
    const original = makeRequest()
    const trustedHeaders = new Headers(original.headers)
    trustedHeaders.set('origin', 'null')
    trustedHeaders.set('sec-fetch-site', 'same-origin')
    const trustedRequest = new Request(original.url, { method: 'POST', headers: trustedHeaders })
    const { env: trustedEnv } = makeEnv()
    const trustedStore = makeStore()

    const trustedResponse = await handleCurrentUserSessionLogout(trustedEnv, trustedRequest, {
      store: trustedStore,
    })
    expect(trustedResponse.status).toBe(200)
    expect(trustedStore.logout).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'current-session' },
    })
    mocks.handler.mockResolvedValue(new Response(null, { status: 200 }))
    const crossSiteHeaders = new Headers(original.headers)
    crossSiteHeaders.set('origin', 'null')
    crossSiteHeaders.set('sec-fetch-site', 'cross-site')
    const crossSiteRequest = new Request(original.url, { method: 'POST', headers: crossSiteHeaders })
    const { env: blockedEnv, limiter } = makeEnv()
    const blockedStore = makeStore()

    const blockedResponse = await handleCurrentUserSessionLogout(blockedEnv, crossSiteRequest, {
      store: blockedStore,
    })
    expect(blockedResponse.status).toBe(403)
    expect(blockedStore.logout).not.toHaveBeenCalled()
    expect(limiter.limit).not.toHaveBeenCalled()
    expect(mocks.handler).not.toHaveBeenCalled()
  })
})
