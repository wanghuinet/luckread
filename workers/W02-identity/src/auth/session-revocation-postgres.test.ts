import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import { createPostgresSessionRevocationStore } from '../neon/session-revocation-postgres-store.js'

const now = '2026-11-09T15:00:00.000Z'
const input = {
  userId: 'user-1',
  sessionId: 'target-session',
  now,
  correlationId: 'req_session_revoke_test',
  causationId: 'trace-session-revoke-test',
}

type QueryResult = { rows: unknown[]; rowCount: number | null }

const makePool = (results: Array<QueryResult | Error>) => {
  const query = vi.fn(async (_sql: string, _values?: unknown[]) => {
    const next = results.shift()
    if (next instanceof Error) throw next
    if (!next) throw new Error('unexpected PostgreSQL session-revocation query')
    return next
  })
  const client = { query, release: vi.fn() }
  const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool
  return { pool, client }
}

describe('W02 PostgreSQL AUTH-010 session-revocation Store', () => {
  it('locks authority and target, deletes the owned session, and journals the event in one transaction', async () => {
    const { pool, client } = makePool([
      { rows: [], rowCount: 0 },
      { rows: [{ id: 'role-assignment-1' }], rowCount: 1 },
      { rows: [{ id: 'target-session' }], rowCount: 1 },
      { rows: [{ id: 'target-session' }], rowCount: 1 },
      { rows: [{ journalId: 'journal-1' }], rowCount: 1 },
      { rows: [], rowCount: 0 },
    ])

    await expect(createPostgresSessionRevocationStore(pool).revoke(input)).resolves.toEqual({
      status: 'REVOKED',
    })

    expect(pool.connect).toHaveBeenCalledTimes(1)
    expect(client.query.mock.calls[0]?.[0]).toBe('BEGIN')
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('FOR SHARE OF account, assignment'),
      ['user-1', now],
    )
    expect(client.query).toHaveBeenCalledWith(
      'SELECT id FROM "session" WHERE id = $1 AND user_id = $2 FOR UPDATE',
      ['target-session', 'user-1'],
    )
    expect(client.query).toHaveBeenCalledWith(
      'DELETE FROM "session" WHERE id = $1 AND user_id = $2 RETURNING id',
      ['target-session', 'user-1'],
    )
    const insertCall = client.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO auth_010_session_revocation_journal'),
    )
    expect(insertCall?.[0]).toContain("VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING'")
    expect(insertCall?.[1]?.[4]).toBe('target-session')
    const event = JSON.parse(String(insertCall?.[1]?.[7]))
    expect(event).toMatchObject({
      eventType: 'user.session.revoked',
      resourceId: 'target-session',
      correlationId: 'req_session_revoke_test',
      causationId: 'trace-session-revoke-test',
      actor: { actorId: 'user-1', actorType: 'user' },
      payload: { operationId: 'authSessionRevoke', result: 'succeeded', reasonCode: 'USER_INITIATED' },
    })
    expect(client.query).toHaveBeenCalledWith('COMMIT')
    expect(client.query).not.toHaveBeenCalledWith('ROLLBACK')
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  it('denies revocation when effective base-user authority is absent', async () => {
    const { pool, client } = makePool([
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
    ])

    await expect(createPostgresSessionRevocationStore(pool).revoke(input)).resolves.toEqual({
      status: 'PERMISSION_DENIED',
    })
    expect(client.query).toHaveBeenCalledTimes(3)
    expect(client.query.mock.calls[2]?.[0]).toBe('COMMIT')
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM "session"'))).toBe(false)
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO auth_010_session_revocation_journal'))).toBe(false)
  })

  it('keeps missing and cross-account sessions indistinguishable without writing an audit event', async () => {
    const { pool, client } = makePool([
      { rows: [], rowCount: 0 },
      { rows: [{ id: 'role-assignment-1' }], rowCount: 1 },
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
    ])

    await expect(createPostgresSessionRevocationStore(pool).revoke(input)).resolves.toEqual({
      status: 'NOT_FOUND_OR_NOT_OWNED',
    })
    expect(client.query).toHaveBeenCalledTimes(4)
    expect(client.query.mock.calls[3]?.[0]).toBe('COMMIT')
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM "session"'))).toBe(false)
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO auth_010_session_revocation_journal'))).toBe(false)
  })

  it('rolls back the session deletion if the durable audit insert is incomplete', async () => {
    const { pool, client } = makePool([
      { rows: [], rowCount: 0 },
      { rows: [{ id: 'role-assignment-1' }], rowCount: 1 },
      { rows: [{ id: 'target-session' }], rowCount: 1 },
      { rows: [{ id: 'target-session' }], rowCount: 1 },
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
    ])

    await expect(createPostgresSessionRevocationStore(pool).revoke(input))
      .rejects.toThrow('AUTH010_POSTGRES_OUTBOX_INSERT_INCOMPLETE')
    expect(client.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK')
    expect(client.query).not.toHaveBeenCalledWith('COMMIT')
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  it('rejects non-canonical timestamps before acquiring a PostgreSQL connection', async () => {
    const { pool } = makePool([])

    await expect(createPostgresSessionRevocationStore(pool).revoke({
      ...input,
      now: '2026-11-09T15:00:00+00:00',
    })).rejects.toThrow('invalid PostgreSQL session revocation input')
    expect(pool.connect).not.toHaveBeenCalled()
  })
})
