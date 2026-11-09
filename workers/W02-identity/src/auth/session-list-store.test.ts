import { describe, expect, it, vi } from 'vitest'

import { createD1SessionListStore } from './session-list-store.js'

const now = '2026-11-09T15:00:00.000Z'

const makeDatabase = (result: unknown) => {
  const statement = {
    bind: vi.fn().mockReturnThis(),
    all: vi.fn().mockResolvedValue(result),
  }
  const db = { prepare: vi.fn().mockReturnValue(statement) }
  return { db: db as unknown as D1Database, prepare: db.prepare, statement }
}

describe('W02 D1 session-list store', () => {
  it('uses the authenticated subject, effective base role and a bounded look-ahead query', async () => {
    const storeDb = makeDatabase({
      success: true,
      results: [
        {
          permissionGranted: 1,
          sessionId: 'session-new',
          createdAt: '2026-11-09T14:59:00.000Z',
          expiresAt: '2026-11-16T14:59:00.000Z',
        },
        {
          permissionGranted: 1,
          sessionId: 'session-old',
          createdAt: '2026-11-09T14:58:00.000Z',
          expiresAt: '2026-11-16T14:58:00.000Z',
        },
      ],
    })
    const store = createD1SessionListStore(storeDb.db)
    const result = await store.list({
      userId: 'authenticated-user',
      now,
      limit: 2,
      cursor: null,
    })

    expect(result.permissionGranted).toBe(true)
    expect(result.rows.map((row) => row.sessionId)).toEqual(['session-new', 'session-old'])
    expect(storeDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INNER JOIN role_assignments'))
    expect(storeDb.prepare).toHaveBeenCalledWith(
      expect.stringContaining('EXISTS (SELECT 1 FROM authorization WHERE permissionGranted = 1)'),
    )
    expect(storeDb.prepare).toHaveBeenCalledWith(expect.stringContaining('WHERE user_id = ? AND expires_at > ?'))
    expect(storeDb.prepare).toHaveBeenCalledWith(expect.stringContaining('ORDER BY created_at DESC, id DESC'))
    expect(storeDb.statement.bind).toHaveBeenCalledWith(
      'authenticated-user',
      now,
      now,
      'authenticated-user',
      now,
      2,
    )
  })

  it('applies the keyset cursor and keeps the query page bounded', async () => {
    const storeDb = makeDatabase({
      success: true,
      results: [{
        permissionGranted: 1,
        sessionId: 'session-earlier',
        createdAt: '2026-11-09T14:58:00.000Z',
        expiresAt: '2026-11-16T14:58:00.000Z',
      }],
    })
    const store = createD1SessionListStore(storeDb.db)
    const result = await store.list({
      userId: 'authenticated-user',
      now,
      limit: 11,
      cursor: {
        createdAt: '2026-11-09T14:59:00.000Z',
        sessionId: 'session-newer',
      },
    })

    expect(result.rows.map((row) => row.sessionId)).toEqual(['session-earlier'])
    expect(storeDb.prepare).toHaveBeenCalledWith(
      expect.stringContaining('(created_at < ? OR (created_at = ? AND id < ?))'),
    )
    expect(storeDb.statement.bind).toHaveBeenCalledWith(
      'authenticated-user',
      now,
      now,
      'authenticated-user',
      now,
      '2026-11-09T14:59:00.000Z',
      '2026-11-09T14:59:00.000Z',
      'session-newer',
      11,
    )
  })

  it('returns permission denied without projecting session rows', async () => {
    const storeDb = makeDatabase({
      success: true,
      results: [{ permissionGranted: 0, sessionId: null, createdAt: null, expiresAt: null }],
    })
    const result = await createD1SessionListStore(storeDb.db).list({
      userId: 'inactive-user',
      now,
      limit: 10,
      cursor: null,
    })

    expect(result).toEqual({ permissionGranted: false, rows: [] })
  })

  it('fails closed on unsuccessful or empty D1 query results', async () => {
    const unsuccessful = makeDatabase({ success: false, results: [] })
    const empty = makeDatabase({ success: true, results: [] })

    await expect(createD1SessionListStore(unsuccessful.db).list({
      userId: 'user-1',
      now,
      limit: 10,
      cursor: null,
    })).rejects.toThrow('SESSION_LIST_SELECT_FAILED')
    await expect(createD1SessionListStore(empty.db).list({
      userId: 'user-1',
      now,
      limit: 10,
      cursor: null,
    })).rejects.toThrow('SESSION_LIST_SELECT_FAILED')
  })

  it('validates limit and subject before preparing SQL', async () => {
    const storeDb = makeDatabase({ success: true, results: [] })
    const store = createD1SessionListStore(storeDb.db)

    await expect(store.list({
      userId: 'user-1',
      now,
      limit: 0,
      cursor: null,
    })).rejects.toThrow('invalid session list query')
    expect(storeDb.prepare).not.toHaveBeenCalled()
  })
})
