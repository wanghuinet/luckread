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

import type { BetterAuthEnv } from './better-auth.js'
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

const makeEnv = (batchResults: unknown[] = [
  { success: true, meta: { changes: 1 } },
  { success: true, meta: { changes: 1 } },
]) => {
  const prepared: Array<{ sql: string; bind: ReturnType<typeof vi.fn> }> = []
  const prepare = vi.fn((sql: string) => {
    const statement = { sql, bind: vi.fn().mockReturnThis() }
    prepared.push(statement)
    return statement
  })
  const batch = vi.fn().mockResolvedValue(batchResults)
  const keys: string[] = []
  const limiter = {
    limit: vi.fn(async ({ key }: { key: string }) => {
      keys.push(key)
      return { success: true }
    }),
  }
  const env = {
    D1_01: { prepare, batch } as unknown as D1Database,
    AUTH_SESSION_WRITE_LIMITER: limiter,
  } as BetterAuthEnv
  return { env, prepare, prepared, batch, limiter, keys }
}

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

  it('derives the cookie-or-bearer session, atomically revokes it, and expires Better Auth cookies', async () => {
    const db = makeEnv()
    const response = await handleCurrentUserSessionLogout(db.env, makeRequest())

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(mocks.getSession).toHaveBeenCalledWith(expect.objectContaining({
      query: { disableCookieCache: true, disableRefresh: true },
    }))
    const authInput = mocks.getSession.mock.calls[0]?.[0]
    expect((authInput?.headers as Headers).get('authorization')).toBe('Bearer native-credential')
    expect((authInput?.headers as Headers).get('cookie')).toContain('browser-credential')

    expect(db.keys).toEqual([
      'auth010:session-logout:account:user-1',
      'auth010:session-logout:session:current-session',
      'auth010:session-logout:endpoint',
    ])
    expect(db.prepared).toHaveLength(2)
    expect(db.prepared[0]?.sql).toContain('DELETE FROM "session"')
    expect(db.prepared[0]?.sql).not.toContain('role_assignments')
    expect(db.prepared[0]?.bind).toHaveBeenCalledWith('current-session', 'user-1')
    expect(db.prepared[1]?.sql).toContain('INSERT INTO auth_010_session_revocation_journal')
    expect(db.prepared[1]?.sql).toContain('WHERE changes() = 1')
    const eventJson = db.prepared[1]?.bind.mock.calls[0]?.[7] as string
    expect(JSON.parse(eventJson)).toMatchObject({
      eventType: 'user.session.revoked',
      resourceId: 'current-session',
      actor: { actorId: 'user-1', actorType: 'user' },
      payload: { operationId: 'authLogout', result: 'succeeded', reasonCode: 'USER_LOGOUT' },
    })
    expect(db.batch.mock.invocationCallOrder[0]).toBeLessThan(mocks.handler.mock.invocationCallOrder[0]!)
    const cleanupRequest = mocks.handler.mock.calls[0]?.[0] as Request
    expect(new URL(cleanupRequest.url).pathname).toBe('/api/auth/sign-out')
    const cleanupCookies = cleanupRequest.headers.get('cookie') ?? ''
    expect(cleanupCookies).not.toContain('better-auth.session_token=')
    expect(cleanupCookies).toContain('better-auth.session_data.0=session-cache-chunk')
    expect(cleanupRequest.headers.has('authorization')).toBe(false)
    expect(cleanupRequest.headers.has('x-luckread-session-token')).toBe(false)
  })

  it('clears stale cookies without writing an audit event when no session remains', async () => {
    mocks.getSession.mockResolvedValueOnce(null)
    const db = makeEnv()
    const response = await handleCurrentUserSessionLogout(db.env, makeRequest())

    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(db.limiter.limit).not.toHaveBeenCalled()
    expect(db.prepare).not.toHaveBeenCalled()
    expect(db.batch).not.toHaveBeenCalled()
    expect(mocks.handler).toHaveBeenCalledTimes(1)
  })

  it('fails closed when any logout rate-limit scope is exhausted', async () => {
    const db = makeEnv()
    db.limiter.limit
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false })
    const response = await handleCurrentUserSessionLogout(db.env, makeRequest())
    const payload = await response.json() as { error?: { code?: string } }

    expect(response.status).toBe(429)
    expect(payload.error?.code).toBe('RATE_LIMITED')
    expect(db.prepare).not.toHaveBeenCalled()
    expect(db.batch).not.toHaveBeenCalled()
    expect(mocks.handler).not.toHaveBeenCalled()
  })

  it('returns 503 and does not clear credentials when the atomic audit batch fails', async () => {
    const db = makeEnv()
    db.batch.mockRejectedValueOnce(new Error('D1 unavailable'))
    const response = await handleCurrentUserSessionLogout(db.env, makeRequest())
    const payload = await response.json() as { error?: { code?: string } }

    expect(response.status).toBe(503)
    expect(payload.error?.code).toBe('SERVICE_UNAVAILABLE')
    expect(mocks.handler).not.toHaveBeenCalled()
  })

  it('treats a concurrent already-revoked session as a no-op without adding another audit event', async () => {
    const db = makeEnv([
      { success: true, meta: { changes: 0 } },
      { success: true, meta: { changes: 0 } },
    ])
    const response = await handleCurrentUserSessionLogout(db.env, makeRequest())

    expect(response.status).toBe(200)
    expect(mocks.handler).toHaveBeenCalledTimes(1)
    expect(db.batch).toHaveBeenCalledTimes(1)
    const eventJson = db.prepared[1]?.bind.mock.calls[0]?.[7] as string
    expect(JSON.parse(eventJson).payload.reasonCode).toBe('USER_LOGOUT')
  })

  it('fails closed when DELETE and outbox results are not a matched pair', async () => {
    const db = makeEnv([
      { success: true, meta: { changes: 1 } },
      { success: true, meta: { changes: 0 } },
    ])
    const response = await handleCurrentUserSessionLogout(db.env, makeRequest())

    expect(response.status).toBe(503)
    expect(mocks.handler).not.toHaveBeenCalled()
  })

  it('fails closed when the authenticated session identity is incomplete', async () => {
    mocks.getSession.mockResolvedValueOnce({ user: { id: 'user-1' }, session: {} })
    const db = makeEnv()
    const response = await handleCurrentUserSessionLogout(db.env, makeRequest())

    expect(response.status).toBe(503)
    expect(db.batch).not.toHaveBeenCalled()
    expect(mocks.handler).not.toHaveBeenCalled()
  })
  it('rejects missing and untrusted cookie origins before rate limiting or D1 mutation', async () => {
    const db = makeEnv()
    const untrusted = new Request(makeRequest(), {
      headers: {
        cookie: 'better-auth.session_token=browser-credential',
        origin: 'https://attacker.example',
      },
    })
    const missing = new Request(makeRequest(), {
      headers: { cookie: 'better-auth.session_token=browser-credential' },
    })

    for (const request of [untrusted, missing]) {
      const response = await handleCurrentUserSessionLogout(db.env, request)
      const payload = await response.json() as { error?: { code?: string } }
      expect(response.status).toBe(403)
      expect(payload.error?.code).toBe('FORBIDDEN')
    }

    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(db.limiter.limit).not.toHaveBeenCalled()
    expect(db.prepare).not.toHaveBeenCalled()
    expect(db.batch).not.toHaveBeenCalled()
    expect(mocks.handler).not.toHaveBeenCalled()
  })

  it('allows a valid Bearer-only native logout without requiring a browser Origin', async () => {
    const original = makeRequest()
    const headers = new Headers(original.headers)
    headers.delete('cookie')
    headers.delete('origin')
    const request = new Request(original.url, { method: 'POST', headers })
    const db = makeEnv()

    const response = await handleCurrentUserSessionLogout(db.env, request)

    expect(response.status).toBe(200)
    expect(db.batch).toHaveBeenCalledTimes(1)
    expect(mocks.handler).toHaveBeenCalledTimes(1)
  })

  it('preserves Better Auth same-origin null-Origin inference but rejects cross-site metadata', async () => {
    const original = makeRequest()
    const trustedHeaders = new Headers(original.headers)
    trustedHeaders.set('origin', 'null')
    trustedHeaders.set('sec-fetch-site', 'same-origin')
    const trustedRequest = new Request(original.url, { method: 'POST', headers: trustedHeaders })
    const db = makeEnv()

    const trustedResponse = await handleCurrentUserSessionLogout(db.env, trustedRequest)
    expect(trustedResponse.status).toBe(200)
    expect(db.batch).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    const crossSiteHeaders = new Headers(original.headers)
    crossSiteHeaders.set('origin', 'null')
    crossSiteHeaders.set('sec-fetch-site', 'cross-site')
    const crossSiteRequest = new Request(original.url, { method: 'POST', headers: crossSiteHeaders })
    const blockedDb = makeEnv()

    const blockedResponse = await handleCurrentUserSessionLogout(blockedDb.env, crossSiteRequest)
    expect(blockedResponse.status).toBe(403)
    expect(blockedDb.batch).not.toHaveBeenCalled()
    expect(mocks.handler).not.toHaveBeenCalled()
  })

})
