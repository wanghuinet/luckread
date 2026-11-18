import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getW02PostgresRuntime: vi.fn(),
  defaultStore: { list: vi.fn() },
}))

vi.mock('./better-auth.js', () => ({
  createLuckReadAuth: () => ({ api: { getSession: mocks.getSession } }),
}))

vi.mock('../neon/runtime.js', () => ({
  getW02PostgresRuntime: mocks.getW02PostgresRuntime,
}))

import type { BetterAuthEnv } from './better-auth.js'
import { handleCurrentUserSessionList } from './session-list.js'

const request = (body: unknown) => new Request('https://luckread-w02.internal/internal/auth/session/list', {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie: 'better-auth.session_token=test' },
  body: JSON.stringify(body),
})

const makeEnv = (): BetterAuthEnv => ({
  W02_DATABASE_DRIVER: 'neon',
  HYPERDRIVE: { connectionString: 'postgresql://user:password@localhost:5432/luckread' },
  AUTH_SESSION_READ_LIMITER: {
    limit: vi.fn().mockResolvedValue({ success: true }),
  },
})

const encodeCursor = (value: { createdAt: string; sessionId: string }) =>
  's1.' + btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')

const decodeCursor = (value: string) => {
  const encoded = value.slice(3).replace(/-/g, '+').replace(/_/g, '/')
  return JSON.parse(atob(encoded + '='.repeat((4 - encoded.length % 4) % 4))) as {
    createdAt: string
    sessionId: string
  }
}

const row = (sessionId: string, createdAt: string) => ({
  sessionId,
  createdAt,
  expiresAt: '2026-12-01T00:00:00.000Z',
})

describe('W02 bounded session list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-2' },
    })
    mocks.defaultStore.list.mockResolvedValue({ permissionGranted: true, rows: [] })
    mocks.getW02PostgresRuntime.mockReturnValue({ sessionListStore: mocks.defaultStore })
  })

  it('uses the Neon runtime Store, authenticated subject and bounded look-ahead page', async () => {
    mocks.defaultStore.list.mockResolvedValue({
      permissionGranted: true,
      rows: [
        row('session-3', '2026-10-03T00:00:00.000Z'),
        row('session-2', '2026-10-02T00:00:00.000Z'),
        row('session-1', '2026-10-01T00:00:00.000Z'),
      ],
    })
    const env = makeEnv()

    const response = await handleCurrentUserSessionList(env, request({ limit: 2 }))
    const payload = await response.json() as {
      items: Array<Record<string, unknown>>
      currentSessionId: string
      nextCursor: string | null
    }

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(payload.items.map((item) => item.sessionId)).toEqual(['session-3', 'session-2'])
    expect(payload.currentSessionId).toBe('session-2')
    expect(payload.items.every((item) => !('token' in item) && !('userId' in item))).toBe(true)
    expect(payload.items[0]?.lastSeenAt).toBeNull()
    expect(payload.nextCursor?.startsWith('s1.')).toBe(true)
    expect(decodeCursor(payload.nextCursor as string)).toEqual({
      createdAt: '2026-10-02T00:00:00.000Z',
      sessionId: 'session-2',
    })
    expect(mocks.getW02PostgresRuntime).toHaveBeenCalledWith(env)
    expect(mocks.defaultStore.list).toHaveBeenCalledWith({
      userId: 'user-1',
      now: expect.any(String),
      limit: 3,
      cursor: null,
    })
    expect(env.AUTH_SESSION_READ_LIMITER?.limit).toHaveBeenNthCalledWith(1, {
      key: 'auth010:session-list:account:user-1',
    })
    expect(env.AUTH_SESSION_READ_LIMITER?.limit).toHaveBeenNthCalledWith(2, {
      key: 'auth010:session-list:endpoint',
    })
  })

  it('passes the decoded keyset cursor to the PostgreSQL Store', async () => {
    mocks.defaultStore.list.mockResolvedValue({
      permissionGranted: true,
      rows: [row('session-1', '2026-10-01T00:00:00.000Z')],
    })
    const cursorValue = { createdAt: '2026-10-02T00:00:00.000Z', sessionId: 'session-2' }
    const env = makeEnv()

    const response = await handleCurrentUserSessionList(
      env,
      request({ limit: 10, cursor: encodeCursor(cursorValue) }),
    )
    const payload = await response.json() as { items: Array<{ sessionId: string }>; nextCursor: string | null }

    expect(response.status).toBe(200)
    expect(payload.items.map((item) => item.sessionId)).toEqual(['session-1'])
    expect(payload.nextCursor).toBeNull()
    expect(mocks.defaultStore.list).toHaveBeenCalledWith({
      userId: 'user-1',
      now: expect.any(String),
      limit: 11,
      cursor: cursorValue,
    })
  })

  it('accepts an injected persistence Store and authenticated session resolver', async () => {
    const env = makeEnv()
    const store = {
      list: vi.fn().mockResolvedValue({
        permissionGranted: true,
        rows: [
          row('postgres-session-3', '2026-10-03T00:00:00.000Z'),
          row('postgres-session-2', '2026-10-02T00:00:00.000Z'),
          row('postgres-session-1', '2026-10-01T00:00:00.000Z'),
        ],
      }),
    }
    const getSession = vi.fn().mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'postgres-session-2' },
    })

    const response = await handleCurrentUserSessionList(env, request({ limit: 2 }), {
      store,
      getSession,
    })
    const payload = await response.json() as {
      items: Array<Record<string, unknown>>
      currentSessionId: string
      nextCursor: string | null
    }

    expect(response.status).toBe(200)
    expect(payload.items.map((item) => item.sessionId)).toEqual([
      'postgres-session-3',
      'postgres-session-2',
    ])
    expect(payload.currentSessionId).toBe('postgres-session-2')
    expect(payload.nextCursor?.startsWith('s1.')).toBe(true)
    expect(payload.items.every((item) => !('token' in item) && !('userId' in item))).toBe(true)
    expect(store.list).toHaveBeenCalledWith({
      userId: 'user-1',
      now: expect.any(String),
      limit: 3,
      cursor: null,
    })
    expect(getSession).toHaveBeenCalledTimes(1)
    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(mocks.getW02PostgresRuntime).not.toHaveBeenCalled()
  })

  it('denies session listing when the effective base-user role is absent', async () => {
    mocks.defaultStore.list.mockResolvedValue({ permissionGranted: false, rows: [] })
    const env = makeEnv()

    const response = await handleCurrentUserSessionList(env, request({ limit: 10 }))
    const payload = await response.json() as { error?: { code?: string }; items?: unknown[] }

    expect(response.status).toBe(403)
    expect(payload.error?.code).toBe('PERMISSION_DENIED')
    expect(payload.items).toBeUndefined()
    expect(mocks.defaultStore.list).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid limits and cursors before authenticating or resolving the Store', async () => {
    const env = makeEnv()

    const limitResponse = await handleCurrentUserSessionList(env, request({ limit: 51 }))
    const cursorResponse = await handleCurrentUserSessionList(env, request({ limit: 10, cursor: 'not-valid' }))

    expect(limitResponse.status).toBe(400)
    expect(cursorResponse.status).toBe(400)
    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(mocks.defaultStore.list).not.toHaveBeenCalled()
    expect(mocks.getW02PostgresRuntime).not.toHaveBeenCalled()
  })

  it('rejects anonymous requests without resolving the Store or consuming rate limits', async () => {
    mocks.getSession.mockResolvedValueOnce(null)
    const env = makeEnv()

    const response = await handleCurrentUserSessionList(env, request({ limit: 10 }))

    expect(response.status).toBe(401)
    expect(mocks.defaultStore.list).not.toHaveBeenCalled()
    expect(env.AUTH_SESSION_READ_LIMITER?.limit).not.toHaveBeenCalled()
    expect(mocks.getW02PostgresRuntime).not.toHaveBeenCalled()
  })

  it('returns 429 before resolving the Store when a required scope is exhausted', async () => {
    const env = makeEnv()
    const limiter = env.AUTH_SESSION_READ_LIMITER!
    vi.mocked(limiter.limit)
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false })

    const response = await handleCurrentUserSessionList(env, request({ limit: 10 }))
    const payload = await response.json() as { error?: { code?: string } }

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
    expect(payload.error?.code).toBe('RATE_LIMITED')
    expect(limiter.limit).toHaveBeenCalledTimes(2)
    expect(mocks.defaultStore.list).not.toHaveBeenCalled()
    expect(mocks.getW02PostgresRuntime).not.toHaveBeenCalled()
  })

  it('fails closed when the Neon Store cannot serve the session query', async () => {
    mocks.defaultStore.list.mockRejectedValueOnce(new Error('PostgreSQL unavailable'))
    const env = makeEnv()

    const response = await handleCurrentUserSessionList(env, request({ limit: 10 }))
    const payload = await response.json() as { error?: { code?: string }; items?: unknown[] }

    expect(response.status).toBe(503)
    expect(payload.error?.code).toBe('SERVICE_UNAVAILABLE')
    expect(payload.items).toBeUndefined()
  })
})
