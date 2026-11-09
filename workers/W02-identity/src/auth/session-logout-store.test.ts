import { describe, expect, it, vi } from 'vitest'

import { createD1SessionLogoutStore } from './session-logout-store.js'

const makeDb = (results: unknown[] = [
  { success: true, meta: { changes: 1 } },
  { success: true, meta: { changes: 1 } },
]) => {
  const prepared: Array<{ sql: string; bind: ReturnType<typeof vi.fn> }> = []
  const prepare = vi.fn((sql: string) => {
    const statement = { sql, bind: vi.fn().mockReturnThis() }
    prepared.push(statement)
    return statement
  })
  const batch = vi.fn().mockResolvedValue(results)
  return {
    db: { prepare, batch } as unknown as D1Database,
    prepare,
    prepared,
    batch,
  }
}

const input = {
  userId: 'user-logout-01',
  sessionId: 'session-logout-01',
  now: '2026-11-10T00:00:00.000Z',
  correlationId: 'req_auth010_logout_test',
  causationId: 'auth010-logout-trace-test',
}

describe('W02 D1 current-session logout store', () => {
  it('deletes the caller-owned session and inserts USER_LOGOUT audit intent in one D1 batch', async () => {
    const db = makeDb()
    const store = createD1SessionLogoutStore(db.db)

    await expect(store.logout(input)).resolves.toEqual({ status: 'REVOKED' })

    expect(db.batch).toHaveBeenCalledTimes(1)
    expect(db.prepared).toHaveLength(2)
    expect(db.prepared[0]?.sql).toContain('DELETE FROM "session"')
    expect(db.prepared[0]?.bind).toHaveBeenCalledWith(input.sessionId, input.userId)
    expect(db.prepared[1]?.sql).toContain('INSERT INTO auth_010_session_revocation_journal')
    expect(db.prepared[1]?.sql).toContain('WHERE changes() = 1')

    const eventJson = db.prepared[1]?.bind.mock.calls[0]?.[7] as string
    expect(JSON.parse(eventJson)).toMatchObject({
      eventType: 'user.session.revoked',
      resourceId: input.sessionId,
      actor: { actorId: input.userId, actorType: 'user' },
      payload: { operationId: 'authLogout', result: 'succeeded', reasonCode: 'USER_LOGOUT' },
    })
  })

  it('treats a concurrent already-removed session as a no-op', async () => {
    const db = makeDb([
      { success: true, meta: { changes: 0 } },
      { success: true, meta: { changes: 0 } },
    ])
    const store = createD1SessionLogoutStore(db.db)

    await expect(store.logout(input)).resolves.toEqual({ status: 'NOT_FOUND_OR_NOT_OWNED' })
    expect(db.batch).toHaveBeenCalledTimes(1)
  })

  it('fails closed when session deletion and audit intent are not a matched pair', async () => {
    const db = makeDb([
      { success: true, meta: { changes: 1 } },
      { success: true, meta: { changes: 0 } },
    ])
    const store = createD1SessionLogoutStore(db.db)

    await expect(store.logout(input)).rejects.toThrow('SESSION_LOGOUT_AUDIT_BATCH_INCOMPLETE')
  })

  it('rejects invalid subjects and non-canonical timestamps before database access', async () => {
    const db = makeDb()
    const store = createD1SessionLogoutStore(db.db)

    await expect(store.logout({ ...input, userId: '../other-user' })).rejects.toThrow(TypeError)
    await expect(store.logout({ ...input, now: '2026-11-10' })).rejects.toThrow(TypeError)
    expect(db.batch).not.toHaveBeenCalled()
    expect(db.prepare).not.toHaveBeenCalled()
  })
})
