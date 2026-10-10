import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
}))

vi.mock('./better-auth.js', () => ({
  createLuckReadAuth: () => ({ api: { getSession: mocks.getSession } }),
}))

import type { BetterAuthEnv } from './better-auth.js'
import { handleCurrentUserSessionList } from './session-list.js'

const request = (body: unknown) => new Request('https://luckread-w02.internal/internal/auth/session/list', {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie: 'better-auth.session_token=test' },
  body: JSON.stringify(body),
})

const makeDatabase = (rows: unknown[] = []) => {
  const statement = {
    bind: vi.fn().mockReturnThis(),
    all: vi.fn().mockResolvedValue({ results: rows }),
  }
  const database = { prepare: vi.fn().mockReturnValue(statement) }
  return { database: database as unknown as D1Database, statement, prepare: database.prepare }
}

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
  token: 'never-project-this',
  userId: 'never-project-this',
})

describe('W02 bounded session list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-2' },
    })
  })

  it('scopes the SQL to the authenticated user and returns at most the requested page', async () => {
    const db = makeDatabase([
      row('session-3', '2026-10-03T00:00:00.000Z'),
      row('session-2', '2026-10-02T00:00:00.000Z'),
      row('session-1', '2026-10-01T00:00:00.000Z'),
    ])
    const env = { D1_01: db.database } as BetterAuthEnv

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
    expect(payload.nextCursor).toMatch(/^s1\.[A-Za-z0-9_-]+$/)
    expect(decodeCursor(payload.nextCursor as string)).toEqual({
      createdAt: '2026-10-02T00:00:00.000Z',
      sessionId: 'session-2',
    })
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('WHERE user_id = ? AND expires_at > ?'))
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('ORDER BY created_at DESC, id DESC LIMIT ?'))
    expect(db.statement.bind).toHaveBeenCalledWith('user-1', expect.any(String), 3)
    expect(db.statement.all).toHaveBeenCalledTimes(1)
  })

  it('uses the decoded cursor in the keyset predicate and bounds the look-ahead query', async () => {
    const db = makeDatabase([row('session-1', '2026-10-01T00:00:00.000Z')])
    const cursor = encodeCursor({ createdAt: '2026-10-02T00:00:00.000Z', sessionId: 'session-2' })
    const env = { D1_01: db.database } as BetterAuthEnv

    const response = await handleCurrentUserSessionList(env, request({ limit: 10, cursor }))
    const payload = await response.json() as { items: Array<{ sessionId: string }>; nextCursor: string | null }

    expect(response.status).toBe(200)
    expect(payload.items.map((item) => item.sessionId)).toEqual(['session-1'])
    expect(payload.nextCursor).toBeNull()
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('(created_at < ? OR (created_at = ? AND id < ?))'))
    expect(db.statement.bind).toHaveBeenCalledWith(
      'user-1',
      expect.any(String),
      '2026-10-02T00:00:00.000Z',
      '2026-10-02T00:00:00.000Z',
      'session-2',
      11,
    )
  })

  it('rejects invalid limits and cursors before authenticating or querying D1', async () => {
    const db = makeDatabase()
    const env = { D1_01: db.database } as BetterAuthEnv

    const limitResponse = await handleCurrentUserSessionList(env, request({ limit: 51 }))
    const cursorResponse = await handleCurrentUserSessionList(env, request({ limit: 10, cursor: 'not-valid' }))

    expect(limitResponse.status).toBe(400)
    expect(cursorResponse.status).toBe(400)
    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(db.prepare).not.toHaveBeenCalled()
  })

  it('rejects anonymous requests without querying session rows', async () => {
    mocks.getSession.mockResolvedValueOnce(null)
    const db = makeDatabase()
    const env = { D1_01: db.database } as BetterAuthEnv

    const response = await handleCurrentUserSessionList(env, request({ limit: 10 }))

    expect(response.status).toBe(401)
    expect(db.prepare).not.toHaveBeenCalled()
  })

  it('fails closed when D1 cannot serve the session query', async () => {
    const db = makeDatabase()
    db.statement.all.mockRejectedValueOnce(new Error('D1 unavailable'))
    const env = { D1_01: db.database } as BetterAuthEnv

    const response = await handleCurrentUserSessionList(env, request({ limit: 10 }))

    expect(response.status).toBe(503)
    const payload = await response.json() as { error?: { code?: string } }
    expect(payload.error?.code).toBe('SERVICE_UNAVAILABLE')
  })
})
