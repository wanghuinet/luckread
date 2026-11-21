#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const contractPath = 'contracts/migration/AUTH-010-session-revocation-journal.v1.json'
const migrationPath = 'workers/W02-identity/migrations/0012_auth_010_session_revocation_journal.sql'
const contract = JSON.parse(readFileSync(contractPath, 'utf8'))
const sql = readFileSync(migrationPath, 'utf8')

function fail(message) {
  throw new Error('AUTH-010 session revocation journal static audit failed: ' + message)
}

const requiredColumns = [
  'journal_id',
  'event_id',
  'event_type',
  'schema_version',
  'resource_id',
  'source_version',
  'idempotency_key',
  'payload',
  'status',
  'attempt',
  'next_attempt_at',
  'created_at',
  'published_at',
  'last_error_code',
]

if (contract.status !== 'CONTRACTED_PARTIAL') fail('contract must remain partial until production evidence is admitted')
if (contract.authority?.worker !== 'W02' || contract.authority?.database !== 'D1-01') fail('W02/D1-01 authority mismatch')
if (contract.authority?.table !== 'auth_010_session_revocation_journal') fail('table authority mismatch')
if (contract.migration?.file !== migrationPath || contract.migration?.number !== '0012') fail('migration reference mismatch')
if (JSON.stringify(contract.requiredColumns) !== JSON.stringify(requiredColumns)) fail('contract column list/order mismatch')
for (const required of [
  'event_id is unique',
  'idempotency_key is unique',
  'one user.session.revoked event per Session resource_id',
  'payload must be valid JSON object',
  'status is PENDING, PUBLISHED or FAILED',
  'source_version equals 1',
]) {
  if (!contract.constraints?.includes(required)) fail('contract missing constraint: ' + required)
}
if (!Array.isArray(contract.nonGoals) ||
    !contract.nonGoals.some((item) => item.includes('No production D1 migration'))) {
  fail('contract must not imply a production D1 migration')
}
for (const token of [
  'CREATE TABLE auth_010_session_revocation_journal',
  "CHECK (event_type = 'user.session.revoked')",
  "CHECK (schema_version = '1.0')",
  'json_valid(payload)',
  "json_type(payload) = 'object'",
  "CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED'))",
  'CHECK (attempt >= 1)',
  'UNIQUE (resource_id, event_type)',
  'auth_010_session_revocation_journal_status_next_attempt_idx',
]) {
  if (!sql.includes(token)) fail('migration missing invariant: ' + token)
}
assert.doesNotMatch(sql, /DROP\s+(TABLE|COLUMN)|ALTER\s+TABLE|RENAME\s+TABLE/i,
  'AUTH-010 migration must remain additive-only')

const db = new DatabaseSync(':memory:')
try {
  db.exec(sql)
  const tableInfo = db.prepare('PRAGMA table_info("auth_010_session_revocation_journal")').all()
  const indexes = db.prepare('PRAGMA index_list("auth_010_session_revocation_journal")').all()
  const table = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'auth_010_session_revocation_journal'",
  ).get()
  if (!table?.sql) fail('SQLite did not create the AUTH-010 journal')
  assert.deepEqual(tableInfo.map((column) => column.name), requiredColumns, 'SQLite column list/order mismatch')
  const columns = new Map(tableInfo.map((column) => [column.name, column]))
  if (columns.get('journal_id')?.pk !== 1 || columns.get('journal_id')?.notnull !== 1) fail('journal_id must be NOT NULL primary key')
  if (columns.get('attempt')?.dflt_value !== '1') fail('attempt must default to one')
  if (!indexes.some((index) => index.name === 'auth_010_session_revocation_journal_status_next_attempt_idx')) {
    fail('required pending-publication index is missing')
  }

  const insert = db.prepare(
    'INSERT INTO auth_010_session_revocation_journal (' + requiredColumns.join(', ') + ') ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
  const row = (suffix, overrides = {}) => ({
    journal_id: 'journal-' + suffix,
    event_id: 'evt_' + suffix,
    event_type: 'user.session.revoked',
    schema_version: '1.0',
    resource_id: 'session-' + suffix,
    source_version: 1,
    idempotency_key: 'AUTH010_SESSION_REVOKE_' + suffix,
    payload: JSON.stringify({ eventType: 'user.session.revoked', resourceId: 'session-' + suffix }),
    status: 'PENDING',
    attempt: 1,
    next_attempt_at: null,
    created_at: '2026-11-06T00:00:00.000Z',
    published_at: null,
    last_error_code: null,
    ...overrides,
  })
  const save = (value) => insert.run(...requiredColumns.map((column) => value[column]))
  const expectRejected = (label, value) => {
    let rejected = false
    try { save(value) } catch { rejected = true }
    if (!rejected) fail(label + ' must be rejected by SQLite constraints')
  }

  save(row('valid-1'))
  expectRejected('invalid event type', row('bad-event', { event_type: 'identity.account_state_changed' }))
  expectRejected('invalid schema version', row('bad-schema', { schema_version: '2.0' }))
  expectRejected('invalid source version', row('bad-source', { source_version: 2 }))
  expectRejected('invalid status', row('bad-status', { status: 'PROCESSING' }))
  expectRejected('zero attempt', row('bad-attempt', { attempt: 0 }))
  expectRejected('malformed JSON payload', row('bad-json', { payload: '{bad' }))
  expectRejected('non-object JSON payload', row('bad-shape', { payload: '[]' }))
  expectRejected('overlong last error code', row('bad-error', { last_error_code: 'x'.repeat(129) }))
  expectRejected('duplicate event ID', row('duplicate-event', {
    event_id: 'evt_valid-1',
  }))
  expectRejected('duplicate idempotency key', row('duplicate-idempotency', {
    idempotency_key: 'AUTH010_SESSION_REVOKE_valid-1',
  }))
  expectRejected('second event for the same Session resource', row('duplicate-resource', {
    resource_id: 'session-valid-1',
  }))

  const saved = db.prepare(
    'SELECT status, attempt, event_type, resource_id FROM auth_010_session_revocation_journal WHERE journal_id = ?',
  ).get('journal-valid-1')
  assert.deepEqual({ ...saved }, {
    status: 'PENDING',
    attempt: 1,
    event_type: 'user.session.revoked',
    resource_id: 'session-valid-1',
  })
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get('auth_010_session_revocation_journal_status_next_attempt_idx').count,
    1,
  )

  console.log(JSON.stringify({
    AUTH_010_SESSION_REVOCATION_JOURNAL_STATIC_AUDIT: 'PASS',
    table: 'auth_010_session_revocation_journal',
    testedColumns: requiredColumns.length,
    rejectedConstraintCases: 11,
    requiredIndex: 'auth_010_session_revocation_journal_status_next_attempt_idx',
    scope: 'LOCAL_SQLITE_MEMORY_ONLY_NO_REMOTE_MUTATION',
    productionD1Access: false,
  }, null, 2))
} finally {
  db.close()
}
