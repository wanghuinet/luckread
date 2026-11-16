import { describe, expect, it } from 'vitest'

import { assertW09AuditEventStatement as assertAuditSql } from './audit-event-postgres-adapter.js'

describe('W09 AuditEvent PostgreSQL runtime boundary', () => {
  it('returns false for statements owned by other D1-03 tables', () => {
    expect(assertAuditSql('SELECT case_id FROM moderation_cases WHERE case_id = ?')).toBe(false)
  })

  it('admits append-only AuditEvent reads and inserts', () => {
    expect(assertAuditSql('SELECT event_id FROM audit_events WHERE event_id = ? LIMIT 1')).toBe(true)
    expect(assertAuditSql('INSERT INTO audit_events(event_id, action) VALUES (?, ?)')).toBe(true)
    expect(assertAuditSql('INSERT INTO audit_events(event_id) SELECT ? WHERE changes() = 1')).toBe(true)
  })

  it('treats quoted AuditEvent payload text as data rather than SQL operations or table references', () => {
    expect(assertAuditSql(
      "INSERT INTO audit_events (event_id, action) VALUES (?, 'UPDATE another table')",
    )).toBe(true)
    expect(assertAuditSql(
      "SELECT event_id FROM audit_events WHERE reason = 'FROM moderation_cases' AND event_id = ?",
    )).toBe(true)
  })

  it.each([
    'UPDATE audit_events SET action = ? WHERE event_id = ?',
    'DELETE FROM audit_events WHERE event_id = ?',
    'TRUNCATE TABLE audit_events',
    'REPLACE INTO audit_events(event_id) VALUES (?)',
    'INSERT OR REPLACE INTO audit_events(event_id) VALUES (?)',
    'INSERT INTO audit_events(event_id) VALUES (?) ON CONFLICT (event_id) DO UPDATE SET action = EXCLUDED.action',
  ])('rejects non-append-only AuditEvent statement: %s', (sql) => {
    expect(() => assertAuditSql(sql)).toThrow('W09_AUDIT_EVENT_APPEND_ONLY_STATEMENT_REQUIRED')
  })

  it('rejects a query that joins AuditEvent with another owner table', () => {
    expect(() => assertAuditSql(
      'SELECT a.event_id FROM audit_events a JOIN moderation_cases m ON m.case_id = a.target_id',
    )).toThrow('W09_AUDIT_EVENT_APPEND_ONLY_STATEMENT_REQUIRED')
  })
})
