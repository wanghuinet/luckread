#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const contractPath = 'contracts/migration/AUTH-007-mfa-operation-receipt.v1.json'
const migrationPath = 'workers/W02-identity/migrations/0009_auth_007_mfa_operation_receipts.sql'
const contract = JSON.parse(readFileSync(contractPath, 'utf8'))
const sql = readFileSync(migrationPath, 'utf8')

function fail(message) {
  throw new Error('AUTH-007 MFA operation receipt static audit failed: ' + message)
}

const requiredColumns = [
  'receipt_id',
  'resource_id',
  'operation_path',
  'is_challenge',
  'status',
  'started_at',
  'completed_at',
  'correlation_id',
  'causation_id',
  'event_plan',
  'attempt',
  'next_attempt_at',
  'last_error_code',
]
const validPaths = [
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
  '/two-factor/disable',
  '/two-factor/generate-backup-codes',
]
const validStatuses = ['STARTED', 'READY', 'EMITTED', 'RESOLVED', 'UNKNOWN']

if (contract.migrationId !== 'MIG-AUTH-007-MFA-OPERATION-RECEIPTS-V1') fail('migrationId mismatch')
if (contract.status !== 'CONTRACTED_NOT_VERIFIED' || contract.promotion !== 'NOT_GREEN') fail('contract must stay unverified and not green')
if (contract.featureId !== 'AUTH-007') fail('featureId mismatch')
if (contract.target?.physicalTable !== 'auth_007_mfa_operation_receipts') fail('target table mismatch')
if (contract.target?.sourceMigration !== migrationPath) fail('source migration mismatch')
if (contract.target?.databaseBinding !== 'workers/W02-identity/wrangler.jsonc:D1_01') fail('database authority mismatch')
if (contract.authority?.worker !== 'W02' || contract.authority?.domain !== 'D1-01') fail('W02/D1-01 authority mismatch')
if (contract.rules?.w02MustNotWriteD1_03 !== true || contract.rules?.noNewWorkerD1QueueOrServiceBinding !== true) fail('authority/topology guardrails are missing')
if (contract.rules?.secretsNeverEnterReceipt !== true || contract.rules?.unknownOutcomesRemainVisible !== true) fail('secret/uncertainty guardrails are missing')

const contractColumns = (contract.columns ?? []).map((column) => column.column)
if (JSON.stringify(contractColumns) !== JSON.stringify(requiredColumns)) fail('contract columns differ from canonical migration list')
for (const status of validStatuses) {
  if (!contract.constraints?.statusValues?.includes(status)) fail('contract missing status ' + status)
}
for (const path of validPaths) {
  if (!contract.constraints?.operationPaths?.includes(path)) fail('contract missing operation path ' + path)
}
for (const token of [
  'CREATE TABLE auth_007_mfa_operation_receipts',
  "CHECK (is_challenge IN (0, 1))",
  "CHECK (status IN ('STARTED', 'READY', 'EMITTED', 'RESOLVED', 'UNKNOWN'))",
  'json_valid(event_plan)',
  'CHECK (attempt >= 0)',
  'auth_007_mfa_operation_receipts_status_next_attempt_idx',
]) {
  if (!sql.includes(token)) fail('migration missing invariant: ' + token)
}

const db = new DatabaseSync(':memory:')
try {
  db.exec(sql)
  const tableInfo = db.prepare('PRAGMA table_info("auth_007_mfa_operation_receipts")').all()
  const indexRows = db.prepare('PRAGMA index_list("auth_007_mfa_operation_receipts")').all()
  const tableRow = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'auth_007_mfa_operation_receipts'").get()
  if (!tableRow?.sql) fail('SQLite did not create operation receipt table')
  if (JSON.stringify(tableInfo.map((column) => column.name)) !== JSON.stringify(requiredColumns)) fail('SQLite column order/names differ from contract')
  const byName = new Map(tableInfo.map((column) => [column.name, column]))
  if (byName.get('receipt_id')?.pk !== 1 || byName.get('receipt_id')?.notnull !== 1) fail('receipt_id must be NOT NULL primary key')
  if (byName.get('attempt')?.dflt_value !== '0') fail('attempt must default to zero')
  if (!indexRows.some((row) => row.name === 'auth_007_mfa_operation_receipts_status_next_attempt_idx')) {
    fail('required receipt retry index is missing')
  }

  const insert = db.prepare(
    'INSERT INTO auth_007_mfa_operation_receipts ' +
    '(receipt_id, resource_id, operation_path, is_challenge, status, started_at, completed_at, correlation_id, causation_id, event_plan, attempt, next_attempt_at, last_error_code) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
  const timestamp = '2026-10-26T12:00:00.000Z'
  for (let i = 0; i < validStatuses.length; i += 1) {
    insert.run(
      'receipt-' + i,
      'user-1',
      validPaths[i % validPaths.length],
      i % 2,
      validStatuses[i],
      timestamp,
      null,
      'corr-' + i,
      'cause-' + i,
      JSON.stringify([{ eventType: 'auth.mfa.challenge_succeeded', result: 'succeeded' }]),
      0,
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
  const invalid = (suffix, options = {}) => insert.run(
    'receipt-invalid-' + suffix,
    'user-1',
    options.path ?? '/two-factor/disable',
    options.challenge ?? 0,
    options.status ?? 'STARTED',
    timestamp,
    null,
    options.correlation ?? 'corr-invalid',
    'cause-invalid',
    options.plan ?? null,
    options.attempt ?? 0,
    null,
    null,
  )
  expectRejected('invalid operation path', () => invalid('path', { path: '/two-factor/unreviewed' }))
  expectRejected('invalid challenge flag', () => invalid('challenge', { challenge: 2 }))
  expectRejected('invalid status', () => invalid('status', { status: 'FAILED' }))
  expectRejected('non-array event plan', () => invalid('plan', { plan: JSON.stringify({ eventType: 'auth.mfa.challenge_succeeded' }) }))
  expectRejected('malformed event plan JSON', () => invalid('bad-json', { plan: '{bad' }))
  expectRejected('negative attempt', () => invalid('attempt', { attempt: -1 }))
  expectRejected('empty correlation ID', () => invalid('correlation', { correlation: '' }))
  expectRejected('overlong error code', () => insert.run(
    'receipt-invalid-error-code', 'user-1', '/two-factor/disable', 0, 'STARTED',
    timestamp, null, 'corr-error', 'cause-error', null, 0, null, 'x'.repeat(129),
  ))

  console.log(JSON.stringify({
    AUTH_007_MFA_OPERATION_RECEIPT_STATIC_AUDIT: 'PASS',
    table: 'auth_007_mfa_operation_receipts',
    testedStatuses: validStatuses.length,
    testedOperationPaths: validPaths.length,
    rejectedConstraintCases: 8,
    requiredIndex: 'auth_007_mfa_operation_receipts_status_next_attempt_idx',
    scope: 'LOCAL_SQLITE_SCHEMA_ONLY_NO_REMOTE_MUTATION',
  }, null, 2))
} finally {
  db.close()
}
