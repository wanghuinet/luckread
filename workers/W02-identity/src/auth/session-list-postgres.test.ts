import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import { createPostgresSessionListStore } from '../neon/session-list-postgres.js'

const now = '2026-11-09T15:00:00.000Z'

const makePool = (rows: unknown[] = []) => {
  const query = vi.fn().mockResolvedValue({ rows })
  return { pool: { query } as unknown as Pool, query }
}

const row = (sessionId: string, createdAt: string) => ({
  permissionGranted: true,
  sessionId,
  createdAt,
  expiresAt: '2026-11-16T14:59:00.000000Z',
  token: 'must-not-be-projected',
  userId: 'must-not-be-projected',
  ipAddress: 'must-not-be-projected',
})

describe('W02 PostgreSQL AUTH-010 session-list Store', () => {
  it('rechecks the effective base-user role and returns only bounded session metadata', async () => {
    const { pool, query } = makePool([
      row('session-new', '2026-11-09T14:59:00.123456Z'),
      row('session-old', '2026-11-09T14:58:00.000001Z'),
    ])
    const store = createPostgresSessionListStore(pool)

    const result = await store.list({
      userId: 'authenticated-user',
      now,
      limit: 2,
      cursor: null,
    })

    expect(result.permissionGranted).toBe(true)
    expect(result.rows).toEqual([
      {
        sessionId: 'session-new',
        createdAt: '2026-11-09T14:59:00.123456Z',
        expiresAt: '2026-11-16T14:59:00.000000Z',
      },
      {
        sessionId: 'session-old',
        createdAt: '2026-11-09T14:58:00.000001Z',
        expiresAt: '2026-11-16T14:59:00.000000Z',
      },
    ])
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INNER JOIN role_assignments'), [
      'authenticated-user',
      now,
      2,
    ])
    const sql = String(query.mock.calls[0]?.[0])
    expect(sql).toContain("account.account_state IN ('PENDING_VERIFICATION', 'ACTIVE')")
    expect(sql).toContain("assignment.role_id = 'user'")
    expect(sql).toContain('WHERE user_id = $1 AND expires_at > $2')
    expect(sql).toContain('ORDER BY created_at DESC, id DESC')
    expect(sql).toContain('LIMIT $3')
    expect(result.rows.every((session) => !('token' in session) && !('userId' in session))).toBe(true)
  })

  it('applies the keyset cursor with stable parameter ordering and a bounded page', async () => {
    const { pool, query } = makePool([row('session-earlier', '2026-11-09T14:58:00.000001Z')])
    const cursor = {
      createdAt: '2026-11-09T14:59:00.123456Z',
      sessionId: 'session-newer',
    }
    const store = createPostgresSessionListStore(pool)

    const result = await store.list({
      userId: 'authenticated-user',
      now,
      limit: 11,
      cursor,
    })

    expect(result.rows.map((session) => session.sessionId)).toEqual(['session-earlier'])
    expect(query).toHaveBeenCalledWith(expect.stringContaining(
      '(created_at < $3 OR (created_at = $4 AND id < $5))',
    ), [
      'authenticated-user',
      now,
      cursor.createdAt,
      cursor.createdAt,
      cursor.sessionId,
      11,
    ])
    expect(String(query.mock.calls[0]?.[0])).toContain('LIMIT $6')
  })

  it('returns permission denied without projecting session rows', async () => {
    const { pool } = makePool([{
      permissionGranted: false,
      sessionId: null,
      createdAt: null,
      expiresAt: null,
    }])

    await expect(createPostgresSessionListStore(pool).list({
      userId: 'inactive-user',
      now,
      limit: 10,
      cursor: null,
    })).resolves.toEqual({ permissionGranted: false, rows: [] })
  })

  it('fails closed when the authorization authority query returns no row', async () => {
    const { pool } = makePool()

    await expect(createPostgresSessionListStore(pool).list({
      userId: 'user-1',
      now,
      limit: 10,
      cursor: null,
    })).rejects.toThrow('AUTH010_POSTGRES_SESSION_LIST_EMPTY_AUTHORITY_RESULT')
  })

  it('rejects invalid and non-canonical timestamps before querying PostgreSQL', async () => {
    const { pool, query } = makePool()
    const store = createPostgresSessionListStore(pool)

    await expect(store.list({
      userId: 'user-1',
      now: '2026-11-09T15:00:00+00:00',
      limit: 10,
      cursor: null,
    })).rejects.toThrow('invalid PostgreSQL AUTH-010 session-list input')
    await expect(store.list({
      userId: 'user-1',
      now,
      limit: 10,
      cursor: { createdAt: 'not-a-time', sessionId: 'session-1' },
    })).rejects.toThrow('invalid PostgreSQL AUTH-010 session-list cursor')
    expect(query).not.toHaveBeenCalled()
  })

  it('fails closed when a returned session lacks valid timestamps', async () => {
    const { pool } = makePool([{
      permissionGranted: true,
      sessionId: 'session-1',
      createdAt: null,
      expiresAt: null,
    }])

    await expect(createPostgresSessionListStore(pool).list({
      userId: 'user-1',
      now,
      limit: 10,
      cursor: null,
    })).rejects.toThrow('AUTH010_POSTGRES_SESSION_LIST_TIMESTAMP_MISSING')
  })
})
