import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
}))

vi.mock('./better-auth.js', () => ({
  createLuckReadAuth: () => ({ api: { getSession: mocks.getSession } }),
}))

import type { BetterAuthEnv } from './better-auth.js'
import { handleCurrentUserSessionRevoke } from './session-revoke.js'

const request = (sessionId: unknown) => new Request(
  'https://luckread-w02.internal/internal/auth/session/revoke-by-id',
  {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: 'better-auth.session_token=test',
      'X-LuckRead-Correlation-Id': 'corr-session-revoke-test',
      'X-LuckRead-Request-Id': 'request-session-revoke-test',
    },
    body: JSON.stringify({ sessionId }),
  },
)

const makeEnv = (
  target: unknown,
  batchResults: unknown[] = [
    { success: true, meta: { changes: 1 } },
    { success: true, meta: { changes: 1 } },
  ],
) => {
  const sequence: string[] = []
  const targetStatement = {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(
      target && typeof target === 'object'
        ? { permissionGranted: 1, ...(target as Record<string, unknown>) }
        : target,
    ),
  }
  const prepared: Array<{ sql: string; bind: ReturnType<typeof vi.fn> }> = []
  const prepare = vi.fn((sql: string) => {
    if (sql.includes('WITH authorization')) {
      sequence.push('d1:target-session')
      return targetStatement
    }
    const statement = { sql, bind: vi.fn().mockReturnThis() }
    prepared.push(statement)
    return statement
  })
  const batch = vi.fn(async (_statements: unknown[]) => {
    sequence.push('d1:atomic-session-delete-and-audit')
    return batchResults as never
  })
  const database = { prepare, batch }
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
  return { env, limiter, prepare, targetStatement, prepared, batch, sequence }
}

describe('W02 policy-scoped session revoke', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'current-session' } })
  })

  it('checks self permission then atomically deletes the session and journals one audit event', async () => {
    const db = makeEnv({ id: 'target-session', userId: 'user-1' })
    const response = await handleCurrentUserSessionRevoke(db.env, request('target-session'))
    const payload = await response.json() as { revoked?: boolean }

    expect(response.status).toBe(200)
    expect(payload.revoked).toBe(true)
    expect(db.limiter.limit).toHaveBeenNthCalledWith(1, { key: 'auth010:session-revoke:account:user-1' })
    expect(db.limiter.limit).toHaveBeenNthCalledWith(2, { key: 'auth010:session-revoke:session:current-session' })
    expect(db.limiter.limit).toHaveBeenNthCalledWith(3, { key: 'auth010:session-revoke:endpoint' })
    expect(db.sequence).toEqual([
      'auth010:session-revoke:account:user-1',
      'auth010:session-revoke:session:current-session',
      'auth010:session-revoke:endpoint',
      'd1:target-session',
      'd1:atomic-session-delete-and-audit',
    ])
    expect(db.targetStatement.bind).toHaveBeenCalledWith(
      'user-1', expect.any(String), expect.any(String), 'target-session', 'user-1',
    )
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('role_assignments'))
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('"session"'))
    expect(db.prepared).toHaveLength(2)
    expect(db.prepared[0]?.sql).toContain('DELETE FROM "session"')
    expect(db.prepared[0]?.sql).toContain('INNER JOIN role_assignments AS assignment')
    expect(db.prepared[0]?.sql).toContain("account.account_state IN ('PENDING_VERIFICATION', 'ACTIVE')")
    expect(db.prepared[0]?.bind).toHaveBeenCalledWith('target-session', 'user-1', 'user-1', expect.any(String), expect.any(String))
    expect(db.prepared[1]?.sql).toContain('INSERT INTO auth_010_session_revocation_journal')
    expect(db.prepared[1]?.sql).toContain('WHERE changes() = 1')
    expect(db.prepared[0]?.bind).toHaveBeenCalledWith('target-session', 'user-1')
    expect(db.prepared[1]?.bind).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringMatching(/^evt_[a-f0-9]{32}$/),
      'user.session.revoked',
      '1.0',
      'target-session',
      1,
      expect.stringMatching(/^AUTH010_SESSION_REVOKE_[a-f0-9]{32}$/),
      expect.stringContaining('"eventType":"user.session.revoked"'),
      'PENDING',
      1,
      null,
      expect.any(String),
      null,
      null,
    )
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('denies revoke when the explicit user role permission is not effective', async () => {
    const db = makeEnv({ permissionGranted: 0, id: null, userId: null })
    const response = await handleCurrentUserSessionRevoke(db.env, request('target-session'))
    const payload = await response.json() as { error?: { code?: string } }

    expect(response.status).toBe(403)
    expect(payload.error?.code).toBe('PERMISSION_DENIED')
    expect(db.batch).not.toHaveBeenCalled()
  })

  it('returns 429 without reading the target when a required scope is exhausted', async () => {
    const db = makeEnv({ id: 'target-session', userId: 'user-1' })
    vi.mocked(db.limiter.limit)
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false })
    const response = await handleCurrentUserSessionRevoke(db.env, request('target-session'))
    const payload = await response.json() as { error?: { code?: string } }

    expect(response.status).toBe(429)
    expect(payload.error?.code).toBe('RATE_LIMITED')
    expect(db.prepare).not.toHaveBeenCalled()
    expect(db.batch).not.toHaveBeenCalled()
  })

  it('fails closed when the W02 rate-limit binding is unavailable', async () => {
    const db = makeEnv({ id: 'target-session', userId: 'user-1' })
    delete db.env.AUTH_SESSION_WRITE_LIMITER
    const response = await handleCurrentUserSessionRevoke(db.env, request('target-session'))
    expect(response.status).toBe(503)
    expect(db.prepare).not.toHaveBeenCalled()
    expect(db.batch).not.toHaveBeenCalled()
  })

  it('does not authenticate or query when the current user has no valid session', async () => {
    mocks.getSession.mockResolvedValueOnce(null)
    const db = makeEnv({ id: 'target-session', userId: 'user-1' })
    const response = await handleCurrentUserSessionRevoke(db.env, request('target-session'))
    expect(response.status).toBe(401)
    expect(db.limiter.limit).not.toHaveBeenCalled()
    expect(db.prepare).not.toHaveBeenCalled()
    expect(db.batch).not.toHaveBeenCalled()
  })

  it('rejects revocation of the authenticated current session before any D1 lookup', async () => {
    const db = makeEnv({ id: 'current-session', userId: 'user-1' })
    const response = await handleCurrentUserSessionRevoke(db.env, request('current-session'))
    const payload = await response.json() as { error?: { code?: string } }

    expect(response.status).toBe(409)
    expect(payload.error?.code).toBe('CURRENT_SESSION_PROTECTED')
    expect(db.limiter.limit).toHaveBeenCalledTimes(3)
    expect(db.prepare).not.toHaveBeenCalled()
    expect(db.batch).not.toHaveBeenCalled()
  })

  it('keeps cross-account and missing sessions indistinguishable', async () => {
    const db = makeEnv({ id: 'target-session', userId: 'other-user' })
    const response = await handleCurrentUserSessionRevoke(db.env, request('target-session'))
    const payload = await response.json() as { revoked?: boolean }
    expect(response.status).toBe(200)
    expect(payload.revoked).toBe(true)
    expect(db.batch).not.toHaveBeenCalled()
  })

  it('treats a concurrent already-removed target as a successful no-op without a second event', async () => {
    const db = makeEnv(
      { id: 'target-session', userId: 'user-1' },
      [
        { success: true, meta: { changes: 0 } },
        { success: true, meta: { changes: 0 } },
      ],
    )
    const response = await handleCurrentUserSessionRevoke(db.env, request('target-session'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ revoked: true })
    expect(db.batch).toHaveBeenCalledTimes(1)
    expect(db.prepared[1]?.sql).toContain('WHERE changes() = 1')
  })

  it('returns 503 when the atomic delete-plus-outbox transaction fails', async () => {
    const db = makeEnv({ id: 'target-session', userId: 'user-1' })
    db.batch.mockRejectedValueOnce(new Error('D1 transaction failed'))
    const response = await handleCurrentUserSessionRevoke(db.env, request('target-session'))
    const payload = await response.json() as { error?: { code?: string } }
    expect(response.status).toBe(503)
    expect(payload.error?.code).toBe('SERVICE_UNAVAILABLE')
    expect(db.batch).toHaveBeenCalledTimes(1)
  })
})
