import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const workerRoot = resolve(scriptDirectory, '../..')
const repositoryRoot = resolve(workerRoot, '../..')
const migrationContractPath = resolve(repositoryRoot, 'contracts/migration/AUTH-013-publication-journal.v1.json')
const eventContractPath = resolve(repositoryRoot, 'contracts/events/identity-account-state-changed.v1.json')
const outputPath = resolve(workerRoot, 'src/neon-postgres-migrations/0004_auth_013_publication_journal.sql')

const migrationContract = JSON.parse(readFileSync(migrationContractPath, 'utf8'))
const eventContract = JSON.parse(readFileSync(eventContractPath, 'utf8'))

const fail = (message) => { throw new Error('AUTH-013 publication journal contract drift: ' + message) }
const expectedColumns = [
  ['journal_id', 'TEXT', false, true],
  ['event_id', 'TEXT', false, false],
  ['event_type', 'TEXT', false, false],
  ['schema_version', 'TEXT', false, false],
  ['resource_id', 'TEXT', false, false],
  ['source_version', 'INTEGER', false, false],
  ['payload', 'TEXT', false, false],
  ['status', 'TEXT', false, false],
  ['attempt', 'INTEGER', false, false],
  ['next_attempt_at', 'TEXT', true, false],
  ['created_at', 'TEXT', false, false],
  ['published_at', 'TEXT', true, false],
  ['last_error_code', 'TEXT', true, false],
]

if (migrationContract.migrationId !== 'MIG-AUTH-013-PUBLICATION-JOURNAL-V1') fail('migration id')
if (migrationContract.featureId !== 'AUTH-013') fail('feature id')
if (migrationContract.authority?.worker !== 'W02' || migrationContract.authority?.domain !== 'D1-01') {
  fail('worker/domain ownership')
}
if (migrationContract.authority?.businessAuthority !== 'W02' || migrationContract.authority?.auditAuthority !== 'W06') {
  fail('business/audit authority')
}
if (migrationContract.target?.physicalTable !== 'auth_013_publication_journal') fail('target table')
if (migrationContract.target?.sourceMigration !== 'workers/W02-identity/migrations/0003_auth_013_publication_journal.sql') {
  fail('source migration path')
}
if (migrationContract.authority?.eventContract !== 'contracts/events/identity-account-state-changed.v1.json') {
  fail('event contract path')
}
if (migrationContract.rules?.journalIsNotAccountStateAuthority !== true ||
    migrationContract.rules?.w02IsAuthoritativeWriter !== true ||
    migrationContract.rules?.w02MustNotWriteD1_03 !== true ||
    migrationContract.rules?.sameD1AtomicityRequiredForTransitionAndJournalInsert !== true ||
    migrationContract.rules?.publisherRetriesMustReuseTheSameEventId !== true ||
    migrationContract.rules?.consumerIdempotencyRemainsW06Responsibility !== true) {
  fail('journal and delivery authority invariants')
}
if (JSON.stringify(migrationContract.constraints?.resourceVersionUniqueness) !==
    JSON.stringify(['resource_id', 'event_type', 'source_version'])) fail('resource/version unique key')
if (JSON.stringify(migrationContract.constraints?.statusValues) !==
    JSON.stringify(['PENDING', 'PUBLISHED', 'FAILED'])) fail('journal status vocabulary')
if (migrationContract.constraints?.eventType !== 'identity.account_state_changed' ||
    migrationContract.constraints?.schemaVersion !== '1.0') fail('event identity constants')
if (JSON.stringify(migrationContract.indexes) !==
    JSON.stringify(['auth_013_publication_journal_status_next_attempt_idx'])) fail('index contract')

const actualColumns = migrationContract.columns ?? []
if (actualColumns.length !== expectedColumns.length) fail('column count must be exactly 13')
for (const [name, dbType, nullable, primaryKey] of expectedColumns) {
  const column = actualColumns.find((candidate) => candidate.column === name)
  if (!column || column.dbType !== dbType || column.nullable !== nullable || (column.primaryKey === true) !== primaryKey) {
    fail('column contract: ' + name)
  }
}
const eventType = eventContract.properties?.eventType?.const
const schemaVersion = eventContract.properties?.schemaVersion?.const
if (eventContract['x-luckread']?.canonical !== true ||
    eventContract['x-luckread']?.['producer-authority'] !== 'W02' ||
    eventContract['x-luckread']?.['authoritative-domain'] !== 'D1-01' ||
    eventContract['x-luckread']?.['consumer-authority'] !== 'W06' ||
    eventContract['x-luckread']?.['projection-consumer-authority'] !== 'W04' ||
    eventContract['x-luckread']?.['event-is-authority'] !== false ||
    eventType !== migrationContract.constraints.eventType ||
    schemaVersion !== migrationContract.constraints.schemaVersion) {
  fail('canonical event contract binding')
}
if (!eventContract.required?.includes('eventId') ||
    !eventContract.required?.includes('resourceId') ||
    !eventContract.required?.includes('sourceVersion') ||
    !eventContract.required?.includes('eventType')) {
  fail('canonical event requires fields used by the journal contract')
}

// SQLite stores canonical ISO-8601 timestamps as TEXT. PostgreSQL uses
// TIMESTAMPTZ for these same temporal fields; the wire/event representation
// remains the canonical date-time string when serialized by the application.
const sql = [
  '-- GENERATED FILE',
  '-- Source authority: contracts/migration/AUTH-013-publication-journal.v1.json',
  '-- Event authority: contracts/events/identity-account-state-changed.v1.json',
  '-- W02 owns the durable publication journal; W06 owns audit-event persistence.',
  '-- The journal is not an Account State authority and must never write D1-03.',
  '-- Historical 0002_auth_013_account_state.sql targets Payload users and is not this table migration.',
  '-- SQLite ISO timestamp TEXT columns are represented as TIMESTAMPTZ in PostgreSQL.',
  '-- No event, user, or business rows are backfilled.',
  '-- Generator: workers/W02-identity/scripts/neon/generate-auth013-publication-journal-postgres-migration.mjs',
  '-- Do not hand-edit. Regenerate from the canonical contracts.',
  '',
  'CREATE TABLE auth_013_publication_journal (',
  '  journal_id TEXT NOT NULL CONSTRAINT auth_013_publication_journal_pkey PRIMARY KEY,',
  '  event_id TEXT NOT NULL CONSTRAINT auth_013_publication_journal_event_id_uq UNIQUE,',
  "  event_type TEXT NOT NULL CHECK (event_type = 'identity.account_state_changed'),",
  "  schema_version TEXT NOT NULL CHECK (schema_version = '1.0'),",
  '  resource_id TEXT NOT NULL,',
  '  source_version INTEGER NOT NULL CHECK (source_version >= 1),',
  '  payload TEXT NOT NULL,',
  "  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED')),",
  '  attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1),',
  '  next_attempt_at TIMESTAMPTZ,',
  '  created_at TIMESTAMPTZ NOT NULL,',
  '  published_at TIMESTAMPTZ,',
  '  last_error_code TEXT CHECK (last_error_code IS NULL OR length(last_error_code) <= 128),',
  '  CONSTRAINT auth_013_publication_journal_resource_version_uq',
  '    UNIQUE (resource_id, event_type, source_version)',
  ');',
  '',
  'CREATE INDEX auth_013_publication_journal_status_next_attempt_idx',
  '  ON auth_013_publication_journal(status, next_attempt_at);',
  '',
].join('\n')

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, sql)
console.log('W02_AUTH013_PUBLICATION_JOURNAL_POSTGRES_MIGRATION_GENERATION_PASS')
