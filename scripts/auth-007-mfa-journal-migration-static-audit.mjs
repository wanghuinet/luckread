#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const contractPath = 'contracts/migration/AUTH-007-mfa-publication-journal.v1.json'
const migrationPath = 'workers/W02-identity/migrations/0008_auth_007_mfa_publication_journal.sql'
const contract = JSON.parse(readFileSync(contractPath, 'utf8'))
const sql = readFileSync(migrationPath, 'utf8')

function fail(message) {
  throw new Error('AUTH-007 MFA outbox migration static audit failed: ' + message)
}

const expectedEventNames = [
  'auth.mfa.enrollment_started',
  'auth.mfa.enrollment_verified',
  'auth.mfa.enrollment_failed',
  'auth.mfa.challenge_succeeded',
  'auth.mfa.challenge_failed',
  'auth.mfa.factor_disabled',
  'auth.mfa.recovery_codes_rotated',
  'auth.mfa.recovery_code_consumed',
  'auth.mfa.locked',
  'auth.mfa.replay_rejected',
]
const requiredColumns = [
  'journal_id', 'event_id', 'event_type', 'schema_version', 'resource_id',
  'source_version', 'idempotency_key', 'payload', 'status', 'attempt',
  'next_attempt_at', 'created_at', 'published_at', 'last_error_code',
]

if (contract.migrationId !== 'MIG-AUTH-007-MFA-PUBLICATION-JOURNAL-V1') fail('migrationId mismatch')
if (contract.status !== 'CONTRACTED_NOT_VERIFIED' || contract.promotion !== 'NOT_GREEN') fail('contract must remain unverified and not green')
if (contract.target?.physicalTable !== 'auth_007_mfa_publication_journal') fail('target table mismatch')
if (contract.target?.sourceMigration !== migrationPath) fail('source migration mismatch')
if (contract.target?.databaseBinding !== 'workers/W02-identity/wrangler.jsonc:D1_01') fail('database authority mismatch')
if (contract.authority?.worker !== 'W02' || contract.authority?.domain !== 'D1-01') fail('W02/D1-01 authority mismatch')
if (contract.rules?.w02MustNotWriteD1_03 !== true || contract.rules?.noNewWorkerD1QueueOrServiceBinding !== true) fail('authority or topology rules are missing')

const contractColumns = (contract.columns ?? []).map((column) => column.column)
for (const column of requiredColumns) {
  if (!contractColumns.includes(column)) fail('contract missing column ' + column)
}
if (contractColumns.length !== requiredColumns.length || requiredColumns.some((column, i) => contractColumns[i] !== column)) {
  fail('contract columns do not match the canonical ordered migration column list')
}
for (const eventName of expectedEventNames) {
  if (!contract.constraints?.eventTypes?.includes(eventName)) fail('contract missing event type ' + eventName)
}
for (const token of [
  'CREATE TABLE auth_007_mfa_publication_journal',
  'event_id TEXT NOT NULL UNIQUE',
  'idempotency_key TEXT NOT NULL UNIQUE',
  "CHECK (schema_version = '1.0')",
  'json_valid(payload)',
  "CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED'))",
  'CHECK (attempt >= 1)',
  'auth_007_mfa_publication_journal_status_next_attempt_idx',
]) {
  if (!sql.includes(token)) fail('migration missing invariant: ' + token)
}

const db = new DatabaseSync(':memory:')
try {
  db.exec(sql)
  const tableInfo = db.prepare('PRAGMA table_info("auth_007_mfa_publication_journal")').all()
  const indexRows = db.prepare('PRAGMA index_list("auth_007_mfa_publication_journal")').all()
  const tableRow = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'auth_007_mfa_publication_journal'").get()
  if (!tableRow?.sql) fail('SQLite execution did not create the expected table')

  const actualColumns = tableInfo.map((column) => column.name)
  if (JSON.stringify(actualColumns) !== JSON.stringify(requiredColumns)) fail('SQLite schema column order/names differ from the contract')
  const byName = new Map(tableInfo.map((column) => [column.name, column]))
  if (byName.get('journal_id')?.pk !== 1 || byName.get('journal_id')?.notnull !== 1) fail('journal_id must be NOT NULL primary key')
  if (byName.get('event_id')?.notnull !== 1 || byName.get('idempotency_key')?.notnull !== 1) fail('event_id and idempotency_key must be NOT NULL')
  if (byName.get('source_version')?.type !== 'INTEGER' || byName.get('attempt')?.dflt_value !== '1') fail('source_version/attempt shape mismatch')
  if (!indexRows.some((row) => row.name === 'auth_007_mfa_publication_journal_status_next_attempt_idx')) {
    fail('required status/next-attempt index is absent')
  }
  if (!indexRows.some((row) => row.unique === 1 && /event_id/.test(String(row.name)))) {
    const uniqueEventIndex = indexRows.filter((row) => row.unique === 1).some((row) =>
      db.prepare('PRAGMA index_info(' + JSON.stringify(row.name) + ')').all().some((column) => column.name === 'event_id'))
    if (!uniqueEventIndex) fail('event_id must have a unique index')
  }

  const insert = db.prepare(
    'INSERT INTO auth_007_mfa_publication_journal ' +
    '(journal_id, event_id, event_type, schema_version, resource_id, source_version, idempotency_key, payload, status, attempt, next_attempt_at, created_at, published_at, last_error_code) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
  const timestamp = '2026-10-24T14:00:00.000Z'
  for (let i = 0; i < expectedEventNames.length; i += 1) {
    insert.run(
      'journal-' + i,
      'evt_' + String(i).padStart(32, '0'),
      expectedEventNames[i],
      '1.0',
      'user-1',
      1,
      'mfa-idem-' + i,
      JSON.stringify({ operationId: 'source-test', result: 'started' }),
      'PENDING',
      1,
      null,
      timestamp,
      null,
      null,
    )
  }

  const expectRejected = (label, operation) => {
    let rejected = false
    try {
      operation()
    } catch {
      rejected = true
    }
    if (!rejected) fail(label + ' must be rejected by SQLite constraints')
  }
  expectRejected('unknown event type', () => insert.run(
    'journal-invalid-event', 'evt_invalid_event', 'auth.mfa.unknown', '1.0', 'user-1', 1,
    'idem-invalid-event', '{}', 'PENDING', 1, null, timestamp, null, null,
  ))
  expectRejected('invalid schema version', () => insert.run(
    'journal-invalid-schema', 'evt_invalid_schema', 'auth.mfa.enrollment_started', '2.0', 'user-1', 1,
    'idem-invalid-schema', '{}', 'PENDING', 1, null, timestamp, null, null,
  ))
  expectRejected('malformed JSON payload', () => insert.run(
    'journal-invalid-json', 'evt_invalid_json', 'auth.mfa.enrollment_started', '1.0', 'user-1', 1,
    'idem-invalid-json', '{bad', 'PENDING', 1, null, timestamp, null, null,
  ))
  expectRejected('non-object JSON payload', () => insert.run(
    'journal-non-object-json', 'evt_non_object_json', 'auth.mfa.enrollment_started', '1.0', 'user-1', 1,
    'idem-non-object-json', '[]', 'PENDING', 1, null, timestamp, null, null,
  ))
  expectRejected('invalid status', () => insert.run(
    'journal-invalid-status', 'evt_invalid_status', 'auth.mfa.enrollment_started', '1.0', 'user-1', 1,
    'idem-invalid-status', '{}', 'DELIVERED', 1, null, timestamp, null, null,
  ))
  expectRejected('non-positive attempt', () => insert.run(
    'journal-invalid-attempt', 'evt_invalid_attempt', 'auth.mfa.enrollment_started', '1.0', 'user-1', 1,
    'idem-invalid-attempt', '{}', 'PENDING', 0, null, timestamp, null, null,
  ))
  expectRejected('duplicate event ID', () => insert.run(
    'journal-duplicate-event', 'evt_' + String(0).padStart(32, '0'), 'auth.mfa.enrollment_started', '1.0', 'user-1', 1,
    'idem-duplicate-event', '{}', 'PENDING', 1, null, timestamp, null, null,
  ))
  expectRejected('duplicate idempotency key', () => insert.run(
    'journal-duplicate-idempotency', 'evt_duplicate_idempotency', 'auth.mfa.enrollment_started', '1.0', 'user-1', 1,
    'mfa-idem-0', '{}', 'PENDING', 1, null, timestamp, null, null,
  ))

  console.log(JSON.stringify({
    AUTH_007_MFA_OUTBOX_MIGRATION_STATIC_AUDIT: 'PASS',
    table: 'auth_007_mfa_publication_journal',
    testedEventTypes: expectedEventNames.length,
    rejectedConstraintCases: 8,
    requiredIndex: 'auth_007_mfa_publication_journal_status_next_attempt_idx',
    scope: 'LOCAL_SQLITE_SCHEMA_ONLY_NO_REMOTE_MUTATION',
  }, null, 2))
} finally {
  db.close()
}
