import { describe, expect, it, vi } from 'vitest'

import {
  createPostgresModerationD1Database,
  toPostgresModerationSql,
  type W06ModerationPostgresClient,
  type W06ModerationPostgresPool,
} from './neon-postgres-d1-database.js'

function fakePool(options: { rowCounts?: number[]; failAt?: number; errorCode?: string } = {}) {
  const poolCalls: Array<{ sql: string; values?: unknown[] }> = []
  const clientCalls: Array<{ sql: string; values?: unknown[] }> = []
  let queryIndex = 0
  const client: W06ModerationPostgresClient = {
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: unknown[]) {
      clientCalls.push({ sql, values })
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] as Row[], rowCount: 0 }
      }
      queryIndex += 1
      if (options.failAt === queryIndex) {
        throw Object.assign(new Error('simulated PostgreSQL error'), { code: options.errorCode ?? '23514' })
      }
      return { rows: [] as Row[], rowCount: options.rowCounts?.[queryIndex - 1] ?? 1 }
    },
    release: vi.fn(),
  }
  const pool: W06ModerationPostgresPool = {
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: unknown[]) {
      poolCalls.push({ sql, values })
      if (options.failAt === queryIndex + 1) {
        queryIndex += 1
        throw Object.assign(new Error('simulated PostgreSQL error'), { code: options.errorCode ?? '23514' })
      }
      return { rows: [] as Row[], rowCount: 0 }
    },
    async connect() { return client },
  }
  return { pool, poolCalls, clientCalls, client }
}

describe('W06 PostgreSQL moderation D1 bridge', () => {
  it('translates positional parameters while preserving question marks in literals and comments', () => {
    expect(toPostgresModerationSql(
      "SELECT '?' AS literal, value FROM t WHERE a = ? -- ?\nAND b = ? /* ? */",
    )).toBe("SELECT '?' AS literal, value FROM t WHERE a = $1 -- ?\nAND b = $2 /* ? */")
  })

  it('translates D1 INSERT OR IGNORE and binds changes() from the preceding batch statement', async () => {
    const { pool, clientCalls } = fakePool({ rowCounts: [1, 1, 1] })
    const db = createPostgresModerationD1Database(pool)
    const results = await db.batch([
      db.prepare('INSERT OR IGNORE INTO moderation_reports(report_id) VALUES (?)').bind('report_1'),
      db.prepare("INSERT INTO audit_events(event_id) SELECT ? WHERE changes() = 1").bind('audit_1'),
      db.prepare('INSERT OR IGNORE INTO moderation_report_idempotency(id) VALUES (?)').bind('idem_1'),
    ])

    expect(clientCalls[1]?.sql).toBe(
      'INSERT INTO moderation_reports(report_id) VALUES ($1)\nON CONFLICT DO NOTHING',
    )
    expect(clientCalls[2]).toEqual({
      sql: 'INSERT INTO audit_events(event_id) SELECT $1 WHERE $2 = 1',
      values: ['audit_1', 1],
    })
    expect(clientCalls[3]?.sql).toBe(
      'INSERT INTO moderation_report_idempotency(id) VALUES ($1)\nON CONFLICT DO NOTHING',
    )
    expect(results.every((result) => result.success)).toBe(true)
  })

  it('runs the moderation decision batch in one transaction and binds the previous CAS update count into its guard', async () => {
    const { pool, clientCalls, client } = fakePool({ rowCounts: [1, 1, 1, 1, 1, 1, 1] })
    const db = createPostgresModerationD1Database(pool)
    const results = await db.batch([
      db.prepare('INSERT INTO moderation_decisions(decision_id) VALUES (?)').bind('dec_1'),
      db.prepare('UPDATE moderation_cases SET version = ? WHERE case_id = ? AND version = ?').bind(2, 'case_1', 1),
      db.prepare('INSERT OR REPLACE INTO moderation_txn_guard(id,successful) VALUES (1, changes())'),
      db.prepare('INSERT INTO moderation_decision_idempotency(id) VALUES (?)').bind('idem_1'),
    ])

    expect(clientCalls[0]).toEqual({ sql: 'BEGIN', values: undefined })
    expect(clientCalls[1]).toEqual({
      sql: 'INSERT INTO moderation_decisions(decision_id) VALUES ($1)',
      values: ['dec_1'],
    })
    expect(clientCalls[2]?.sql).toContain('UPDATE moderation_cases SET version = $1')
    expect(clientCalls[3]).toEqual({
      sql: 'INSERT INTO moderation_txn_guard (id, successful) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET successful = EXCLUDED.successful',
      values: [1],
    })
    expect(clientCalls.at(-1)?.sql).toBe('COMMIT')
    expect(results).toHaveLength(4)
    expect(results.every((result) => result.success)).toBe(true)
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('binds zero for a stale version so PostgreSQL rejects the transaction guard', async () => {
    const { pool, clientCalls, client } = fakePool({
      rowCounts: [1, 0],
      failAt: 3,
      errorCode: '23514',
    })
    const db = createPostgresModerationD1Database(pool)

    await expect(db.batch([
      db.prepare('INSERT INTO moderation_decisions(decision_id) VALUES (?)').bind('dec_1'),
      db.prepare('UPDATE moderation_cases SET version = ? WHERE case_id = ? AND version = ?').bind(2, 'case_1', 1),
      db.prepare('INSERT OR REPLACE INTO moderation_txn_guard(id,successful) VALUES (1, changes())'),
    ])).rejects.toMatchObject({ code: '23514' })

    expect(clientCalls[4]).toEqual({ sql: 'ROLLBACK', values: undefined })
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('rolls back a failed PostgreSQL batch and preserves unique conflicts for idempotent replay', async () => {
    const unique = fakePool({ failAt: 2, errorCode: '23505' })
    const db = createPostgresModerationD1Database(unique.pool)

    await expect(db.batch([
      db.prepare('INSERT INTO moderation_decisions(decision_id) VALUES (?)').bind('dec_1'),
      db.prepare('INSERT INTO moderation_decision_idempotency(id) VALUES (?)').bind('idem_1'),
    ])).rejects.toThrow('UNIQUE constraint failed')

    expect(unique.clientCalls.map((call) => call.sql)).toEqual([
      'BEGIN',
      'INSERT INTO moderation_decisions(decision_id) VALUES ($1)',
      'INSERT INTO moderation_decision_idempotency(id) VALUES ($1)',
      'ROLLBACK',
    ])
    expect(unique.client.release).toHaveBeenCalledOnce()
  })

  it('normalizes PostgreSQL timestamps and uses direct pool queries outside batches', async () => {
    const pool: W06ModerationPostgresPool = {
      async query<Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: unknown[]) {
        return {
          rows: [{ created_at: new Date('2026-11-15T12:00:00.123Z'), eventid: 'evt_1', actorjson: { actorId: 'user_1', actorType: 'user' } }] as unknown as Row[],
          rowCount: 1,
        }
      },
      async connect() {
        throw new Error('direct read should not acquire a transaction client')
      },
    }
    const row = await createPostgresModerationD1Database(pool)
      .prepare('SELECT created_at, actor_json FROM audit_events WHERE event_id = ?')
      .bind('event_1')
      .first<{ created_at: string; eventId: string; actorJson: string }>()

    expect(row?.created_at).toBe('2026-11-15T12:00:00.123Z')
    expect(row?.eventId).toBe('evt_1')
    expect(row?.actorJson).toBe(JSON.stringify({ actorId: 'user_1', actorType: 'user' }))
  })
})
