#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const contractPath = 'contracts/migration/AUTH-013-publication-journal.v1.json'
const migrationPath = 'workers/W02-content/migrations/0003_auth_013_publication_journal.sql'
const contract = JSON.parse(readFileSync(contractPath, 'utf8'))
const sql = readFileSync(migrationPath, 'utf8')

const fail = (message) => {
  console.error('AUTH-013 Journal Static Audit RED — ' + message)
  process.exit(1)
}

if (contract.migrationId !== 'MIG-AUTH-013-PUBLICATION-JOURNAL-V1') fail('migrationId mismatch')
if (contract.target?.physicalTable !== 'auth_013_publication_journal') fail('target table mismatch')
if (contract.target?.sourceMigration !== migrationPath) fail('source migration mismatch')

const requiredColumns = [
  'journal_id','event_id','event_type','schema_version','resource_id',
  'source_version','payload','status','attempt','next_attempt_at',
  'created_at','published_at','last_error_code',
]
const columnNames = contract.columns?.map((x) => x.column) ?? []
for (const column of requiredColumns) {
  if (!columnNames.includes(column)) fail('contract missing column ' + column)
}

for (const token of [
  'CREATE TABLE auth_013_publication_journal',
  "CHECK (event_type = 'identity.account_state_changed')",
  "CHECK (schema_version = '1.0')",
  "CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED'))",
  'CHECK (attempt >= 1)',
  'UNIQUE (resource_id, event_type, source_version)',
  'auth_013_publication_journal_status_next_attempt_idx',
]) {
  if (!sql.includes(token)) fail('migration missing required invariant: ' + token)
}

const tmp = mkdtempSync(join(tmpdir(), 'luckread-auth013-journal-'))
const db = join(tmp, 'journal.db')

try {
  execFileSync('sqlite3', [db], {
    input: 'CREATE TABLE users (id TEXT PRIMARY KEY, account_state TEXT NOT NULL, account_state_version INTEGER NOT NULL);\n' + sql + '\n',
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const tableInfo = execFileSync('sqlite3', ['-json', db, 'PRAGMA table_info("auth_013_publication_journal");'], { encoding: 'utf8' })
  const indexes = execFileSync('sqlite3', ['-json', db, 'PRAGMA index_list("auth_013_publication_journal");'], { encoding: 'utf8' })
  const infoRows = JSON.parse(tableInfo)
  const indexRows = JSON.parse(indexes)

  const actual = new Map(infoRows.map((row) => [row.name, row]))
  for (const column of requiredColumns) {
    if (!actual.has(column)) fail('SQLite execution missing column ' + column)
  }
  if (actual.get('journal_id')?.pk !== 1 || actual.get('journal_id')?.notnull !== 1) fail('journal_id must be NOT NULL primary key')
  if (actual.get('event_id')?.notnull !== 1) fail('event_id must be NOT NULL')
  if (actual.get('source_version')?.type !== 'INTEGER') fail('source_version must be INTEGER')
  if (actual.get('attempt')?.dflt_value !== '1') fail('attempt default must be 1')
  if (!indexRows.some((row) => row.name === 'auth_013_publication_journal_status_next_attempt_idx')) fail('required status/next-attempt index not present')

  console.log(JSON.stringify({
    AUTH_013_JOURNAL_MIGRATION_STATIC_AUDIT: 'PASS',
    table: 'auth_013_publication_journal',
    columns: requiredColumns,
    requiredIndex: 'auth_013_publication_journal_status_next_attempt_idx',
  }, null, 2))
} catch (error) {
  fail(error?.stderr?.toString() || error.message)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
