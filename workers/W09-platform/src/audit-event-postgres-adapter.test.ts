import { describe, expect, it } from 'vitest'

import { translateW09AuditEventD1Statement as translate } from './audit-event-postgres-adapter.js'

describe('W09 AuditEvent PostgreSQL adapter', () => {
  it('returns null for D1 statements owned by other D1-03 tables', () => {
    expect(translate('SELECT case_id FROM moderation_cases WHERE case_id = ?', undefined)).toBeNull()
  })

  it('translates append-only AuditEvent reads and preserves placeholders inside SQL literals/comments', () => {
    const result = translate(
      "SELECT event_id, action FROM audit_events WHERE action = '?' AND event_id = ? -- ?\nLIMIT 1",
    )

    expect(result).toEqual({
      sql: "SELECT event_id, action FROM audit_events WHERE action = '?' AND event_id = $1 -- ?\nLIMIT 1",
      extraValues: [],
    })
  })

  it('translates direct AuditEvent INSERT placeholders without changing append-only semantics', () => {
    const result = translate(
      'INSERT INTO audit_events (event_id, action, target_type) VALUES (?, ?, ?)',
    )

    expect(result).toEqual({
      sql: 'INSERT INTO audit_events (event_id, action, target_type) VALUES ($1, $2, $3)',
      extraValues: [],
    })
  })

  it('preserves D1 batch changes() ordering for an AuditEvent insert-select statement', () => {
    const sql = 'INSERT INTO audit_events(event_id) SELECT ? WHERE changes() = 1'

    expect(() => translate(sql)).toThrow('W09_AUDIT_EVENT_CHANGES_REQUIRES_BATCH_CONTEXT')
    expect(translate(sql, 0)).toEqual({
      sql: 'INSERT INTO audit_events(event_id) SELECT $1 WHERE $2 = 1',
      extraValues: [0],
    })
    expect(translate(sql, 1)).toEqual({
      sql: 'INSERT INTO audit_events(event_id) SELECT $1 WHERE $2 = 1',
      extraValues: [1],
    })
  })

  it.each([
    'UPDATE audit_events SET action = ? WHERE event_id = ?',
    'DELETE FROM audit_events WHERE event_id = ?',
    'TRUNCATE TABLE audit_events',
    'REPLACE INTO audit_events(event_id) VALUES (?)',
    'INSERT OR REPLACE INTO audit_events(event_id) VALUES (?)',
    'INSERT INTO audit_events(event_id) VALUES (?) ON CONFLICT (event_id) DO UPDATE SET action = EXCLUDED.action',
  ])('rejects non-append-only AuditEvent statement: %s', (sql) => {
    expect(() => translate(sql)).toThrow('W09_AUDIT_EVENT_APPEND_ONLY_STATEMENT_REQUIRED')
  })

  it('rejects a query that joins AuditEvent with another owner table', () => {
    expect(() => translate(
      'SELECT a.event_id FROM audit_events a JOIN moderation_cases m ON m.case_id = a.target_id',
    )).toThrow('W09_AUDIT_EVENT_APPEND_ONLY_STATEMENT_REQUIRED')
  })
})
