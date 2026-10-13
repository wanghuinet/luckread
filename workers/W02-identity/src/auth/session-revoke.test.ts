import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  revokeSession: vi.fn(),
}))

vi.mock('./better-auth.js', () => ({
  createLuckReadAuth: () => ({
    api: {
      getSession: mocks.getSession,
      revokeSession: mocks.revokeSession,
    },
  }),
}))

import type { BetterAuthEnv } from './better-auth.js'
import { handleCurrentUserSessionRevoke } from './session-revoke.js'

const request = (sessionId: unknown) => new Request(
  'https://luckread-w02.internal/internal/auth/session/revoke-by-id',
  {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'better-auth.session_token=test' },
    body: JSON.stringify({ sessionId }),
  },
)

const makeEnv = (target: unknown) => {
  const sequence: string[] = []
  const statement = {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(target),
  }
  const prepare = vi.fn((_sql: string) => {
    sequence.push('d1:target-session')
    return statement
  })
  const database = { prepare }
  const limiter = {
    limit: vi.fn(async ({ key }: { key: string }) => {
      sequence.push(key)
      return { success: true }
    }),
  }
  const env = {
    D1_01: database as unknown as D1Database,
    AUTH_SESSION_WRITE_LIMITER: limiter,
  } as BetterAuthEnv
  return { env, limiter, prepare, statement, sequence }
}

describe('W02 policy-scoped session revoke', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'current-session' } })
    mocks.revokeSession.mockResolvedValue({ success: true })
  })

  it('enforces account, authenticated-caller-session, and endpoint limits before reading D1', async () => {
    const db = makeEnv({ id: 'target-session', token: 'private-native-session-token', userId: 'user-1' })
    const response = await handleCurrentUserSessionRevoke(db.env, request('target-session'))
    const payload = await response.json() as { revoked?: boolean }

    expect(response.status).toBe(200)
    expect(payload.revoked).toBe(true)
    expect(db.limiter.limit).toHaveBeenNthCalledWith(1, { key: 'auth010:session-revoke:account:user-1' })
    expect(db.limiter.limit).toHaveBeenNthCalledWith(2, { key: 'auth010:session-revoke:session:current-session' })
    expect(db.limiter.limit).toHaveBeenNthCalledWith(3, { key: 'auth010:session-revoke:endpoint' })
    expect(db.sequence.slice(0, 4)).toEqual([
      'auth010:session-revoke:account:user-1',
      'auth010:session-revoke:session:current-session',
      'auth010:session-revoke:endpoint',
      'd1:target-session',
    ])
    expect(db.statement.bind).toHaveBeenCalledWith('target-session')
    expect(mocks.revokeSession).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      body: { token: 'private-native-session-token' },
    })
    expect(JSON.stringify(payload)).not.toContain('private-native-session-token')
  })

  it('returns 429 without reading the target when a required scope is exhausted', async () => {
    const db = makeEnv({ id: 'target-session', token: 'private-native-session-token', userId: 'user-1' })
    vi.mocked(db.limiter.limit)
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false })
    const response = await handleCurrentUserSessionRevoke(db.env, request('target-session'))
    const payload = await response.json() as { error?: { code?: string } }

    expect(response.status).toBe(429)
    expect(payload.error?.code).toBe('RATE_LIMITED')
    expect(db.prepare).not.toHaveBeenCalled()
    expect(mocks.revokeSession).not.toHaveBeenCalled()
  })

  it('fails closed when the W02 rate-limit binding is unavailable', async () => {
    const db = makeEnv({ id: 'target-session', token: 'private-token', userId: 'user-1' })
    delete db.env.AUTH_SESSION_WRITE_LIMITER
    const response = await handleCurrentUserSessionRevoke(db.env, request('target-session'))
    expect(response.status).toBe(503)
    expect(db.prepare).not.toHaveBeenCalled()
    expect(mocks.revokeSession).not.toHaveBeenCalled()
  })

  it('does not authenticate or query when the current user has no valid session', async () => {
    mocks.getSession.mockResolvedValueOnce(null)
    const db = makeEnv({ id: 'target-session', token: 'private-token', userId: 'user-1' })
    const response = await handleCurrentUserSessionRevoke(db.env, request('target-session'))
    expect(response.status).toBe(401)
    expect(db.limiter.limit).not.toHaveBeenCalled()
    expect(db.prepare).not.toHaveBeenCalled()
  })

  it('keeps cross-account and missing sessions indistinguishable', async () => {
    const db = makeEnv({ id: 'target-session', token: 'private-token', userId: 'other-user' })
    const response = await handleCurrentUserSessionRevoke(db.env, request('target-session'))
    const payload = await response.json() as { revoked?: boolean }
    expect(response.status).toBe(200)
    expect(payload.revoked).toBe(true)
    expect(mocks.revokeSession).not.toHaveBeenCalled()
  })
})
