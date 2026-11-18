import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getW02PostgresRuntime: vi.fn(),
  defaultStore: { revoke: vi.fn() },
}))

vi.mock('./better-auth.js', () => ({
  createLuckReadAuth: () => ({ api: { getSession: mocks.getSession } }),
}))

vi.mock('../neon/runtime.js', () => ({
  getW02PostgresRuntime: mocks.getW02PostgresRuntime,
}))

import type { BetterAuthEnv } from './better-auth.js'
import { handleCurrentUserSessionRevoke } from './session-revoke.js'
import type { SessionRevocationStore } from './session-revoke-store.js'

const request = (sessionId: unknown) => new Request(
  'https://luckread-w02.internal/internal/auth/session/revoke-by-id',
  {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: 'better-auth.session_token=test',
      'X-LuckRead-Correlation-Id': 'trace-session-revoke-test',
      'X-LuckRead-Request-Id': 'req_session_revoke_test',
    },
    body: JSON.stringify({ sessionId }),
  },
)

const makeEnv = () => ({
  W02_DATABASE_DRIVER: 'neon',
  HYPERDRIVE: { connectionString: 'postgresql://user:password@localhost:5432/luckread' },
  AUTH_SESSION_WRITE_LIMITER: {
    limit: vi.fn().mockResolvedValue({ success: true }),
  },
}) as BetterAuthEnv

describe('W02 policy-scoped session revoke', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'current-session' },
    })
    mocks.defaultStore.revoke.mockResolvedValue({ status: 'REVOKED' })
    mocks.getW02PostgresRuntime.mockReturnValue({
      sessionRevocationStore: mocks.defaultStore,
    })
  })

  it('uses the Neon runtime Store after authentication, rate limits and current-session protection', async () => {
    const env = makeEnv()
    const response = await handleCurrentUserSessionRevoke(env, request('target-session'))
    const payload = await response.json() as { revoked?: boolean }

    expect(response.status).toBe(200)
    expect(payload.revoked).toBe(true)
    expect(env.AUTH_SESSION_WRITE_LIMITER?.limit).toHaveBeenNthCalledWith(1, {
      key: 'auth010:session-revoke:account:user-1',
    })
    expect(env.AUTH_SESSION_WRITE_LIMITER?.limit).toHaveBeenNthCalledWith(2, {
      key: 'auth010:session-revoke:session:current-session',
    })
    expect(env.AUTH_SESSION_WRITE_LIMITER?.limit).toHaveBeenNthCalledWith(3, {
      key: 'auth010:session-revoke:endpoint',
    })
    expect(mocks.getW02PostgresRuntime).toHaveBeenCalledWith(env)
    expect(mocks.defaultStore.revoke).toHaveBeenCalledWith({
      userId: 'user-1',
      sessionId: 'target-session',
      now: expect.any(String),
      correlationId: 'req_session_revoke_test',
      causationId: 'trace-session-revoke-test',
    })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('denies revoke when the effective base-user permission is not present', async () => {
    mocks.defaultStore.revoke.mockResolvedValueOnce({ status: 'PERMISSION_DENIED' })
    const response = await handleCurrentUserSessionRevoke(makeEnv(), request('target-session'))
    const payload = await response.json() as { error?: { code?: string } }

    expect(response.status).toBe(403)
    expect(payload.error?.code).toBe('PERMISSION_DENIED')
    expect(mocks.defaultStore.revoke).toHaveBeenCalledTimes(1)
  })

  it('keeps cross-account and missing sessions indistinguishable', async () => {
    mocks.defaultStore.revoke.mockResolvedValueOnce({ status: 'NOT_FOUND_OR_NOT_OWNED' })
    const response = await handleCurrentUserSessionRevoke(makeEnv(), request('target-session'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ revoked: true })
  })

  it('returns 429 before resolving the Store when a required rate-limit scope is exhausted', async () => {
    const env = makeEnv()
    vi.mocked(env.AUTH_SESSION_WRITE_LIMITER.limit)
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false })
    const response = await handleCurrentUserSessionRevoke(env, request('target-session'))
    const payload = await response.json() as { error?: { code?: string } }

    expect(response.status).toBe(429)
    expect(payload.error?.code).toBe('RATE_LIMITED')
    expect(env.AUTH_SESSION_WRITE_LIMITER.limit).toHaveBeenCalledTimes(2)
    expect(mocks.defaultStore.revoke).not.toHaveBeenCalled()
    expect(mocks.getW02PostgresRuntime).not.toHaveBeenCalled()
  })

  it('fails closed when the W02 rate-limit binding is unavailable', async () => {
    const env = makeEnv()
    delete env.AUTH_SESSION_WRITE_LIMITER
    const response = await handleCurrentUserSessionRevoke(env, request('target-session'))

    expect(response.status).toBe(503)
    expect(mocks.defaultStore.revoke).not.toHaveBeenCalled()
    expect(mocks.getW02PostgresRuntime).not.toHaveBeenCalled()
  })

  it('does not resolve the Store or consume rate limits when the current user has no valid session', async () => {
    mocks.getSession.mockResolvedValueOnce(null)
    const env = makeEnv()
    const response = await handleCurrentUserSessionRevoke(env, request('target-session'))

    expect(response.status).toBe(401)
    expect(env.AUTH_SESSION_WRITE_LIMITER?.limit).not.toHaveBeenCalled()
    expect(mocks.defaultStore.revoke).not.toHaveBeenCalled()
    expect(mocks.getW02PostgresRuntime).not.toHaveBeenCalled()
  })

  it('protects the authenticated current session before resolving the target Store', async () => {
    const env = makeEnv()
    const response = await handleCurrentUserSessionRevoke(env, request('current-session'))
    const payload = await response.json() as { error?: { code?: string } }

    expect(response.status).toBe(409)
    expect(payload.error?.code).toBe('CURRENT_SESSION_PROTECTED')
    expect(env.AUTH_SESSION_WRITE_LIMITER?.limit).toHaveBeenCalledTimes(3)
    expect(mocks.defaultStore.revoke).not.toHaveBeenCalled()
    expect(mocks.getW02PostgresRuntime).not.toHaveBeenCalled()
  })

  it('rejects invalid request bodies before authentication or Store resolution', async () => {
    const env = makeEnv()
    const response = await handleCurrentUserSessionRevoke(env, request(null))

    expect(response.status).toBe(400)
    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(env.AUTH_SESSION_WRITE_LIMITER?.limit).not.toHaveBeenCalled()
    expect(mocks.defaultStore.revoke).not.toHaveBeenCalled()
    expect(mocks.getW02PostgresRuntime).not.toHaveBeenCalled()
  })

  it('accepts an injected PostgreSQL-compatible Store and authenticated session resolver', async () => {
    const env = makeEnv()
    const store: SessionRevocationStore = {
      revoke: vi.fn().mockResolvedValue({ status: 'REVOKED' }),
    }
    const getSession = vi.fn().mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'current-session' },
    })

    const response = await handleCurrentUserSessionRevoke(
      env,
      request('target-session'),
      { store, getSession },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ revoked: true })
    expect(getSession).toHaveBeenCalledTimes(1)
    expect(store.revoke).toHaveBeenCalledWith({
      userId: 'user-1',
      sessionId: 'target-session',
      now: expect.any(String),
      correlationId: 'req_session_revoke_test',
      causationId: 'trace-session-revoke-test',
    })
    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(mocks.getW02PostgresRuntime).not.toHaveBeenCalled()
  })

  it('returns 503 without leaking persistence details when the Store transaction fails', async () => {
    mocks.defaultStore.revoke.mockRejectedValueOnce(new Error('PostgreSQL unavailable'))
    const response = await handleCurrentUserSessionRevoke(makeEnv(), request('target-session'))
    const payload = await response.json() as { error?: { code?: string; message?: string } }

    expect(response.status).toBe(503)
    expect(payload.error?.code).toBe('SERVICE_UNAVAILABLE')
    expect(payload.error?.message).toBe('Session service unavailable')
  })
})
